import fs from 'node:fs';
import { Client, GatewayIntentBits, Partials, PermissionsBitField, ChannelType } from 'discord.js';
import type { Message, Guild } from 'discord.js';
import { DEFAULT_LOCALE, t, verificationCodeRegexAnyLocale } from './i18n.js';
import type {
  Locale,
  Config,
  Logger,
  ChannelEntry,
  TelegramBotHandle,
  DiscordBotHandle,
} from './types.js';
import type { Store } from './store.js';

// --- Pure helper (exported for testing) ---

export function formatMentionMessage(message: Message, locale: Locale): string {
  let messageText = message.content;
  message.mentions.users.forEach((mentionedUser) => {
    const mentionRegex = new RegExp(`<@!?${mentionedUser.id}>`, 'g');
    messageText = messageText.replace(
      mentionRegex,
      `@${mentionedUser.displayName}(${mentionedUser.tag})`,
    );
  });

  const guild = message.guild!;
  const channelName =
    message.channel.isTextBased() && 'name' in message.channel
      ? message.channel.name
      : t(locale, 'discord.mention.unknownChannel');
  return [
    t(locale, 'discord.mention.title'),
    `${guild.name}#${channelName}`,
    ``,
    `${message.author.displayName}(${message.author.tag}): ${messageText}`,
  ].join('\n');
}

// --- Factory ---

export function createDiscordBot(
  config: Config,
  store: Store,
  telegram: TelegramBotHandle,
  logger: Logger,
): DiscordBotHandle {
  const log = logger.log.bind(logger);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });

  // --- Channel cache (persists across ready / userLinked) ---
  let channelCache: Record<string, ChannelEntry[]> = {};

  // --- Load cached channels on startup ---
  function loadCachedChannels(): void {
    try {
      const raw = fs.readFileSync(config.CHANNELS_CACHE_PATH, 'utf-8');
      channelCache = JSON.parse(raw) as Record<string, ChannelEntry[]>;
      for (const telegramUserId of Object.keys(store.getAll())) {
        for (const entries of Object.values(channelCache)) {
          telegram.setAvailableChannels(telegramUserId, entries);
        }
      }
      log('Cached channels loaded');
    } catch {
      log('No cached channels found');
    }
  }

  // --- Push channels to newly linked users ---
  store.on('userLinked', (telegramId: string) => {
    for (const entries of Object.values(channelCache)) {
      telegram.setAvailableChannels(telegramId, entries);
    }
    log(`📡 Channels pushed to newly linked user TG=${telegramId}`);
  });

  /** Resolve the locale for a Discord user via reverse lookup. */
  function discordUserLocale(discordId: string): Locale {
    const telegramId = store.findTelegramIdByDiscordId(discordId);
    return telegramId ? store.getUserLocale(telegramId) : DEFAULT_LOCALE;
  }

  // --- Event handlers ---

  client.once('ready', async () => {
    log(`✅ Bot started as ${client.user?.tag}`);

    for (const guild of client.guilds.cache.values()) {
      const isWhitelisted = config.WHITELISTED_GUILDS.includes(guild.id);
      log(`Guild loaded: ${guild.id}, whitelisted: ${isWhitelisted}`);
      if (!isWhitelisted) continue;

      try {
        const fullGuild: Guild = await guild.fetch();
        const channels = await guild.channels.fetch();
        const botMember = await guild.members.fetchMe();

        const textChannels = [...channels.values()].filter((ch) => {
          return (
            ch !== null &&
            ch.isTextBased() &&
            ch.type === ChannelType.GuildText &&
            ch.viewable &&
            ch.permissionsFor(botMember)?.has(PermissionsBitField.Flags.ViewChannel)
          );
        });

        const entries: ChannelEntry[] = textChannels.map((ch) => ({
          guildName: fullGuild.name,
          channelName: ch!.name,
          id: ch!.id,
        }));

        for (const telegramUserId of Object.keys(store.getAll())) {
          telegram.setAvailableChannels(telegramUserId, entries);
        }
        channelCache[guild.id] = entries;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`Failed to load channels for guild ${guild.id}: ${msg}`);
      }
    }

    try {
      fs.writeFileSync(config.CHANNELS_CACHE_PATH, JSON.stringify(channelCache, null, 2));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Failed to save channel cache: ${msg}`);
    }
  });

  client.on('messageCreate', async (message: Message) => {
    try {
      if (message.author.bot) return;

      const content = message.content.trim();
      const match = content.match(verificationCodeRegexAnyLocale());

      if (match) {
        if (message.channel.type !== ChannelType.DM) {
          const locale = discordUserLocale(message.author.id);
          await message.reply(t(locale, 'discord.verification.dmOnly'));
          return;
        }

        const code = match[1]!;
        const discordTag = message.author.tag;
        const discordId = message.author.id;

        const telegramId = telegram.confirmDiscordCode(code, discordTag, discordId);
        if (telegramId) {
          const locale = store.getUserLocale(telegramId);
          await message.reply(t(locale, 'discord.verification.success'));
        } else {
          const locale = discordUserLocale(discordId);
          await message.reply(t(locale, 'discord.verification.invalid'));
        }
        return;
      }

      const guild = message.guild;
      if (!guild || !config.WHITELISTED_GUILDS.includes(guild.id)) return;

      const mentions = message.mentions.users;
      if (mentions.size === 0) return;

      const users = store.getAll();
      for (const [telegramUserId, userRecord] of Object.entries(users)) {
        for (const discordAcctId of userRecord.discordIds) {
          if (mentions.has(discordAcctId) && userRecord.channels.includes(message.channel.id)) {
            const locale = store.getUserLocale(telegramUserId);
            const notify = formatMentionMessage(message, locale);
            await telegram.sendNotification(telegramUserId, notify);
            log(`📤 Notification sent for ${telegramUserId}`);
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Error in messageCreate: ${msg}`);
    }
  });

  // --- Connection monitoring ---

  client.on('error', (err: Error) => log(`Discord error: ${err.message}`));
  client.on('warn', (msg: string) => log(`Discord warning: ${msg}`));

  // --- Public API ---

  async function login(): Promise<void> {
    loadCachedChannels();
    await client.login(config.DISCORD_TOKEN);
  }

  function destroy(): void {
    client.destroy();
    log('Discord client destroyed');
  }

  return { login, destroy };
}
