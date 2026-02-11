/**
 * Test Script - Verify Data API Polling is receiving trades
 * 
 * Run this to test if your SmartMoneyService can detect trades via polling
 */

import dotenv from 'dotenv';
import {
  DataApiClient,
  GammaApiClient,
  RateLimiter,
  createUnifiedCache,
  SmartMoneyService,
  WalletService,
  SubgraphClient,
} from '@catalyst-team/poly-sdk';

dotenv.config();

async function main() {
  console.log('='.repeat(60));
  console.log('🧪 Data API Polling Test');
  console.log('='.repeat(60));

  const targetAddress = process.env.TEST_WALLET_ADDRESS;
  if (!targetAddress) {
    console.error('❌ TEST_WALLET_ADDRESS not found in .env');
    console.log('Set TEST_WALLET_ADDRESS to a wallet you want to monitor');
    process.exit(1);
  }

  console.log('🔧 Initializing services...');
  const cache = createUnifiedCache();
  const rateLimiter = new RateLimiter();
  const dataApi = new DataApiClient(rateLimiter, cache);
  const gammaApi = new GammaApiClient(rateLimiter, cache);
  const subgraph = new SubgraphClient(rateLimiter, cache);
  
  const walletService = new WalletService(dataApi, subgraph, cache);
  
  // Initialize SmartMoneyService with Data API polling
  const smartMoneyService = new SmartMoneyService(
    walletService,
    null as any, // RealtimeServiceV2 not used
    null as any, // TradingService not needed
    dataApi // Required for polling
  );
  
  console.log('✅ Services initialized');
  console.log(`👂 Polling for trades from: ${targetAddress}`);
  console.log('   (Press Ctrl+C to stop)');
  console.log('='.repeat(60));

  let tradeCount = 0;

  // Subscribe to trades using Data API polling
  const subscription = smartMoneyService.subscribeSmartMoneyTrades(
    (trade) => {
      tradeCount++;
      console.log(`\n📊 Trade #${tradeCount}:`);
      console.log(`   Trader: ${trade.traderName || 'Unknown'} (${trade.traderAddress.slice(0, 10)}...)`);
      console.log(`   Market: ${trade.marketSlug || trade.conditionId?.slice(0, 10) || 'Unknown'}`);
      console.log(`   ${trade.side} ${trade.outcome || 'N/A'} @ $${trade.price.toFixed(4)}`);
      console.log(`   Size: ${trade.size.toFixed(2)} shares ($${(trade.size * trade.price).toFixed(2)})`);
      console.log(`   TX: ${trade.txHash?.slice(0, 20)}...`);
      // SmartMoneyTrade.timestamp is in milliseconds (poly-sdk 0.5.0)
      console.log(`   Time: ${new Date(trade.timestamp).toISOString()}`);
    },
    {
      filterAddresses: [targetAddress.toLowerCase()],
      smartMoneyOnly: false, // Track all trades from this address
    }
  );

  // Show summary every 30 seconds
  setInterval(() => {
    console.log(`\n📈 Trades detected in last 30s: ${tradeCount}`);
    tradeCount = 0;
  }, 30000);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping...');
    subscription.unsubscribe();
    console.log('✅ Stopped');
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
