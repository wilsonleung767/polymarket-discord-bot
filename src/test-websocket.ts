/**
 * Test Script - Verify WebSocket is receiving trades
 * 
 * Run this to test if your SDK can detect ANY trade on Polymarket
 * If this works, the issue is with address filtering, not WebSocket
 */

import dotenv from 'dotenv';
import { PolymarketSDK } from '@catalyst-team/poly-sdk';

dotenv.config();

async function main() {
  console.log('='.repeat(60));
  console.log('🧪 WebSocket Trade Detection Test');
  console.log('='.repeat(60));

  const privateKey = process.env.POLY_PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ POLY_PRIVATE_KEY not found in .env');
    process.exit(1);
  }

  console.log('🔧 Initializing SDK...');
  const sdk = await PolymarketSDK.create({ privateKey });
  
  console.log('✅ SDK initialized');
  console.log(`📡 WebSocket connected: ${sdk.realtime.isConnected?.() ? 'YES' : 'NO'}`);
  console.log('');
  console.log('👂 Listening for ALL trades on Polymarket...');
  console.log('   (Press Ctrl+C to stop)');
  console.log('='.repeat(60));

  let tradeCount = 0;

  // Subscribe to ALL activity (no filtering)
  const subscription = sdk.realtime.subscribeAllActivity({
    onTrade: (trade) => {
      tradeCount++;
      const trader = trade.trader?.address || 'Unknown';
      const traderName = trade.trader?.name || 'Anonymous';
      console.log(`\n📊 Trade #${tradeCount}:`);
      console.log(`   Trader: ${traderName} (${trader.slice(0, 10)}...)`);
      console.log(`   Market: ${trade.marketSlug || trade.conditionId?.slice(0, 10)}`);
      console.log(`   ${trade.side} ${trade.outcome} @ $${trade.price.toFixed(4)}`);
      console.log(`   Size: ${trade.size.toFixed(2)} shares ($${(trade.size * trade.price).toFixed(2)})`);
    },
    onError: (error) => {
      console.error('❌ WebSocket error:', error.message);
    },
  });

  // Show summary every 30 seconds
  setInterval(() => {
    console.log(`\n📈 Trades detected in last 30s: ${tradeCount}`);
    tradeCount = 0;
  }, 30000);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping...');
    subscription.unsubscribe();
    sdk.stop();
    console.log('✅ Stopped');
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
