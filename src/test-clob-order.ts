/**
 * CLOB Order Smoke Test
 * 
 * Tests CLOB order placement with a small test order.
 * Usage: pnpm exec tsx src/test-clob-order.ts <marketSlug> <outcome> [amount]
 * 
 * Example: pnpm exec tsx src/test-clob-order.ts will-trump-win-the-2024-presidential-election YES 1
 */

import 'dotenv/config';
import {
  GammaApiClient,
  RateLimiter,
  createUnifiedCache,
} from '@catalyst-team/poly-sdk';
import { ClobClient } from '@polymarket/clob-client';
import { PolymarketClobClient } from './polymarket/clob/client.js';
import { MarketMetadataResolver } from './polymarket/markets.js';
import { config } from './config.js';

const CLOB_HOST = config.polymarket.clobHost;
const CHAIN_ID = 137; // Polygon mainnet

async function main() {
  // Parse arguments
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: tsx src/test-clob-order.ts <marketSlug> <outcome> [usdcAmount]');
    console.error('Example: tsx src/test-clob-order.ts will-trump-win-the-2024-presidential-election YES 1');
    process.exit(1);
  }

  const marketSlug = args[0];
  const outcome = args[1];
  const usdcAmount = parseFloat(args[2] || '1');

  console.log('='.repeat(60));
  console.log('🧪 CLOB Order Smoke Test');
  console.log('='.repeat(60));
  console.log(`Market: ${marketSlug}`);
  console.log(`Outcome: ${outcome}`);
  console.log(`Amount: $${usdcAmount.toFixed(2)}`);
  console.log('='.repeat(60));

  try {
    // Initialize clients
    console.log('\n🔧 Initializing clients...');
    const cache = createUnifiedCache();
    const rateLimiter = new RateLimiter();
    const gammaClient = new GammaApiClient(rateLimiter, cache);
    
    // Raw CLOB client for metadata resolver (read-only)
    const rawClobClient = new ClobClient(CLOB_HOST, CHAIN_ID);
    
    // Authenticated CLOB client for order placement
    const clobClient = new PolymarketClobClient(
      CLOB_HOST,
      CHAIN_ID,
      config.polymarket.privateKey,
      config.polymarket.funderAddress,
      config.polymarket.signatureType
    );

    await clobClient.initialize();
    console.log(`✅ CLOB client initialized`);
    console.log(`   Wallet: ${clobClient.getAddress()}`);

    // Resolve market metadata
    console.log(`\n🔍 Resolving market metadata for ${marketSlug}...`);
    const marketResolver = new MarketMetadataResolver(gammaClient, rawClobClient);
    const metadata = await marketResolver.resolve(marketSlug, outcome);

    console.log(`✅ Market resolved:`);
    console.log(`   Question: ${metadata.question}`);
    console.log(`   Token ID: ${metadata.tokenID}`);
    console.log(`   Tick Size: ${metadata.tickSize}`);
    console.log(`   Neg Risk: ${metadata.negRisk}`);
    console.log(`   Condition ID: ${metadata.conditionId}`);

    // Get current market price
    console.log(`\n📊 Fetching current market price...`);
    const midpoint = await rawClobClient.getMidpoint(metadata.tokenID);
    const currentPrice = midpoint ? parseFloat(midpoint) : 0.5;
    console.log(`   Midpoint: $${currentPrice.toFixed(4)}`);

    // Calculate order parameters
    const size = usdcAmount / currentPrice;
    const tickSize = parseFloat(metadata.tickSize);
    const adjustedPrice = Math.round(currentPrice / tickSize) * tickSize;

    console.log(`\n💱 Order parameters:`);
    console.log(`   Size: ${size.toFixed(2)} shares`);
    console.log(`   Price: $${adjustedPrice.toFixed(4)} (rounded to tick size)`);
    console.log(`   Total: $${(size * adjustedPrice).toFixed(2)}`);

    // Ask for confirmation
    console.log(`\n⚠️  This will place a REAL order on Polymarket!`);
    console.log(`   Type 'yes' to confirm or anything else to cancel:`);

    // Wait for user input
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const confirmation = await new Promise<string>((resolve) => {
      rl.question('> ', (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase());
      });
    });

    if (confirmation !== 'yes') {
      console.log('\n❌ Test cancelled by user');
      process.exit(0);
    }

    // Place order
    console.log(`\n📤 Placing order...`);
    const orderResult = await clobClient.placeOrder({
      tokenID: metadata.tokenID,
      side: 'BUY',
      price: adjustedPrice,
      size,
      tickSize: metadata.tickSize,
      negRisk: metadata.negRisk,
      orderType: 'GTC', // Use GTC for testing
    });

    if (orderResult.success) {
      console.log(`\n✅ Order placed successfully!`);
      console.log(`   Order ID: ${orderResult.orderId}`);
      if (orderResult.transactionHash) {
        console.log(`   TX Hash: ${orderResult.transactionHash}`);
        console.log(`   View on PolygonScan: https://polygonscan.com/tx/${orderResult.transactionHash}`);
      }
    } else {
      console.log(`\n❌ Order placement failed`);
      console.log(`   Error: ${orderResult.error}`);
      process.exit(1);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ Smoke test completed successfully!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main();
