export type Locale = 'ru' | 'en';

export interface UserRecord {
  discordTags: string[];
  discordIds: string[];
  channels: string[];
  locale?: Locale;
}

export interface ChannelEntry {
  guildName: string;
  channelName: string;
  id: string;
}

export type UserDB = Record<string, UserRecord>;

export interface Config {
  DISCORD_TOKEN: string;
  TELEGRAM_TOKEN: string;
  WHITELISTED_GUILDS: string[];
  USER_DB_PATH: string;
  CHANNELS_CACHE_PATH: string;
  LOGS_DIR: string;
}

export interface Logger {
  log(msg: string): void;
}

export interface TelegramBotHandle {
  confirmDiscordCode(code: string, discordTag: string, discordId: string): string | null;
  setAvailableChannels(telegramUserId: string, entries: ChannelEntry[]): void;
  sendNotification(chatId: string, text: string): Promise<void>;
  startPolling(): Promise<void>;
  stopPolling(): void;
}

export interface DiscordBotHandle {
  login(): Promise<void>;
  destroy(): void;
}
