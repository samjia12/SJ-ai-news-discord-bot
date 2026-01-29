#!/usr/bin/env node
/**
 * Monitor X @1024EX for NEW posts (not replies) and output JSON.
 *
 * Purpose: used by a cron agent that will forward content to Telegram (DM + group).
 *
 * Output:
 * - If no new posts: prints nothing (empty stdout)
 * - If new posts: prints JSON array: [{ id, url, createdAt, text, media: { photos:[], videos:[], animated_gifs:[] } }]
 *
 * State:
 * - ~/.clawdbot/x-monitor/1024EX-new-posts.json
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const HANDLE = '1024EX';
const USER = `@${HANDLE}`;
const STATE_PATH = path.join(os.homedir(), '.clawdbot', 'x-monitor', `${HANDLE}-new-posts.json`);

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(opts.env || {}) },
      cwd: opts.cwd || process.cwd(),
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));

    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function ensureDirForFile(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function readState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    const s = JSON.parse(raw);
    return {
      lastSeenId: s?.lastSeenId ? String(s.lastSeenId) : null,
      lastRunAt: s?.lastRunAt || null,
    };
  } catch {
    return { lastSeenId: null, lastRunAt: null };
  }
}

function writeState(state) {
  ensureDirForFile(STATE_PATH);
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function tweetUrl(id) {
  return `https://x.com/${HANDLE}/status/${id}`;
}

function formatHKT(date) {
  // Asia/Hong_Kong (UTC+8) – format as YYYY-MM-DD HH:mm
  // Note: use 24h format, no seconds for readability.
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

function safeJsonParse(text, hint = 'json') {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: new Error(`Failed to parse ${hint}: ${e?.message || e}`) };
  }
}

function pickBestVideoUrl(media) {
  const variants = media?.video_info?.variants;
  if (!Array.isArray(variants)) return null;
  const mp4 = variants.filter((v) => v?.content_type === 'video/mp4' && v?.url);
  if (mp4.length === 0) return null;
  mp4.sort((a, b) => (Number(b.bitrate || 0) - Number(a.bitrate || 0)));
  return mp4[0].url;
}

function extractMedia(raw) {
  const legacy = raw?.legacy || {};
  const ext = legacy?.extended_entities || {};
  const media = Array.isArray(ext?.media) ? ext.media : [];

  const photos = [];
  const videos = [];
  const animated_gifs = [];

  for (const m of media) {
    if (!m) continue;
    const type = m.type;
    if (type === 'photo') {
      const u = m.media_url_https || m.media_url;
      if (u) photos.push(u);
    } else if (type === 'video') {
      const u = pickBestVideoUrl(m);
      if (u) videos.push(u);
    } else if (type === 'animated_gif') {
      const u = pickBestVideoUrl(m);
      if (u) animated_gifs.push(u);
    }
  }

  return { photos, videos, animated_gifs };
}

function extractFullText(raw) {
  const legacy = raw?.legacy || {};
  const t = legacy?.full_text || legacy?.text || '';
  return String(t).replace(/\r\n/g, '\n').trim();
}

async function main() {
  // Ensure bird auth is alive (best effort)
  await run('bird', ['whoami', '--no-color', '--no-emoji']);

  const state = readState();

  const timeline = await run('bird', ['user-tweets', USER, '-n', '25', '--json', '--no-color', '--no-emoji']);
  if (timeline.code !== 0 || !timeline.stdout.trim()) {
    // Fail silently (cron wrapper will handle sending errors if desired)
    process.stdout.write('');
    return;
  }

  const parsed = safeJsonParse(timeline.stdout, 'bird user-tweets');
  if (!parsed.ok) {
    process.stdout.write('');
    return;
  }

  const timelineVal = parsed.value;
  const timelineTweets = Array.isArray(timelineVal)
    ? timelineVal
    : Array.isArray(timelineVal?.tweets)
      ? timelineVal.tweets
      : [];

  const tweets = timelineTweets
    .filter((t) => t && t.id && t.createdAt)
    // exclude RT
    .filter((t) => !(typeof t.text === 'string' && t.text.startsWith('RT @')))
    // only original posts, exclude replies
    .filter((t) => t.conversationId === t.id || t.conversationId === String(t.id));

  const lastSeen = state.lastSeenId;
  const newOnes = tweets
    .filter((t) => {
      if (!lastSeen) return true;
      try {
        return BigInt(String(t.id)) > BigInt(String(lastSeen));
      } catch {
        return String(t.id) !== String(lastSeen);
      }
    })
    .sort((a, b) => {
      try {
        return BigInt(String(a.id)) < BigInt(String(b.id)) ? -1 : 1;
      } catch {
        return String(a.id).localeCompare(String(b.id));
      }
    });

  if (newOnes.length === 0) {
    state.lastRunAt = new Date().toISOString();
    writeState(state);
    return;
  }

  const results = [];

  for (const t of newOnes.slice(-10)) {
    const readRes = await run('bird', ['read', String(t.id), '--json', '--json-full', '--no-color', '--no-emoji']);
    if (readRes.code !== 0 || !readRes.stdout.trim()) continue;

    const parsedRead = safeJsonParse(readRes.stdout, 'bird read');
    if (!parsedRead.ok) continue;

    const readObj = parsedRead.value;
    const raw = readObj?._raw;

    const text = extractFullText(raw);
    const media = extractMedia(raw);

    const createdAtUtc = new Date(t.createdAt);
    const createdAtHKT = isNaN(createdAtUtc.getTime()) ? null : formatHKT(createdAtUtc);

    results.push({
      id: String(t.id),
      url: tweetUrl(String(t.id)),
      createdAt: t.createdAt,
      createdAtHKT,
      createdAtISO: isNaN(createdAtUtc.getTime()) ? null : createdAtUtc.toISOString(),
      text,
      media,
    });
  }

  // Advance lastSeenId to the newest ID we've observed in timeline, not just processed.
  const maxId = tweets.reduce((acc, cur) => {
    if (!cur?.id) return acc;
    if (!acc) return String(cur.id);
    try {
      return BigInt(String(cur.id)) > BigInt(String(acc)) ? String(cur.id) : acc;
    } catch {
      return String(cur.id);
    }
  }, lastSeen);

  writeState({ lastSeenId: maxId || lastSeen, lastRunAt: new Date().toISOString() });

  if (results.length === 0) return;
  process.stdout.write(JSON.stringify(results, null, 2));
}

main().catch(() => {
  // On any unexpected failure, keep stdout empty to avoid spam.
  process.stdout.write('');
});
