# Discord Mention Notify

A bot that forwards @mention notifications from Discord to Telegram. Users link their accounts through a verification flow, pick which channels to track, and get a Telegram push whenever they are mentioned.

## Quick Start

### Prerequisites

- **Node.js ≥ 24** (runs `.ts` natively via type stripping)
- A Discord bot with intents enabled: `Guilds`, `GuildMessages`, `MessageContent`, `DirectMessages`
- A Telegram bot (create one via [@BotFather](https://t.me/BotFather))

### Setup

```bash
git clone <repo-url> && cd discord-mention-notify
npm install
cp .env.example .env
```

Fill in `.env`:

```env
DISCORD_TOKEN=your_discord_bot_token
TELEGRAM_TOKEN=your_telegram_bot_token
WHITELISTED_GUILDS=server_id_1,server_id_2
```

### Run

```bash
npm start          # production
npm run dev        # auto-restart on file changes
```

### Docker (local build)

```bash
docker compose up -d --build
```

## Deployment (Portainer)

The CI pipeline publishes a Docker image to GHCR on every tagged release. To deploy via Portainer:

1. Go to **Stacks → Add stack**
2. Paste the contents of [`docker-compose.portainer.yml`](docker-compose.portainer.yml)
3. Set the environment variables: `DISCORD_TOKEN`, `TELEGRAM_TOKEN`, `WHITELISTED_GUILDS`
4. Deploy

The image tag defaults to `latest`. Pin a specific version by setting `IMAGE_TAG` (e.g. `1.0.0`).

Persistent data (user database, channel cache, logs) lives in the `app-data` named volume at `/app/data`.

## CI/CD

Two GitHub Actions workflows:

| Workflow    | Trigger                 | What it does                                                |
| ----------- | ----------------------- | ----------------------------------------------------------- |
| **CI**      | Every push/PR to `main` | Prettier → ESLint → Typecheck → Tests                       |
| **Publish** | Tag push (`v*`)         | Runs CI, then builds and pushes a Docker image to `ghcr.io` |

To release a new version:

```bash
git tag v1.0.0
git push origin v1.0.0
```

This triggers the full CI pipeline and, on success, publishes the image as `ghcr.io/maximshmelyov/discord-mention-notify:1.0.0` and `:latest`.

## How It Works

### Registration

1. User sends `/register` to the Telegram bot
2. Enters their Discord username (e.g. `username`) or legacy tag (e.g. `user#1234`) — one account at a time
3. Receives a one-time verification code
4. Sends `VERIFICATION CODE: <code>` (or `КОД ПОДТВЕРЖДЕНИЯ: <code>`) as a **DM to the Discord bot**
5. Account is linked ✅

To link multiple Discord accounts, repeat `/register` for each one. Duplicate accounts are detected and rejected. Use `/unregister` to remove a linked account.

### Channel Tracking

The `/list` command in Telegram lets you manage channel subscriptions per Discord account:

- **Single account** — shows a channel list with ✅/❌ toggles directly
- **Multiple accounts** — shows an account picker first; tap an account to see its channels, use ← Back to return

Each Discord account has its own set of enabled channels, so you can track different channels for different accounts.

### Notifications

When a tracked user is @mentioned in a tracked channel, the Telegram bot sends:

```
📢 Упоминание в Discord
ServerName#channel-name

AuthorName(author#tag): message text
```

## Telegram Bot Commands

| Command       | Description              |
| ------------- | ------------------------ |
| `/start`      | Welcome message and help |
| `/register`   | Link a Discord account   |
| `/unregister` | Unlink a Discord account |
| `/list`       | Manage tracked channels  |
| `/lang`       | Change language (en/ru)  |
| `/help`       | Show available commands  |

## Project Structure

```
src/
  start.ts       — entry point, orchestration, graceful shutdown
  config.ts      — env validation and resolved paths
  logger.ts      — logging to stdout + file
  store.ts       — user database (JSON file, EventEmitter)
  telegram.ts    — Telegram bot (node-telegram-bot-api v2)
  discord.ts     — Discord client (discord.js v14)
  types.ts       — shared TypeScript interfaces
  __tests__/     — tests (node:test + node:assert)
```

## Scripts

| Script                 | Description                                     |
| ---------------------- | ----------------------------------------------- |
| `npm start`            | Run the app                                     |
| `npm run dev`          | Run with `--watch` (auto-restart)               |
| `npm test`             | Compile and run tests                           |
| `npm run typecheck`    | Type-check without emitting                     |
| `npm run lint`         | ESLint                                          |
| `npm run format`       | Prettier (write)                                |
| `npm run format:check` | Prettier (check only)                           |
| `npm run ci`           | Full local CI: format + lint + typecheck + test |

## Tech Stack

- **TypeScript** — strict mode, ESM, `erasableSyntaxOnly`
- **Node.js 24** — native `.ts` execution, `--env-file`, built-in `node:test`
- **discord.js** v14 — Discord Gateway API
- **node-telegram-bot-api** v2 — Telegram Bot API (middleware architecture)
- **ESLint** + **Prettier** — code quality and formatting
- **GitHub Actions** — CI/CD pipeline
- **Docker** — `node:24-slim`, published to GHCR

## License

ISC
