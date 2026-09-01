import { config } from './config.js';
import { initLogger, createLogger, log } from './logger.js';
import { Store } from './store.js';
import { createTelegramBot } from './telegram.js';
import { createDiscordBot } from './discord.js';
import { startHeartbeat } from './health.js';

// Initialize logging
initLogger(config.LOGS_DIR);

const mainLogger = createLogger('MAIN');

async function main(): Promise<void> {
  // 1. Load user database
  const store = new Store(config.USER_DB_PATH, createLogger('STORE'));
  store.load();

  // 2. Start Telegram bot (store is ready, safe to handle commands)
  const telegram = createTelegramBot(config, store, createLogger('TG'));
  await telegram.startPolling();

  // 3. Start Discord bot
  const discord = createDiscordBot(config, store, telegram, createLogger('DISCORD'));
  await discord.login();

  // 4. Start health heartbeat
  const heartbeat = startHeartbeat(
    config.HEALTH_FILE_PATH,
    () => ({ discord: discord.getStatus(), telegram: telegram.isPolling() }),
    createLogger('HEALTH'),
  );

  mainLogger.log('All systems started');

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    mainLogger.log('Shutting down...');
    heartbeat.stop();
    telegram.stopPolling();
    discord.destroy();
    await store.flush();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  log(`Fatal startup error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  log(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
});
