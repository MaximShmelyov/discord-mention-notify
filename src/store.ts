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
      this.logger.log(`User DB loaded: ${Object.keys(this.db).length} users`);
    } catch {
      this.db = {};
      this.logger.log('User DB not found or invalid, starting fresh');
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
      channels: [],
    };
    this.db[telegramId] = record;
    this.save();
    this.emit('change');
    return record;
  }

  addDiscordLink(telegramId: string, tag: string, discordId: string): void {
    let user = this.db[telegramId];
    if (!user) {
      user = this.createUser(telegramId);
    }
    user.discordTags.push(tag);
    user.discordIds.push(discordId);
    this.save();
    this.emit('change');
    this.emit('userLinked', telegramId);
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

  enableChannels(telegramId: string, channelIds: string[]): void {
    const user = this.db[telegramId];
    if (!user) return;

    let changed = false;
    for (const channelId of channelIds) {
      if (!user.channels.includes(channelId)) {
        user.channels.push(channelId);
        changed = true;
      }
    }

    if (changed) {
      this.save();
      this.emit('change');
    }
  }

  toggleChannel(telegramId: string, channelId: string): boolean {
    const user = this.db[telegramId];
    if (!user) return false;

    const index = user.channels.indexOf(channelId);
    if (index === -1) {
      user.channels.push(channelId);
    } else {
      user.channels.splice(index, 1);
    }

    this.save();
    this.emit('change');
    return index === -1; // true = channel was added, false = removed
  }
}
