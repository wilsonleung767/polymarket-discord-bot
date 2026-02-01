import dotenv from 'dotenv';

dotenv.config();

export interface BotConfig {
  discord: {
    token: string;
    appId: string;
    guildId?: string;
    defaultChannelId?: string;
  };
  polymarket: {
    privateKey: string;
    funderAddress: string;
    signatureType: number;
    clobHost: string;
  };
  trading: {
    sizeScale: number;
    maxSizePerTrade: number;
    maxSlippage: number;
    minTradeSize: number;
    orderType: 'FOK' | 'FAK';
  };
}

function getEnv(key: string, required: boolean = true): string | undefined {
  const value = process.env[key];
  if (required && !value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
  if (isNaN(parsed)) {
    throw new Error(`Invalid number for ${key}: ${value}`);
  }
  return parsed;
}

export const config: BotConfig = {
  discord: {
    token: getEnv('DISCORD_TOKEN')!,
    appId: getEnv('DISCORD_APP_ID')!,
    guildId: getEnv('GUILD_ID', false),
    defaultChannelId: getEnv('DEFAULT_CHANNEL_ID', false),
  },
  polymarket: {
    privateKey: getEnv('POLY_PRIVATE_KEY')!,
    funderAddress: getEnv('POLY_FUNDER')!,
    signatureType: getEnvNumber('POLY_SIGNATURE_TYPE', 1),
    clobHost: getEnv('POLY_CLOB_HOST', false) || 'https://clob.polymarket.com',
  },
  trading: {
    sizeScale: getEnvNumber('SIZE_SCALE', 0.1),
    maxSizePerTrade: getEnvNumber('MAX_SIZE_PER_TRADE', 10),
    maxSlippage: getEnvNumber('MAX_SLIPPAGE', 0.03),
    minTradeSize: getEnvNumber('MIN_TRADE_SIZE', 5),
    orderType: (getEnv('ORDER_TYPE', false) || 'FOK') as 'FOK' | 'FAK',
  },
};

