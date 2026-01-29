import 'dotenv/config';
import express from 'express';
import { startDiscordBot } from './lib/discord/bot.mjs';
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

// Placeholder dashboard route (v1 will expand). For now, just prove web server works.
app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html>
<head><meta charset="utf-8"/><title>SJ AI News Bot</title></head>
<body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px;">
  <h1>SJ AI News Discord Bot</h1>
  <p>Dashboard is not implemented yet (code milestone 1 focuses on Discord slash commands).</p>
  <ul>
    <li>Health: <a href="/health">/health</a></li>
  </ul>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`[web] listening on http://0.0.0.0:${PORT}`);
});

startDiscordBot({ db });
