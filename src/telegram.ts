import crypto from 'node:crypto';
import { Bot, InlineKeyboardBuilder } from 'node-telegram-bot-api';
import type { Context } from 'node-telegram-bot-api';
import { t } from './i18n.js';
import type { Locale, Config, Logger, ChannelEntry, TelegramBotHandle } from './types.js';
import type { Store } from './store.js';

const REGISTRATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

interface PendingVerification {
  telegramId: string;
  expectedTag: string;
  expiresAt: number;
}

// --- Pure helpers (exported for testing) ---

export function mergeChannelEntries(
  existing: ChannelEntry[],
  incoming: ChannelEntry[],
): ChannelEntry[] {
  const seen = new Set(existing.map((e) => e.id));
  const unique = incoming.filter((e) => !seen.has(e.id));
  return existing.concat(unique);
}

export function buildChannelKeyboard(
  entries: ChannelEntry[],
  enabledChannels: string[],
  discordId: string,
  showBack: boolean,
): ReturnType<InlineKeyboardBuilder['build']> {
  const kb = new InlineKeyboardBuilder();
  for (const entry of entries) {
    const active = enabledChannels.includes(entry.id);
    kb.text(
      `${active ? '✅' : '❌'} ${entry.guildName} / #${entry.channelName}`,
      `ch_${discordId}_${entry.id}`,
    ).row();
  }
  if (showBack) {
    kb.text('← Back', 'back_accts').row();
  }
  return kb.build();
}

export function buildAccountKeyboard(
  discordTags: string[],
  discordIds: string[],
): ReturnType<InlineKeyboardBuilder['build']> {
  const kb = new InlineKeyboardBuilder();
  for (let i = 0; i < discordIds.length; i++) {
    kb.text(`👤 ${discordTags[i]}`, `acct_${discordIds[i]}`).row();
  }
  return kb.build();
}

export function buildLangKeyboard(
  currentLocale: Locale,
): ReturnType<InlineKeyboardBuilder['build']> {
  const kb = new InlineKeyboardBuilder();
  kb.text(currentLocale === 'en' ? '✅ English' : 'English', 'lang_en').row();
  kb.text(currentLocale === 'ru' ? '✅ Русский' : 'Русский', 'lang_ru').row();
  return kb.build();
}

// --- Factory ---

const KNOWN_COMMANDS = new Set(['start', 'register', 'list', 'lang', 'help']);

export function createTelegramBot(config: Config, store: Store, logger: Logger): TelegramBotHandle {
  const bot = new Bot(config.TELEGRAM_TOKEN);
  const log = logger.log.bind(logger);

  /** Shorthand: resolve the locale for a Telegram user. */
  const loc = (telegramId: string): Locale => store.getUserLocale(telegramId);

  const pendingVerification = new Map<string, PendingVerification>();
  const awaitingTags = new Map<string, number>(); // chatId -> timestamp
  const availableChannels = new Map<string, ChannelEntry[]>();

  // Periodic cleanup of expired verification codes
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [code, pending] of pendingVerification) {
      if (now > pending.expiresAt) {
        pendingVerification.delete(code);
      }
    }
    for (const [chatId, ts] of awaitingTags) {
      if (now - ts > REGISTRATION_TIMEOUT_MS) {
        awaitingTags.delete(chatId);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();

  // --- Error boundary ---
  bot.catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Telegram error: ${msg}`);
  });

  // --- Commands ---

  bot.command('start', (ctx: Context) => {
    const chatIdStr = String(ctx.chatId);
    log(`/start from ${ctx.from?.username ?? ctx.chatId}`);
    return ctx.reply(t(loc(chatIdStr), 'telegram.start'));
  });

  bot.command('register', (ctx: Context) => {
    const chatId = ctx.chatId;
    if (chatId == null) return;
    const chatIdStr = String(chatId);
    log(`/register from ${ctx.from?.username ?? chatId}`);
    awaitingTags.set(chatIdStr, Date.now());
    return ctx.reply(t(loc(chatIdStr), 'telegram.register.prompt'));
  });

  bot.command('list', (ctx: Context) => {
    const chatId = ctx.chatId;
    if (chatId == null) return;
    const chatIdStr = String(chatId);
    log(`/list from ${ctx.from?.username ?? chatId}`);

    const user = store.getUser(chatIdStr);
    if (!user) {
      return ctx.reply(t(loc(chatIdStr), 'telegram.list.notRegistered'));
    }

    const entries = availableChannels.get(chatIdStr);
    if (!entries || entries.length === 0) {
      return ctx.reply(t(loc(chatIdStr), 'telegram.list.noChannels'));
    }

    // Single account — go directly to channel list
    if (user.discordIds.length === 1) {
      const discordId = user.discordIds[0]!;
      const accountChannels = store.getAccountChannels(chatIdStr, discordId);
      return ctx.reply(t(loc(chatIdStr), 'telegram.list.header'), {
        reply_markup: buildChannelKeyboard(entries, accountChannels, discordId, false),
      });
    }

    // Multiple accounts — show account selector
    return ctx.reply(t(loc(chatIdStr), 'telegram.list.selectAccount'), {
      reply_markup: buildAccountKeyboard(user.discordTags, user.discordIds),
    });
  });

  bot.command('lang', (ctx: Context) => {
    const chatId = ctx.chatId;
    if (chatId == null) return;
    const chatIdStr = String(chatId);
    log(`/lang from ${ctx.from?.username ?? chatId}`);
    return ctx.reply(t(loc(chatIdStr), 'telegram.lang.prompt'), {
      reply_markup: buildLangKeyboard(loc(chatIdStr)),
    });
  });

  bot.command('help', (ctx: Context) => {
    const chatIdStr = String(ctx.chatId);
    log(`/help from ${ctx.from?.username ?? ctx.chatId}`);
    return ctx.reply(t(loc(chatIdStr), 'telegram.help'));
  });

  // --- Registration flow (message handler for tag input) ---

  bot.on('message', (ctx: Context) => {
    const chatId = ctx.chatId;
    const text = ctx.message?.text;
    if (chatId == null || !text) return;

    const chatIdStr = String(chatId);
    const timestamp = awaitingTags.get(chatIdStr);
    if (timestamp == null) return; // Not awaiting tags

    // Handle commands — known ones are processed by bot.command(),
    // unknown ones get an error reply
    if (text.startsWith('/')) {
      const command = text.split(/[\s@]/)[0]!.slice(1).toLowerCase();
      if (!KNOWN_COMMANDS.has(command)) {
        return ctx.reply(t(loc(chatIdStr), 'telegram.unknownCommand'));
      }
      return;
    }

    // Check timeout
    if (Date.now() - timestamp > REGISTRATION_TIMEOUT_MS) {
      awaitingTags.delete(chatIdStr);
      return ctx.reply(t(loc(chatIdStr), 'telegram.register.timeout'));
    }

    awaitingTags.delete(chatIdStr);

    const tag = text.trim();
    if (tag.length === 0 || tag.includes(',')) {
      return ctx.reply(t(loc(chatIdStr), 'telegram.register.invalidTag'));
    }

    const code = crypto.randomUUID().split('-')[0]!;
    pendingVerification.set(code, {
      telegramId: chatIdStr,
      expectedTag: tag,
      expiresAt: Date.now() + CODE_EXPIRY_MS,
    });

    log(`Registration requested TG=${chatIdStr}, Discord tag=${tag}, code=${code}`);

    return ctx.reply(t(loc(chatIdStr), 'telegram.register.sendCode', { code }));
  });

  // --- Callback query (language toggle + channel toggle + account selection) ---

  bot.on('callback_query', async (ctx: Context) => {
    const cbq = ctx.callbackQuery;
    if (!cbq?.data) return;

    const chatId = ctx.chatId;
    if (chatId == null) return;
    const chatIdStr = String(chatId);

    // --- Language selection ---
    if (cbq.data.startsWith('lang_')) {
      const newLocale = cbq.data.replace('lang_', '');
      if (newLocale !== 'en' && newLocale !== 'ru') return;

      store.setUserLocale(chatIdStr, newLocale);
      log(`🌐 TG=${chatIdStr} changed language to ${newLocale}`);

      await ctx.answerCallbackQuery({ text: t(newLocale, 'telegram.lang.saved') });

      if (cbq.message) {
        try {
          await bot.api.editMessageReplyMarkup({
            chat_id: chatId,
            message_id: cbq.message.message_id,
            reply_markup: buildLangKeyboard(newLocale),
          });
        } catch {
          /* ignore edit errors (e.g. message not modified) */
        }
      }
      return;
    }

    const user = store.getUser(chatIdStr);
    if (!user) return;

    // --- Account selection (multi-account → show channels for chosen account) ---
    if (cbq.data.startsWith('acct_')) {
      const discordId = cbq.data.slice('acct_'.length);
      const tagIndex = user.discordIds.indexOf(discordId);
      if (tagIndex === -1) return;

      const discordTag = user.discordTags[tagIndex]!;
      const entries = availableChannels.get(chatIdStr) ?? [];
      const accountChannels = store.getAccountChannels(chatIdStr, discordId);

      await ctx.answerCallbackQuery();

      if (cbq.message) {
        try {
          await bot.api.editMessageText({
            chat_id: chatId,
            message_id: cbq.message.message_id,
            text: t(loc(chatIdStr), 'telegram.list.accountHeader', { discordTag }),
            reply_markup: buildChannelKeyboard(entries, accountChannels, discordId, true),
          });
        } catch {
          /* ignore edit errors */
        }
      }
      return;
    }

    // --- Back to account list ---
    if (cbq.data === 'back_accts') {
      await ctx.answerCallbackQuery();

      if (cbq.message) {
        try {
          await bot.api.editMessageText({
            chat_id: chatId,
            message_id: cbq.message.message_id,
            text: t(loc(chatIdStr), 'telegram.list.selectAccount'),
            reply_markup: buildAccountKeyboard(user.discordTags, user.discordIds),
          });
        } catch {
          /* ignore edit errors */
        }
      }
      return;
    }

    // --- Channel toggle (ch_{discordId}_{channelId}) ---
    if (cbq.data.startsWith('ch_')) {
      const rest = cbq.data.slice('ch_'.length);
      const sepIdx = rest.indexOf('_');
      if (sepIdx === -1) return;
      const discordId = rest.slice(0, sepIdx);
      const channelId = rest.slice(sepIdx + 1);

      const added = store.toggleChannel(chatIdStr, discordId, channelId);
      log(
        `${added ? '✅' : '❎'} TG=${chatIdStr} Discord=${discordId} ${added ? 'enabled' : 'disabled'} channel ${channelId}`,
      );

      await ctx.answerCallbackQuery({ text: t(loc(chatIdStr), 'telegram.channel.saved') });

      const entries = availableChannels.get(chatIdStr) ?? [];
      const accountChannels = store.getAccountChannels(chatIdStr, discordId);
      const showBack = user.discordIds.length > 1;

      if (cbq.message) {
        try {
          await bot.api.editMessageReplyMarkup({
            chat_id: chatId,
            message_id: cbq.message.message_id,
            reply_markup: buildChannelKeyboard(entries, accountChannels, discordId, showBack),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log(`Failed to update keyboard: ${msg}`);
        }
      }
      return;
    }
  });

  // --- Public API ---

  function confirmDiscordCode(
    code: string,
    discordTag: string,
    discordId: string,
    discordUsername: string,
  ): string | null {
    const pending = pendingVerification.get(code);
    if (!pending) return null;

    if (Date.now() > pending.expiresAt) {
      pendingVerification.delete(code);
      return null;
    }

    const expected = pending.expectedTag;
    if (expected !== discordTag && expected !== discordUsername) return null;

    const added = store.addDiscordLink(pending.telegramId, discordTag, discordId);
    pendingVerification.delete(code);

    const messageKey = added ? 'telegram.register.confirmed' : 'telegram.register.alreadyLinked';

    log(
      added
        ? `✅ Linked: TG=${pending.telegramId} <-> Discord=${discordTag}`
        : `⚠️ Already linked: TG=${pending.telegramId} <-> Discord=${discordTag}`,
    );
    bot.api
      .sendMessage({
        chat_id: Number(pending.telegramId),
        text: t(loc(pending.telegramId), messageKey, { discordTag }),
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        log(`Failed to send confirmation: ${msg}`);
      });

    return pending.telegramId;
  }

  function setAvailableChannels(telegramUserId: string, entries: ChannelEntry[]): void {
    const existing = availableChannels.get(telegramUserId) ?? [];
    availableChannels.set(telegramUserId, mergeChannelEntries(existing, entries));
    log(
      `📡 Channels updated for TG=${telegramUserId} (${availableChannels.get(telegramUserId)!.length} total)`,
    );
  }

  async function sendNotification(chatId: string, text: string): Promise<void> {
    try {
      await bot.api.sendMessage({ chat_id: Number(chatId), text });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Failed to send notification to ${chatId}: ${msg}`);
    }
  }

  async function startPolling(): Promise<void> {
    // Start polling in background (don't await — it resolves when stopped)
    bot.startPolling().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Polling error: ${msg}`);
    });
    log('Telegram bot polling started');
  }

  function stopPolling(): void {
    clearInterval(cleanupTimer);
    bot.stop();
    log('Telegram bot stopped');
  }

  return {
    confirmDiscordCode,
    setAvailableChannels,
    sendNotification,
    startPolling,
    stopPolling,
  };
}
