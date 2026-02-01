import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';

const commands = [
  new SlashCommandBuilder()
    .setName('start')
    .setDescription('Start copy trading for a specific wallet address')
    .addStringOption(option =>
      option
        .setName('target')
        .setDescription('The wallet address to copy trade (0x...)')
        .setRequired(true)
    )
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to post trade signals (defaults to current channel)')
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option
        .setName('dryrun')
        .setDescription('Dry run mode (no real trades, default: true)')
        .setRequired(false)
    )
    .addNumberOption(option =>
      option
        .setName('sizescale')
        .setDescription('Size scale (e.g., 0.1 for 10%, default: 0.1)')
        .setMinValue(0.01)
        .setMaxValue(1.0)
        .setRequired(false)
    )
    .addNumberOption(option =>
      option
        .setName('maxsize')
        .setDescription('Max USDC per trade (default: 10)')
        .setMinValue(1)
        .setRequired(false)
    )
    .addNumberOption(option =>
      option
        .setName('slippage')
        .setDescription('Max slippage (e.g., 0.03 for 3%, default: 0.03)')
        .setMinValue(0.001)
        .setMaxValue(0.5)
        .setRequired(false)
    )
    .addNumberOption(option =>
      option
        .setName('minsize')
        .setDescription('Min trade size to copy (USDC, default: 5)')
        .setMinValue(1)
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('ordertype')
        .setDescription('Order type (default: FOK)')
        .addChoices(
          { name: 'FOK (Fill or Kill)', value: 'FOK' },
          { name: 'FAK (Fill and Kill)', value: 'FAK' }
        )
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('categories')
        .setDescription('Market categories to filter (comma-separated, e.g., "crypto,sports")')
        .setRequired(false)
    )
    .addNumberOption(option =>
      option
        .setName('totallimit')
        .setDescription('Total USDC limit for session (stops when reached, default: unlimited)')
        .setMinValue(1)
        .setRequired(false)
    )
    .addNumberOption(option =>
      option
        .setName('maxodds')
        .setDescription('Max odds (price) for BUY trades (0.01-0.99, e.g., 0.75 for 75%)')
        .setMinValue(0.01)
        .setMaxValue(0.99)
        .setRequired(false)
    )
    .addNumberOption(option =>
      option
        .setName('marketlimit')
        .setDescription('Max total USDC per market (BUY trades only, default: unlimited)')
        .setMinValue(1)
        .setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop the active copy trading session')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check the status of the active copy trading session')
    .toJSON(),
];

async function registerCommands() {
  try {
    console.log('Started refreshing application (/) commands.');

    const rest = new REST().setToken(config.discord.token);

    if (config.discord.guildId) {
      // Register to a specific guild (instant update, for development)
      console.log(`Registering commands to guild: ${config.discord.guildId}`);
      await rest.put(
        Routes.applicationGuildCommands(config.discord.appId, config.discord.guildId),
        { body: commands }
      );
      console.log('Successfully registered guild commands.');
    } else {
      // Register globally (takes up to 1 hour to propagate)
      console.log('Registering commands globally...');
      await rest.put(
        Routes.applicationCommands(config.discord.appId),
        { body: commands }
      );
      console.log('Successfully registered global commands.');
    }
  } catch (error) {
    console.error('Error registering commands:', error);
    process.exit(1);
  }
}

registerCommands();
