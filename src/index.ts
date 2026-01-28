import { Client, GatewayIntentBits, Events } from 'discord.js';
import { PolymarketSDK } from '@catalyst-team/poly-sdk';
import { config } from './config.js';
import { CopyTradingSession } from './copyTrading/session.js';
import { handleStartCommand, handleStopCommand, handleStatusCommand } from './commands/handlers.js';

console.log('='.repeat(60));
console.log('🤖 Polymarket Copy Trading Discord Bot');
console.log('='.repeat(60));

// Global instances
let discordClient: Client;
let polymarketSDK: PolymarketSDK;
let copyTradingSession: CopyTradingSession;

async function main() {
  try {
    // Initialize Polymarket SDK
    console.log('🔧 Initializing Polymarket SDK...');
    polymarketSDK = await PolymarketSDK.create({
      privateKey: config.polymarket.privateKey,
    });
    console.log('✅ Polymarket SDK initialized and connected');
    
    // Verify WebSocket connection
    if (polymarketSDK.realtime.isConnected?.()) {
      console.log('✅ WebSocket connection active');
    } else {
      console.warn('⚠️  WebSocket not connected - trades may not be detected');
    }

    // Monitor WebSocket connection status
    polymarketSDK.realtime.on('disconnected', () => {
      console.warn('⚠️  WebSocket disconnected! Attempting to reconnect...');
    });

    polymarketSDK.realtime.on('connected', () => {
      console.log('✅ WebSocket reconnected successfully');
    });

    polymarketSDK.realtime.on('statusChange', (status) => {
      console.log(`📡 WebSocket status: ${status}`);
    });

    // Monitor for errors (including rate limiting)
    polymarketSDK.realtime.on('error', (error: Error) => {
      if (error.message.includes('429')) {
        console.error('🚫 RATE LIMITED! Too many connections. Waiting 60 seconds before retry...');
        console.error('💡 Tip: Make sure you only have ONE bot instance running.');
        console.error('   Run kill-bot.bat to stop all Node processes, then restart.');
      } else {
        console.error('❌ WebSocket error:', error.message);
      }
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
    copyTradingSession = new CopyTradingSession(polymarketSDK, discordClient);

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

    // Disconnect Polymarket SDK
    if (polymarketSDK) {
      console.log('🔌 Disconnecting Polymarket SDK...');
      polymarketSDK.stop();
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
