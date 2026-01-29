import 'dotenv/config';
import express from 'express';
import { startDiscordBot } from './lib/discord/bot.mjs';
import { startPoller } from './lib/scheduler/poller.mjs';
import { openDb } from './lib/db/db.mjs';

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || '/data/app.sqlite';

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

app.use('/', buildWebRoutes({ db }));

app.listen(PORT, () => {
  console.log(`[web] listening on http://0.0.0.0:${PORT}`);
});

const discord = startDiscordBot({ db });

// Start RSS poller after Discord client is ready.
discord.ready.then(() => {
  startPoller({
    db,
    discordSend: discord.send,
  });
});
