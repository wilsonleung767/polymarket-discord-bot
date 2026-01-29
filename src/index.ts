import { Client, GatewayIntentBits, Events } from 'discord.js';
import {
  SmartMoneyService,
  WalletService,
  RealtimeServiceV2,
  TradingService,
  DataApiClient,
  GammaApiClient,
  SubgraphClient,
  RateLimiter,
  createUnifiedCache,
} from '@catalyst-team/poly-sdk';
import { config } from './config.js';
import { CopyTradingSession } from './copyTrading/session.js';
import { handleStartCommand, handleStopCommand, handleStatusCommand } from './commands/handlers.js';

console.log('='.repeat(60));
console.log('🤖 Polymarket Copy Trading Discord Bot');
console.log('='.repeat(60));

// Global instances
let discordClient: Client;
let realtimeService: RealtimeServiceV2;
let smartMoneyService: SmartMoneyService;
let tradingService: TradingService;
let dataApiClient: DataApiClient;
let gammaApiClient: GammaApiClient;
let copyTradingSession: CopyTradingSession;

async function main() {
  try {
    // Initialize services manually (following working script pattern)
    console.log('🔧 Initializing Polymarket services...');
    
    const cache = createUnifiedCache();
    const rateLimiter = new RateLimiter();
    dataApiClient = new DataApiClient(rateLimiter, cache);
    gammaApiClient = new GammaApiClient(rateLimiter, cache);
    const subgraph = new SubgraphClient(rateLimiter, cache);
    const walletService = new WalletService(dataApiClient, subgraph, cache);
    realtimeService = new RealtimeServiceV2();
    tradingService = new TradingService(rateLimiter, cache, {
      privateKey: config.polymarket.privateKey,
      chainId: 137,
    });

    smartMoneyService = new SmartMoneyService(
      walletService,
      realtimeService,
      tradingService
    );

    const ourAddress = tradingService.getAddress().toLowerCase();
    console.log(`  Our wallet: ${ourAddress.slice(0, 10)}...${ourAddress.slice(-6)}`);
    console.log('✅ Services initialized');

    // Connect WebSocket with explicit wait
    console.log('📡 Connecting to WebSocket...');
    realtimeService.connect();
    
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout after 10 seconds'));
      }, 10000);
      
      realtimeService.once('connected', () => {
        clearTimeout(timeout);
        console.log('✅ WebSocket connected successfully');
        resolve();
      });
    });

    // Monitor WebSocket connection status
    realtimeService.on('disconnected', () => {
      console.warn('⚠️  WebSocket disconnected! Attempting to reconnect...');
    });

    realtimeService.on('connected', () => {
      console.log('✅ WebSocket reconnected successfully');
    });

    realtimeService.on('statusChange', (status) => {
      console.log(`📡 WebSocket status: ${status}`);
    });

    // Monitor for errors
    realtimeService.on('error', (error: Error) => {
      console.error('❌ WebSocket error:', error.message);
    });

    // Initialize Discord client
    console.log('🔧 Initializing Discord client...');
    discordClient = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
      ],
    });

    // Initialize copy trading session manager
    copyTradingSession = new CopyTradingSession(
      smartMoneyService,
      tradingService,
      dataApiClient,
      gammaApiClient,
      discordClient
    );

    // Setup Discord event handlers
    discordClient.once(Events.ClientReady, (client) => {
      console.log(`✅ Discord bot logged in as ${client.user.tag}`);
      console.log('='.repeat(60));
      console.log('🚀 Bot is ready! Waiting for commands...');
      console.log('='.repeat(60));
    });

    discordClient.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      try {
        switch (interaction.commandName) {
          case 'start':
            await handleStartCommand(interaction, copyTradingSession);
            break;
          case 'stop':
            await handleStopCommand(interaction, copyTradingSession);
            break;
          case 'status':
            await handleStatusCommand(interaction, copyTradingSession);
            break;
          default:
            await interaction.reply({
              content: '❌ Unknown command',
              ephemeral: true,
            });
        }
      } catch (error) {
        console.error('Error handling interaction:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        // Try to reply or edit reply
        try {
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply({
              content: `❌ Error: ${errorMessage}`,
            });
          } else {
            await interaction.reply({
              content: `❌ Error: ${errorMessage}`,
              ephemeral: true,
            });
          }
        } catch (replyError) {
          console.error('Failed to send error message:', replyError);
        }
      }
    });

    // Login to Discord
    console.log('🔐 Logging in to Discord...');
    await discordClient.login(config.discord.token);

  } catch (error) {
    console.error('❌ Fatal error during initialization:', error);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`\n📡 Received ${signal}, shutting down gracefully...`);

  try {
    // Stop active copy trading session
    if (copyTradingSession?.isActive()) {
      console.log('🛑 Stopping active copy trading session...');
      await copyTradingSession.stop();
    }

    // Disconnect services
    if (smartMoneyService) {
      console.log('🔌 Disconnecting SmartMoney service...');
      smartMoneyService.disconnect();
    }

    if (realtimeService) {
      console.log('🔌 Disconnecting WebSocket...');
      realtimeService.disconnect();
    }

    // Destroy Discord client
    if (discordClient) {
      console.log('🔌 Disconnecting Discord client...');
      discordClient.destroy();
    }

    console.log('✅ Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
  shutdown('unhandledRejection');
});

// Start the bot
main();
