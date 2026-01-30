import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TASK_META } from './task_meta.mjs';

export function cronBaseDir() {
  return path.join(os.homedir(), '.clawdbot', 'cron');
}

export function cronJobsPath() {
  return path.join(cronBaseDir(), 'jobs.json');
}

export function cronRunsDir() {
  return path.join(cronBaseDir(), 'runs');
}

export function readCronJobsSafe() {
  try {
    const p = cronJobsPath();
    const raw = fs.readFileSync(p, 'utf8');
    const json = JSON.parse(raw);
    const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
    return { ok: true, path: p, jobs };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), jobs: [] };
  }
}

export function readAllCronRunsSafe({ limit, jobId } = {}) {
  const out = [];
  try {
    const dir = cronRunsDir();
    if (!fs.existsSync(dir)) return out;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    const pick = jobId ? files.filter((f) => f === `${jobId}.jsonl`) : files;

    for (const f of pick) {
      const fp = path.join(dir, f);
      let lines = [];
      try {
        lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
      } catch {
        continue;
      }
      const tail = typeof limit === 'number' ? lines.slice(-limit) : lines;
      for (const line of tail) {
        try {
          const j = JSON.parse(line);
          out.push(j);
        } catch {
          // ignore
        }
      }
    }

    out.sort((a, b) => Number(b.ts || b.runAtMs || 0) - Number(a.ts || a.runAtMs || 0));
    return typeof limit === 'number' ? out.slice(0, limit) : out;
  } catch {
    return out;
  }
}

export function decorateJob(job) {
  const id = String(job?.id || '');
  const meta = TASK_META[id] || {};
  return {
    id,
    name: job?.name || id,
    title: meta.title || job?.name || id,
    type: meta.type || 'unknown',
    enabled: !!job?.enabled,
    schedule: job?.schedule || null,
    state: job?.state || {},
    targets: meta.targets || [],
  };
}

function toHKT(ms) {
  try {
    const d = new Date(ms);
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
  } catch {
    return null;
  }
}

function inferSent(summary, status) {
  const s = String(summary || '').trim();
  if (!s) return null;
  // Strong negatives
  if (/不发送|不再发送|本次不发|不發送|不发送到 Telegram|stdout 为空|输出为空|无新增|无新内容/i.test(s)) return false;
  // Skipped shouldn't be sent
  if (String(status) === 'skipped') return false;
  // Errors likely not sent unless it's a fallback notification; keep unknown.
  if (String(status) === 'error') return null;
  // Otherwise assume sent when there is meaningful summary.
  return true;
}

export function decorateRun(run, jobMap) {
  const jobId = String(run.jobId || '');
  const meta = TASK_META[jobId] || {};
  const job = jobMap?.get(jobId);

  const whenMs = Number(run.runAtMs || run.ts || 0);
  const timeHKT = whenMs ? toHKT(whenMs) : null;

  const durationMs = typeof run.durationMs === 'number' ? run.durationMs : null;
  const durationSec = durationMs != null ? (durationMs / 1000).toFixed(1) + 's' : '';

  const status = String(run.status || run.lastStatus || '').toLowerCase();
  const summary = run.summary || run.error || '';

  return {
    jobId,
    title: meta.title || job?.name || jobId,
    type: meta.type || 'unknown',
    status,
    timeHKT,
    durationSec,
    durationMs,
    summary,
    sent: inferSent(summary, status),
    targets: meta.targets || [],
    raw: run,
  };
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function hktYmd(date) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function weekdayHKT(ymd) {
  // 1..7 Mon..Sun
  const d = new Date(ymd + 'T00:00:00+08:00');
  const wd = d.getDay();
  return wd === 0 ? 7 : wd;
}

function scheduleEventsForWeek(job, baseDateYmd) {
  const id = String(job?.id || '');
  const meta = TASK_META[id] || {};
  const type = meta.type || 'unknown';

  const sched = job?.schedule;
  // High frequency: show as badge only.
  if (sched?.kind === 'every') {
    return { highFreq: true, events: [] };
  }
  const expr = sched?.expr;
  const tz = sched?.tz || 'Asia/Hong_Kong';
  if (!expr || tz !== 'Asia/Hong_Kong') {
    return { highFreq: true, events: [] };
  }

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(baseDateYmd + 'T00:00:00+08:00');
    d.setDate(d.getDate() + i);
    days.push(hktYmd(d));
  }

  const events = [];

  // Support a small set of cron shapes we currently use.
  // 1) "0 9 * * *" daily
  // 2) "0 11,21 * * *" daily multiple hours
  // 3) "0 0,8,16 * * *" daily multiple hours
  // 4) "7 * * * *" hourly at minute
  // 5) "0 11 1-7 * 1" first Monday of month
  // 6) "0 11 1-7 * 2" first Tuesday of month
  // 7) "0 11 19 3 *" one-shot-ish annual

  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) return { highFreq: true, events: [] };
  const [min, hour, dom, mon, dow] = parts;

  const make = (date, time) => {
    events.push({
      jobId: id,
      title: meta.title || job?.name || id,
      type,
      date,
      time,
      lastStatus: job?.state?.lastStatus || null,
      targets: meta.targets || [],
    });
  };

  const hourList = (h) => (h.includes(',') ? h.split(',') : [h]).map((x) => x.trim());

  if (dom === '*' && mon === '*' && dow === '*') {
    // daily
    for (const date of days) {
      for (const h of hourList(hour)) {
        if (h === '*') continue;
        make(date, `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
      }
    }
    return { highFreq: false, events };
  }

  if (dom === '*' && mon === '*' && dow === '*' && hour === '*') {
    // hourly at minute
    for (const date of days) {
      // Represent as a single marker at HH:* is noisy; treat as high frequency.
      make(date, `每小时:${String(min).padStart(2, '0')}`);
    }
    return { highFreq: true, events: [] };
  }

  if (dom === '1-7' && mon === '*' && (dow === '1' || dow === '2') && min !== '*' && hour !== '*') {
    // first Mon/Tue of month at hour:min
    for (const date of days) {
      const day = Number(date.slice(8, 10));
      if (day < 1 || day > 7) continue;
      if (String(weekdayHKT(date)) !== dow) continue;
      make(date, `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
    }
    return { highFreq: false, events };
  }

  if (mon !== '*' && dom !== '*' && dow === '*' && hour !== '*' && min !== '*') {
    // specific date in month
    for (const date of days) {
      const m = Number(mon);
      const d = Number(dom);
      if (Number(date.slice(5, 7)) !== m) continue;
      if (Number(date.slice(8, 10)) !== d) continue;
      make(date, `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
    }
    return { highFreq: false, events };
  }

  return { highFreq: true, events: [] };
}

export function buildWeekView({ jobs, baseIso }) {
  // baseIso is YYYY-MM-DD; default to current week's Monday in Asia/Hong_Kong.
  let baseDate;
  if (baseIso && /^\d{4}-\d{2}-\d{2}$/.test(baseIso)) {
    baseDate = baseIso;
  } else {
    const now = new Date();
    const today = hktYmd(now);
    const wd = weekdayHKT(today); // 1..7
    const monday = new Date(today + 'T00:00:00+08:00');
    monday.setDate(monday.getDate() - (wd - 1));
    baseDate = hktYmd(monday);
  }

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(baseDate + 'T00:00:00+08:00');
    d.setDate(d.getDate() + i);
    days.push(hktYmd(d));
  }

  const events = [];
  const highFreq = [];

  for (const job of jobs) {
    if (!job?.enabled) continue;
    const r = scheduleEventsForWeek(job, baseDate);
    if (r.highFreq) {
      const id = String(job.id);
      const meta = TASK_META[id] || {};
      highFreq.push({ jobId: id, title: meta.title || job.name || id, type: meta.type || 'unknown' });
    }
    events.push(...r.events);
  }

  return {
    baseDate,
    range: { days, endDate: days[6] },
    highFreq,
    events,
  };
}
