import 'dotenv/config';
import express from 'express';
import { startDiscordBot } from './lib/discord/bot.mjs';
import { startPoller } from './lib/scheduler/poller.mjs';
import { openDb } from './lib/db/db.mjs';

import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 3000);
let DB_PATH = process.env.DB_PATH || './data/app.sqlite';

// Ensure parent dir exists for SQLite.
// In local dev, users should use ./data/app.sqlite. In Docker, /data/app.sqlite is fine.
try {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
} catch (e) {
  // Fallback for cases where an absolute /data path is not writable/creatable on the host.
  const fallback = './data/app.sqlite';
  console.warn(`[db] failed to create directory for DB_PATH=${DB_PATH} (${e?.code || e}). Falling back to ${fallback}`);
  DB_PATH = fallback;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

if (!process.env.ADMIN_PASSWORD) {
  console.error('Missing required env: ADMIN_PASSWORD');
  process.exit(1);
}
if (!process.env.DISCORD_BOT_TOKEN) {
  console.error('Missing required env: DISCORD_BOT_TOKEN');
  process.exit(1);
}

const db = openDb(DB_PATH);

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

import { buildWebRoutes } from './lib/web/routes.mjs';

app.use('/', buildWebRoutes({ db, getPoller: () => poller }));

app.listen(PORT, () => {
  console.log(`[web] listening on http://0.0.0.0:${PORT}`);
});

const discord = startDiscordBot({ db });

// Start RSS poller after Discord client is ready.
let poller = null;

discord.ready.then(() => {
  poller = startPoller({
    db,
    discordSend: discord.send,
  });
});
