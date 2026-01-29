import { fetchRssItems } from '../rss/rss.mjs';
import { nowIso, todayUtcDate } from '../db/db.mjs';
import { translateText } from '../translator/translator.mjs';

export function startPoller({ db, discordSend }) {
  const rssUrl = process.env.RSS_URL || 'https://www.oaibest.com/rss.xml';
  const intervalMin = Number(process.env.POLL_INTERVAL_MINUTES || 20);
  const maxPerGuild = Number(process.env.MAX_DAILY_ITEMS_PER_GUILD || 300);
  const maxChars = Number(process.env.MAX_OUTPUT_CHARS || 700);

  console.log(`[poller] rss=${rssUrl} interval=${intervalMin}m maxPerGuild=${maxPerGuild} maxChars=${maxChars}`);

  const tick = async () => {
    const startedAt = nowIso();
    let itemsFetched = 0;
    let itemsNew = 0;
    let error = null;

    try {
      const items = await fetchRssItems(rssUrl);
      itemsFetched = items.length;

      const guilds = db
        .prepare(`SELECT guild_id, channel_id, enabled FROM guilds WHERE allowed=1 AND enabled=1 AND channel_id IS NOT NULL`)
        .all();

      const cfg = db
        .prepare(`SELECT provider, api_key, output_language FROM secrets ORDER BY updated_at DESC LIMIT 1`)
        .get();

      for (const g of guilds) {
        const guildId = g.guild_id;
        const channelId = g.channel_id;
        const date = todayUtcDate();

        const sentCount = getDailyCount(db, { guildId, date });
        if (sentCount >= maxPerGuild) continue;

        for (const it of items) {
          if (getDailyCount(db, { guildId, date }) >= maxPerGuild) break;

          const exists = db
            .prepare(`SELECT 1 FROM sent_items WHERE guild_id=? AND item_key=?`)
            .get(guildId, it.key);
          if (exists) continue;

          itemsNew++;

          try {
            let out = it.text;
            if (cfg?.provider && cfg?.api_key) {
              out = await translateText({
                provider: cfg.provider,
                apiKey: cfg.api_key,
                targetLang: cfg.output_language || 'en',
                text: it.text,
              });
            }

            out = truncate(out, maxChars);

            await discordSend({ channelId, content: out });

            recordSent(db, {
              guildId,
              itemKey: it.key,
              itemLink: it.link,
              publishedAt: it.isoDate || it.pubDate,
              status: 'ok',
              error: null,
            });
            incDaily(db, { guildId, date });
          } catch (e) {
            const msg = String(e?.message || e);
            recordSent(db, {
              guildId,
              itemKey: it.key,
              itemLink: it.link,
              publishedAt: it.isoDate || it.pubDate,
              status: 'error',
              error: msg,
            });
          }
        }
      }
    } catch (e) {
      error = String(e?.message || e);
    } finally {
      const finishedAt = nowIso();
      db.prepare(
        `INSERT INTO poll_runs (started_at, finished_at, items_fetched, items_new, error)
         VALUES (?, ?, ?, ?, ?)`
      ).run(startedAt, finishedAt, itemsFetched, itemsNew, error);

      if (error) console.warn(`[poller] error: ${error}`);
      else console.log(`[poller] ok: fetched=${itemsFetched} newAttempts=${itemsNew}`);
    }
  };

  // start soon, then interval
  setTimeout(tick, 2_000);
  setInterval(tick, intervalMin * 60_000);
}

function truncate(s, maxChars) {
  const str = String(s || '');
  if (str.length <= maxChars) return str;
  return str.slice(0, maxChars) + ' (truncated)';
}

function recordSent(db, { guildId, itemKey, itemLink, publishedAt, status, error }) {
  db.prepare(
    `INSERT OR IGNORE INTO sent_items (guild_id, item_key, item_link, published_at, sent_at, status, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(guildId, itemKey, itemLink, publishedAt || null, nowIso(), status, error);
}

function incDaily(db, { guildId, date }) {
  db.prepare(
    `INSERT INTO daily_counters (guild_id, date, sent_count)
     VALUES (?, ?, 1)
     ON CONFLICT(guild_id, date) DO UPDATE SET sent_count = sent_count + 1`
  ).run(guildId, date);
}

function getDailyCount(db, { guildId, date }) {
  const row = db.prepare(`SELECT sent_count FROM daily_counters WHERE guild_id=? AND date=?`).get(guildId, date);
  return row?.sent_count ?? 0;
}
