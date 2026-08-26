import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { DEFAULT_LOCALE } from './i18n.js';
import type { Locale, UserRecord, UserDB, Logger } from './types.js';

export class Store extends EventEmitter {
  private db: UserDB = {};
  private readonly filePath: string;
  private readonly logger: Logger;

  constructor(filePath: string, logger: Logger) {
    super();
    this.filePath = filePath;
    this.logger = logger;
  }

  load(): void {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      this.db = JSON.parse(raw) as UserDB;
      this.migrateChannels();
      this.logger.log(`User DB loaded: ${Object.keys(this.db).length} users`);
    } catch {
      this.db = {};
      this.logger.log('User DB not found or invalid, starting fresh');
    }
  }

  /**
   * Migrate legacy flat `channels: string[]` to per-account
   * `channels: Record<string, string[]>`.  Each linked Discord account
   * inherits the old channel list so no subscriptions are lost.
   */
  private migrateChannels(): void {
    let migrated = false;
    for (const user of Object.values(this.db)) {
      if (Array.isArray(user.channels)) {
        const oldChannels = user.channels as unknown as string[];
        const perAccount: Record<string, string[]> = {};
        for (const discordId of user.discordIds) {
          perAccount[discordId] = [...oldChannels];
        }
        user.channels = perAccount;
        migrated = true;
      }
    }
    if (migrated) {
      this.save();
      this.logger.log('Migrated channels from flat array to per-account format');
    }
  }

  save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.db, null, 2));
    } catch (error) {
      this.logger.log(
        `Failed to save user DB: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  getAll(): UserDB {
    return { ...this.db };
  }

  getUser(telegramId: string): UserRecord | undefined {
    return this.db[telegramId];
  }

  hasUser(telegramId: string): boolean {
    return telegramId in this.db;
  }

  createUser(telegramId: string): UserRecord {
    const record: UserRecord = {
      discordTags: [],
      discordIds: [],
      channels: {},
    };
    this.db[telegramId] = record;
    this.save();
    this.emit('change');
    return record;
  }

  addDiscordLink(telegramId: string, tag: string, discordId: string): boolean {
    let user = this.db[telegramId];
    if (!user) {
      user = this.createUser(telegramId);
    }

    // Prevent duplicate Discord accounts for the same Telegram user
    if (user.discordIds.includes(discordId)) {
      return false;
    }

    user.discordTags.push(tag);
    user.discordIds.push(discordId);
    user.channels[discordId] = [];
    this.save();
    this.emit('change');
    this.emit('userLinked', telegramId, discordId);
    return true;
  }

  removeDiscordLink(telegramId: string, discordId: string): boolean {
    const user = this.db[telegramId];
    if (!user) return false;

    const index = user.discordIds.indexOf(discordId);
    if (index === -1) return false;

    user.discordIds.splice(index, 1);
    user.discordTags.splice(index, 1);
    Reflect.deleteProperty(user.channels, discordId);
    this.save();
    this.emit('change');
    return true;
  }

  getAccountChannels(telegramId: string, discordId: string): string[] {
    return this.db[telegramId]?.channels[discordId] ?? [];
  }

  getUserLocale(telegramId: string): Locale {
    return this.db[telegramId]?.locale ?? DEFAULT_LOCALE;
  }

  setUserLocale(telegramId: string, locale: Locale): void {
    if (!this.db[telegramId]) {
      this.createUser(telegramId);
    }
    this.db[telegramId]!.locale = locale;
    this.save();
    this.emit('change');
  }

  findTelegramIdByDiscordId(discordId: string): string | undefined {
    for (const [telegramId, record] of Object.entries(this.db)) {
      if (record.discordIds.includes(discordId)) {
        return telegramId;
      }
    }
    return undefined;
  }

  enableChannels(telegramId: string, discordId: string, channelIds: string[]): void {
    const user = this.db[telegramId];
    if (!user) return;

    if (!user.channels[discordId]) {
      user.channels[discordId] = [];
    }

    let changed = false;
    for (const channelId of channelIds) {
      if (!user.channels[discordId]!.includes(channelId)) {
        user.channels[discordId]!.push(channelId);
        changed = true;
      }
    }

    if (changed) {
      this.save();
      this.emit('change');
    }
  }

  toggleChannel(telegramId: string, discordId: string, channelId: string): boolean {
    const user = this.db[telegramId];
    if (!user) return false;

    if (!user.channels[discordId]) {
      user.channels[discordId] = [];
    }

    const arr = user.channels[discordId]!;
    const index = arr.indexOf(channelId);
    if (index === -1) {
      arr.push(channelId);
    } else {
      arr.splice(index, 1);
    }

    this.save();
    this.emit('change');
    return index === -1; // true = channel was added, false = removed
  }
}
