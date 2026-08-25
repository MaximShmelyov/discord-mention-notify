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
  expectedTags: string[];
  expiresAt: number;
}

// --- Pure helpers (exported for testing) ---

export function buildChannelKeyboard(
  entries: ChannelEntry[],
  userChannels: string[],
): ReturnType<InlineKeyboardBuilder['build']> {
  const kb = new InlineKeyboardBuilder();
  for (const entry of entries) {
    const active = userChannels.includes(entry.id);
    kb.text(
      `${active ? '✅' : '❌'} ${entry.guildName} / #${entry.channelName}`,
      `toggle_${entry.id}`,
    ).row();
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

    return ctx.reply(t(loc(chatIdStr), 'telegram.list.header'), {
      reply_markup: buildChannelKeyboard(entries, user.channels),
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

  // --- Registration flow (message handler for tag input) ---

  bot.on('message', (ctx: Context) => {
    const chatId = ctx.chatId;
    const text = ctx.message?.text;
    if (chatId == null || !text) return;

    const chatIdStr = String(chatId);
    const timestamp = awaitingTags.get(chatIdStr);
    if (timestamp == null) return; // Not awaiting tags

    // Ignore if this is a command
    if (text.startsWith('/')) return;

    // Check timeout
    if (Date.now() - timestamp > REGISTRATION_TIMEOUT_MS) {
      awaitingTags.delete(chatIdStr);
      return ctx.reply(t(loc(chatIdStr), 'telegram.register.timeout'));
    }

    awaitingTags.delete(chatIdStr);

    const tags = text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (tags.length === 0) {
      return ctx.reply(t(loc(chatIdStr), 'telegram.register.invalidTags'));
    }

    const code = crypto.randomUUID().split('-')[0]!;
    pendingVerification.set(code, {
      telegramId: chatIdStr,
      expectedTags: tags,
      expiresAt: Date.now() + CODE_EXPIRY_MS,
    });

    log(`Registration requested TG=${chatIdStr}, Discord tags=${tags.join(', ')}, code=${code}`);

    return ctx.reply(t(loc(chatIdStr), 'telegram.register.sendCode', { code }));
  });

  // --- Callback query (language toggle + channel toggle) ---

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

    // --- Channel toggle ---
    const user = store.getUser(chatIdStr);
    if (!user) return;

    const channelId = cbq.data.replace('toggle_', '');
    const added = store.toggleChannel(chatIdStr, channelId);
    log(
      `${added ? '✅' : '❎'} TG=${chatIdStr} ${added ? 'enabled' : 'disabled'} channel ${channelId}`,
    );

    await ctx.answerCallbackQuery({ text: t(loc(chatIdStr), 'telegram.channel.saved') });

    const entries = availableChannels.get(chatIdStr) ?? [];
    const updatedUser = store.getUser(chatIdStr);
    if (!updatedUser || !cbq.message) return;

    try {
      await bot.api.editMessageReplyMarkup({
        chat_id: chatId,
        message_id: cbq.message.message_id,
        reply_markup: buildChannelKeyboard(entries, updatedUser.channels),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Failed to update keyboard: ${msg}`);
    }
  });

  // --- Public API ---

  function confirmDiscordCode(code: string, discordTag: string, discordId: string): string | null {
    const pending = pendingVerification.get(code);
    if (!pending) return null;

    if (Date.now() > pending.expiresAt) {
      pendingVerification.delete(code);
      return null;
    }

    if (!pending.expectedTags.includes(discordTag)) return null;

    store.addDiscordLink(pending.telegramId, discordTag, discordId);
    pendingVerification.delete(code);

    log(`✅ Linked: TG=${pending.telegramId} <-> Discord=${discordTag}`);
    bot.api
      .sendMessage({
        chat_id: Number(pending.telegramId),
        text: t(loc(pending.telegramId), 'telegram.register.confirmed', { discordTag }),
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        log(`Failed to send confirmation: ${msg}`);
      });

    return pending.telegramId;
  }

  function setAvailableChannels(telegramUserId: string, entries: ChannelEntry[]): void {
    const existing = availableChannels.get(telegramUserId) ?? [];
    availableChannels.set(telegramUserId, existing.concat(entries));
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
