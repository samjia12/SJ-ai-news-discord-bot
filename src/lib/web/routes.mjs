import { Router } from 'express';
import { requireAdminPassword } from './auth.mjs';
import { nowIso } from '../db/db.mjs';
import { translateText } from '../translator/translator.mjs';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function buildWebRoutes({ db, getPoller }) {
  const r = Router();

  // HTML dashboard (minimal v1)
  r.get('/', (_req, res) => {
    res.type('html').send(renderIndexHtml());
  });

  // --- Admin API (Bearer ADMIN_PASSWORD) ---
  r.get('/api/config', requireAdminPassword, (_req, res) => {
    const row = db.prepare(`SELECT provider, api_key, output_language, fallback_on_error, updated_at FROM secrets ORDER BY updated_at DESC LIMIT 1`).get();
    res.json({
      provider: row?.provider ?? 'openai',
      apiKey: row?.api_key ?? '',
      outputLanguage: row?.output_language ?? 'en',
      fallbackOnError: row ? row.fallback_on_error !== 0 : true,
      updatedAt: row?.updated_at ?? null,
    });
  });

  r.post('/api/config', requireAdminPassword, (req, res) => {
    const provider = String(req.body?.provider || 'openai').toLowerCase();
    const apiKey = String(req.body?.apiKey || '').trim();
    const outputLanguage = String(req.body?.outputLanguage || 'en').trim();
    const fallbackOnError = req.body?.fallbackOnError !== false; // default true

    if (!apiKey) {
      return res.status(400).json({ error: 'apiKey is required' });
    }

    const now = nowIso();
    db.prepare(
      `INSERT INTO secrets (provider, api_key, output_language, fallback_on_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(provider, apiKey, outputLanguage, fallbackOnError ? 1 : 0, now, now);

    res.json({ ok: true });
  });

  r.post('/api/test-translate', requireAdminPassword, async (req, res) => {
    const provider = String(req.body?.provider || 'openai').toLowerCase();
    const apiKey = String(req.body?.apiKey || '').trim();
    const outputLanguage = String(req.body?.outputLanguage || 'en').trim();
    const text = String(req.body?.text || '').trim();

    if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });
    if (!text) return res.status(400).json({ error: 'text is required' });

    try {
      const out = await translateText({ provider, apiKey, targetLang: outputLanguage, text });
      res.json({ ok: true, output: out });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  r.get('/api/guilds', requireAdminPassword, (_req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = db
      .prepare(
        `SELECT g.guild_id, g.allowed, g.channel_id, g.enabled, g.updated_at,
                COALESCE(d.sent_count, 0) AS sent_today
         FROM guilds g
         LEFT JOIN daily_counters d
           ON d.guild_id = g.guild_id AND d.date = ?
         ORDER BY g.updated_at DESC
         LIMIT 200`
      )
      .all(today);
    res.json({ rows });
  });

  r.post('/api/guilds/:guildId/pause', requireAdminPassword, (req, res) => {
    const guildId = String(req.params.guildId);
    const now = nowIso();
    db.prepare(`UPDATE guilds SET enabled=0, updated_at=? WHERE guild_id=?`).run(now, guildId);
    res.json({ ok: true });
  });

  r.post('/api/guilds/:guildId/resume', requireAdminPassword, (req, res) => {
    const guildId = String(req.params.guildId);
    const now = nowIso();
    db.prepare(`UPDATE guilds SET enabled=1, updated_at=? WHERE guild_id=?`).run(now, guildId);
    res.json({ ok: true });
  });

  r.get('/api/poll-runs', requireAdminPassword, (_req, res) => {
    const rows = db
      .prepare(`SELECT id, started_at, finished_at, items_fetched, items_new, error FROM poll_runs ORDER BY id DESC LIMIT 50`)
      .all();
    res.json({ rows });
  });

  r.post('/api/run-now', requireAdminPassword, async (_req, res) => {
    const poller = getPoller?.();
    if (!poller?.runNow) return res.status(503).json({ error: 'Poller not ready yet. Try again in a few seconds.' });

    try {
      const result = await poller.runNow();
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // Recent sends (success + error)
  r.get('/api/sent-items', requireAdminPassword, (req, res) => {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
    const guildId = req.query.guildId ? String(req.query.guildId) : null;

    const rows = guildId
      ? db
          .prepare(
            `SELECT guild_id, item_key, item_link, published_at, sent_at, status, error
             FROM sent_items
             WHERE guild_id = ?
             ORDER BY id DESC
             LIMIT ?`
          )
          .all(guildId, limit)
      : db
          .prepare(
            `SELECT guild_id, item_key, item_link, published_at, sent_at, status, error
             FROM sent_items
             ORDER BY id DESC
             LIMIT ?`
          )
          .all(limit);

    res.json({ rows });
  });

  // --- Clawdbot Cron Dashboard API (file-backed) ---
  // These endpoints read/modify ~/.clawdbot/cron/jobs.json and run history jsonl.

  r.get('/api/cron/jobs', requireAdminPassword, (_req, res) => {
    const data = readCronJobsSafe();
    res.json(data);
  });

  r.get('/api/cron/runs/:jobId', requireAdminPassword, (req, res) => {
    const jobId = String(req.params.jobId);
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
    const data = readCronRunsSafe(jobId, limit);
    res.json(data);
  });

  r.post('/api/cron/jobs/:jobId/enable', requireAdminPassword, (req, res) => {
    const jobId = String(req.params.jobId);
    const out = patchCronJob(jobId, (job) => {
      job.enabled = true;
      return job;
    });
    res.json(out);
  });

  r.post('/api/cron/jobs/:jobId/disable', requireAdminPassword, (req, res) => {
    const jobId = String(req.params.jobId);
    const out = patchCronJob(jobId, (job) => {
      job.enabled = false;
      return job;
    });
    res.json(out);
  });

  r.delete('/api/cron/jobs/:jobId', requireAdminPassword, (req, res) => {
    const jobId = String(req.params.jobId);
    const out = deleteCronJob(jobId);
    res.json(out);
  });

  r.post('/api/cron/run/:jobId', requireAdminPassword, async (req, res) => {
    // Best-effort manual trigger. Requires `clawdbot` to be installed on the host.
    const jobId = String(req.params.jobId);
    const timeoutMs = Math.max(1000, Math.min(600000, Number(req.body?.timeoutMs || 30000)));
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const pexec = promisify(execFile);
      const { stdout, stderr } = await pexec('clawdbot', ['cron', 'run', jobId, '--force', '--timeout', String(timeoutMs)], {
        timeout: timeoutMs + 2000,
      });
      res.json({ ok: true, stdout, stderr });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  return r;
}

function cronBaseDir() {
  return path.join(os.homedir(), '.clawdbot', 'cron');
}

function cronJobsPath() {
  return path.join(cronBaseDir(), 'jobs.json');
}

function cronRunsDir() {
  return path.join(cronBaseDir(), 'runs');
}

function readCronJobsSafe() {
  try {
    const p = cronJobsPath();
    const raw = fs.readFileSync(p, 'utf8');
    const json = JSON.parse(raw);
    const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
    return { ok: true, path: p, count: jobs.length, jobs };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), count: 0, jobs: [] };
  }
}

function readCronRunsSafe(jobId, limit) {
  try {
    const p = path.join(cronRunsDir(), `${jobId}.jsonl`);
    if (!fs.existsSync(p)) return { ok: true, path: p, rows: [] };
    const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
    const tail = lines.slice(-limit);
    const rows = tail
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    return { ok: true, path: p, rows };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), rows: [] };
  }
}

function writeJsonAtomic(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, filePath);
}

function patchCronJob(jobId, mutator) {
  try {
    const p = cronJobsPath();
    const raw = fs.readFileSync(p, 'utf8');
    const json = JSON.parse(raw);
    const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
    const idx = jobs.findIndex((j) => String(j?.id) === jobId);
    if (idx < 0) return { ok: false, error: `job not found: ${jobId}` };

    const next = mutator({ ...jobs[idx] });
    jobs[idx] = next;
    json.jobs = jobs;
    writeJsonAtomic(p, json);

    return { ok: true, updated: true, jobId };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

function deleteCronJob(jobId) {
  try {
    const p = cronJobsPath();
    const raw = fs.readFileSync(p, 'utf8');
    const json = JSON.parse(raw);
    const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
    const before = jobs.length;
    const afterJobs = jobs.filter((j) => String(j?.id) !== jobId);
    if (afterJobs.length === before) return { ok: false, error: `job not found: ${jobId}` };
    json.jobs = afterJobs;
    writeJsonAtomic(p, json);
    return { ok: true, removed: true, jobId };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

function renderIndexHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SJ AI News Discord Bot</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; max-width: 980px; margin: 0 auto; }
    code, pre { background: #f6f8fa; padding: 2px 6px; border-radius: 6px; }
    pre { padding: 12px; overflow: auto; }
    .row { display: flex; gap: 16px; flex-wrap: wrap; }
    .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; flex: 1 1 360px; }
    input, select, textarea { width: 100%; padding: 8px; margin: 6px 0 12px; }
    button { padding: 8px 12px; }
    .small { color: #6b7280; font-size: 13px; }
    th { font-weight: 600; }
  </style>
</head>
<body>
  <h1>SJ AI News Discord Bot</h1>
  <p class="small">Local dashboard. Authenticate using <code>ADMIN_PASSWORD</code>.</p>

  <div class="card">
    <h2>1) Authenticate</h2>
    <label>Admin password</label>
    <input id="pw" type="password" placeholder="ADMIN_PASSWORD" />
    <button onclick="savePw()">Save</button>
    <span id="authStatus" class="small"></span>
  </div>

  <div class="row">
    <div class="card">
      <h2>2) Translation config</h2>
      <label>Provider</label>
      <select id="provider">
        <option value="openai">OpenAI</option>
        <option value="deepl">DeepL</option>
        <option value="claude">Claude</option>
      </select>

      <label>API key</label>
      <input id="apiKey" type="password" placeholder="Paste your key" />

      <label>Output language</label>
      <input id="lang" value="en" />
      <div class="small">Examples: <code>en</code>, <code>zh</code>, <code>ja</code>…</div>

      <label style="display:flex; gap:8px; align-items:center; margin-top:6px;">
        <input id="fallbackOnError" type="checkbox" checked />
        <span>Fallback to original text if translation fails</span>
      </label>
      <div class="small">Recommended ON for reliability (will still respect 700-char truncation).</div>

      <button onclick="loadConfig()">Load</button>
      <button onclick="saveConfig()">Save</button>
      <div id="cfgStatus" class="small"></div>
    </div>

    <div class="card">
      <h2>3) Test translation</h2>
      <textarea id="testText" rows="6" placeholder="Paste a short snippet to test..."></textarea>
      <button onclick="testTranslate()">Test</button>
      <pre id="testOut"></pre>
    </div>
  </div>

  <div class="row">
    <div class="card">
      <h2>Guilds</h2>
      <button onclick="loadGuilds()">Refresh</button>
      <div class="small">A guild appears here after you run a slash command in it at least once.</div>
      <div id="guildsTable"></div>
    </div>

    <div class="card">
      <h2>Poll runs</h2>
      <button onclick="loadPollRuns()">Refresh</button>
      <button onclick="runNow()">Run now</button>
      <div id="runNowStatus" class="small"></div>
      <pre id="pollRuns"></pre>
    </div>
  </div>

  <div class="card">
    <h2>Recent sends</h2>
    <div class="row" style="align-items:flex-end">
      <div style="flex: 1 1 240px">
        <label>Guild ID (optional)</label>
        <input id="sentGuildId" placeholder="Filter by guild id" />
      </div>
      <div style="flex: 0 0 160px">
        <label>Limit</label>
        <input id="sentLimit" value="50" />
      </div>
      <div>
        <button onclick="loadSentItems()">Refresh</button>
      </div>
    </div>
    <div id="sentTable"></div>
  </div>

  <div class="card">
    <h2>Clawdbot Cron dashboard</h2>
    <div class="small">Reads from <code>~/.clawdbot/cron/jobs.json</code> and <code>~/.clawdbot/cron/runs/*.jsonl</code> on this machine.</div>
    <div class="row" style="align-items:flex-end">
      <div>
        <button onclick="loadCronJobs()">Refresh jobs</button>
      </div>
      <div class="small" id="cronJobsStatus"></div>
    </div>

    <div id="cronJobsTable"></div>

    <div style="margin-top:12px">
      <h3 style="margin: 12px 0 6px">Selected job runs</h3>
      <div class="row" style="align-items:flex-end">
        <div style="flex: 1 1 360px">
          <input id="cronSelectedJobId" placeholder="Click a job row to load runs..." />
        </div>
        <div style="flex: 0 0 160px">
          <input id="cronRunsLimit" value="50" />
          <div class="small">runs limit</div>
        </div>
        <div>
          <button onclick="loadCronRuns()">Load runs</button>
        </div>
      </div>
      <pre id="cronRunsOut"></pre>
    </div>
  </div>

<script>
  function authHeader() {
    const pw = localStorage.getItem('adminPw') || '';
    return { 'Authorization': 'Bearer ' + pw };
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function escapeAttr(s) {
    return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  function savePw() {
    localStorage.setItem('adminPw', document.getElementById('pw').value);
    document.getElementById('authStatus').textContent = 'Saved in browser localStorage.';
  }

  async function loadConfig() {
    const res = await fetch('/api/config', { headers: authHeader() });
    const data = await res.json();
    if (!res.ok) {
      document.getElementById('cfgStatus').textContent = 'Error: ' + (data.error || res.status);
      return;
    }
    document.getElementById('provider').value = data.provider;
    document.getElementById('apiKey').value = data.apiKey;
    document.getElementById('lang').value = data.outputLanguage;
    document.getElementById('fallbackOnError').checked = (data.fallbackOnError !== false);
    document.getElementById('cfgStatus').textContent = data.updatedAt ? ('Loaded (updated: ' + data.updatedAt + ')') : 'Loaded (no config saved yet)';
  }

  async function saveConfig() {
    const body = {
      provider: document.getElementById('provider').value,
      apiKey: document.getElementById('apiKey').value,
      outputLanguage: document.getElementById('lang').value,
      fallbackOnError: document.getElementById('fallbackOnError').checked,
    };
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    document.getElementById('cfgStatus').textContent = res.ok ? 'Saved.' : ('Error: ' + (data.error || res.status));
  }

  async function testTranslate() {
    const body = {
      provider: document.getElementById('provider').value,
      apiKey: document.getElementById('apiKey').value,
      outputLanguage: document.getElementById('lang').value,
      text: document.getElementById('testText').value,
    };
    const res = await fetch('/api/test-translate', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    document.getElementById('testOut').textContent = res.ok ? data.output : ('ERROR: ' + (data.error || res.status));
  }

  async function loadGuilds() {
    const res = await fetch('/api/guilds', { headers: authHeader() });
    const data = await res.json();
    const el = document.getElementById('guildsTable');

    if (!res.ok) {
      el.innerHTML = '<div style="color:#b91c1c">ERROR: ' + escapeHtml(data.error || res.status) + '</div>';
      return;
    }

    const rows = data.rows || [];
    if (rows.length === 0) {
      el.innerHTML = '<div class="small">No guilds seen yet. Run <code>/status</code> in your server once.</div>';
      return;
    }

    let html = '';
    html += '<table style="width:100%; border-collapse: collapse">';
    html += '<thead><tr>' +
      '<th style="text-align:left; border-bottom:1px solid #e5e7eb; padding:6px">Guild ID</th>' +
      '<th style="text-align:left; border-bottom:1px solid #e5e7eb; padding:6px">Allowed</th>' +
      '<th style="text-align:left; border-bottom:1px solid #e5e7eb; padding:6px">Enabled</th>' +
      '<th style="text-align:left; border-bottom:1px solid #e5e7eb; padding:6px">Today</th>' +
      '<th style="text-align:left; border-bottom:1px solid #e5e7eb; padding:6px">Channel ID</th>' +
      '<th style="text-align:left; border-bottom:1px solid #e5e7eb; padding:6px">Actions</th>' +
    '</tr></thead>';

    html += '<tbody>';
    for (const r of rows) {
      const allowed = String(r.allowed) === '1' ? 'yes' : 'no';
      const enabled = String(r.enabled) === '1' ? 'yes' : 'no';
      const enabledStyle = enabled === 'yes' ? 'color:#065f46' : 'color:#b45309';

      html += '<tr>';
      html += '<td style="padding:6px; border-bottom:1px solid #f1f5f9"><code>' + escapeHtml(r.guild_id) + '</code></td>';
      html += '<td style="padding:6px; border-bottom:1px solid #f1f5f9">' + escapeHtml(allowed) + '</td>';
      html += '<td style="padding:6px; border-bottom:1px solid #f1f5f9; ' + enabledStyle + '">' + escapeHtml(enabled) + '</td>';
      html += '<td style="padding:6px; border-bottom:1px solid #f1f5f9">' + escapeHtml(String(r.sent_today ?? 0)) + '/300</td>';
      html += '<td style="padding:6px; border-bottom:1px solid #f1f5f9"><code>' + escapeHtml(r.channel_id || '') + '</code></td>';
      html += '<td style="padding:6px; border-bottom:1px solid #f1f5f9">';

      if (allowed === 'yes') {
        if (enabled === 'yes') {
          html += '<button onclick="pauseGuild(\'' + escapeAttr(r.guild_id) + '\')">Pause</button>';
        } else {
          html += '<button onclick="resumeGuild(\'' + escapeAttr(r.guild_id) + '\')">Resume</button>';
        }
      } else {
        html += '<span class="small">(not allowlisted)</span>';
      }

      html += '</td>';
      html += '</tr>';
    }
    html += '</tbody></table>';

    el.innerHTML = html;
  }

  async function pauseGuild(guildId) {
    const res = await fetch('/api/guilds/' + guildId + '/pause', { method: 'POST', headers: { ...authHeader(), 'content-type': 'application/json' } });
    const data = await res.json();
    if (!res.ok) alert('Pause failed: ' + (data.error || res.status));
    await loadGuilds();
  }

  async function resumeGuild(guildId) {
    const res = await fetch('/api/guilds/' + guildId + '/resume', { method: 'POST', headers: { ...authHeader(), 'content-type': 'application/json' } });
    const data = await res.json();
    if (!res.ok) alert('Resume failed: ' + (data.error || res.status));
    await loadGuilds();
  }

  async function loadPollRuns() {
    const res = await fetch('/api/poll-runs', { headers: authHeader() });
    const data = await res.json();
    document.getElementById('pollRuns').textContent = res.ok ? JSON.stringify(data.rows, null, 2) : ('ERROR: ' + (data.error || res.status));
  }

  async function runNow() {
    document.getElementById('runNowStatus').textContent = 'Running...';
    const res = await fetch('/api/run-now', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
    });
    const data = await res.json();
    if (!res.ok) {
      document.getElementById('runNowStatus').textContent = 'ERROR: ' + (data.error || res.status);
      return;
    }
    document.getElementById('runNowStatus').textContent = 'Done: fetched=' + (data.itemsFetched ?? '?') + ' newAttempts=' + (data.itemsNew ?? '?') + (data.error ? (' error=' + data.error) : '');
    await loadPollRuns();
  }

  async function loadSentItems() {
    const guildId = document.getElementById('sentGuildId').value.trim();
    const limit = document.getElementById('sentLimit').value.trim() || '50';
    const qs = new URLSearchParams();
    qs.set('limit', limit);
    if (guildId) qs.set('guildId', guildId);

    const res = await fetch('/api/sent-items?' + qs.toString(), { headers: authHeader() });
    const data = await res.json();
    const el = document.getElementById('sentTable');

    if (!res.ok) {
      el.innerHTML = '<div style="color:#b91c1c">ERROR: ' + escapeHtml(data.error || res.status) + '</div>';
      return;
    }

    const rows = data.rows || [];
    if (rows.length === 0) {
      el.innerHTML = '<div class="small">No sends recorded yet.</div>';
      return;
    }

    let html = '';
    html += '<table style="width:100%; border-collapse: collapse">';
    html += '<thead><tr>' +
      '<th style="text-align:left; border-bottom:1px solid #e5e7eb; padding:6px">Time</th>' +
      '<th style="text-align:left; border-bottom:1px solid #e5e7eb; padding:6px">Guild</th>' +
      '<th style="text-align:left; border-bottom:1px solid #e5e7eb; padding:6px">Status</th>' +
      '<th style="text-align:left; border-bottom:1px solid #e5e7eb; padding:6px">Error</th>' +
    '</tr></thead>';

    html += '<tbody>';
    for (const r of rows) {
      const status = String(r.status || '');
      const statusStyle = status === 'ok' ? 'color:#065f46' : (status === 'error' ? 'color:#b91c1c' : 'color:#6b7280');
      html += '<tr>';
      html += '<td style="padding:6px; border-bottom:1px solid #f1f5f9"><code>' + escapeHtml(r.sent_at || '') + '</code></td>';
      html += '<td style="padding:6px; border-bottom:1px solid #f1f5f9"><code>' + escapeHtml(r.guild_id || '') + '</code></td>';
      html += '<td style="padding:6px; border-bottom:1px solid #f1f5f9; ' + statusStyle + '">' + escapeHtml(status) + '</td>';
      html += '<td style="padding:6px; border-bottom:1px solid #f1f5f9">' + escapeHtml(r.error || '') + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table>';

    el.innerHTML = html;
  }

  async function loadCronJobs() {
    const statusEl = document.getElementById('cronJobsStatus');
    statusEl.textContent = 'Loading…';

    const res = await fetch('/api/cron/jobs', { headers: authHeader() });
    const data = await res.json();
    const el = document.getElementById('cronJobsTable');

    if (!res.ok || !data.ok) {
      statusEl.textContent = 'ERROR';
      el.innerHTML = '<div style="color:#b91c1c">ERROR: ' + escapeHtml(data.error || res.status) + '</div>';
      return;
    }

    statusEl.textContent = 'Loaded ' + (data.count ?? (data.jobs || []).length) + ' jobs';

    const jobs = data.jobs || [];
    if (jobs.length === 0) {
      el.innerHTML = '<div class="small">No cron jobs found.</div>';
      return;
    }

    jobs.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    let html = '';
    html += '<table style="width:100%; border-collapse: collapse">';
    html += '<thead><tr>' +
      '<th style="text-align:left; border-bottom:1px solid #e5e7eb; padding:6px">Name</th>' +
      '<th style="text-align:left; border-bottom:1px solid #e5e7eb; padding:6px">Schedule</th>' +
      '<th style="text-align:left; border-bottom:1px solid #e5e7eb; padding:6px">Enabled</th>' +
      '<th style="text-align:left; border-bottom:1px solid #e5e7eb; padding:6px">Last</th>' +
      '<th style="text-align:left; border-bottom:1px solid #e5e7eb; padding:6px">Next</th>' +
      '<th style="text-align:left; border-bottom:1px solid #e5e7eb; padding:6px">Actions</th>' +
    '</tr></thead>';

    html += '<tbody>';
    for (const j of jobs) {
      const id = String(j.id || '');
      const enabled = !!j.enabled;
      const sched = j.schedule ? (j.schedule.kind + ':' + (j.schedule.expr || '') + ' ' + (j.schedule.tz || '')) : '';
      const last = j.state?.lastRunAtMs ? new Date(j.state.lastRunAtMs).toISOString() : '';
      const next = j.state?.nextRunAtMs ? new Date(j.state.nextRunAtMs).toISOString() : '';

      const enabledHtml = enabled ? '<span style="color:#065f46">yes</span>' : '<span style="color:#b91c1c">no</span>';

      html += '<tr onclick="selectCronJob(\'' + escapeAttr(id) + '\')" style="cursor:pointer">';
      html += '<td style="padding:6px; border-bottom:1px solid #f1f5f9"><div><strong>' + escapeHtml(j.name || id) + '</strong></div><div class="small"><code>' + escapeHtml(id) + '</code></div></td>';
      html += '<td style="padding:6px; border-bottom:1px solid #f1f5f9"><code>' + escapeHtml(sched) + '</code></td>';
      html += '<td style="padding:6px; border-bottom:1px solid #f1f5f9">' + enabledHtml + '</td>';
      html += '<td style="padding:6px; border-bottom:1px solid #f1f5f9"><code>' + escapeHtml(last) + '</code><div class="small">' + escapeHtml(j.state?.lastStatus || '') + '</div></td>';
      html += '<td style="padding:6px; border-bottom:1px solid #f1f5f9"><code>' + escapeHtml(next) + '</code></td>';

      const btnEnable = enabled
        ? '<button onclick="event.stopPropagation(); disableCronJob(\'' + escapeAttr(id) + '\')">Disable</button>'
        : '<button onclick="event.stopPropagation(); enableCronJob(\'' + escapeAttr(id) + '\')">Enable</button>';

      html += '<td style="padding:6px; border-bottom:1px solid #f1f5f9; white-space:nowrap">' +
        '<button onclick="event.stopPropagation(); runCronJob(\'' + escapeAttr(id) + '\')">Run</button> ' +
        btnEnable + ' ' +
        '<button onclick="event.stopPropagation(); deleteCronJob(\'' + escapeAttr(id) + '\')" style="color:#b91c1c">Delete</button>' +
      '</td>';
      html += '</tr>';
    }
    html += '</tbody></table>';

    el.innerHTML = html;
  }

  function selectCronJob(jobId) {
    document.getElementById('cronSelectedJobId').value = jobId;
    loadCronRuns();
  }

  async function loadCronRuns() {
    const jobId = document.getElementById('cronSelectedJobId').value.trim();
    const limit = document.getElementById('cronRunsLimit').value.trim() || '50';
    const out = document.getElementById('cronRunsOut');
    if (!jobId) {
      out.textContent = 'Pick a job first.';
      return;
    }

    out.textContent = 'Loading…';
    const res = await fetch('/api/cron/runs/' + encodeURIComponent(jobId) + '?limit=' + encodeURIComponent(limit), { headers: authHeader() });
    const data = await res.json();
    out.textContent = res.ok ? JSON.stringify(data.rows || [], null, 2) : ('ERROR: ' + (data.error || res.status));
  }

  async function enableCronJob(jobId) {
    await fetch('/api/cron/jobs/' + encodeURIComponent(jobId) + '/enable', { method: 'POST', headers: authHeader() });
    await loadCronJobs();
  }

  async function disableCronJob(jobId) {
    await fetch('/api/cron/jobs/' + encodeURIComponent(jobId) + '/disable', { method: 'POST', headers: authHeader() });
    await loadCronJobs();
  }

  async function deleteCronJob(jobId) {
    if (!confirm('Delete job ' + jobId + '? This cannot be undone.')) return;
    const res = await fetch('/api/cron/jobs/' + encodeURIComponent(jobId), { method: 'DELETE', headers: authHeader() });
    const data = await res.json();
    if (!res.ok || !data.ok) alert('Delete failed: ' + (data.error || res.status));
    await loadCronJobs();
  }

  async function runCronJob(jobId) {
    const out = document.getElementById('cronRunsOut');
    out.textContent = 'Triggering…';
    const res = await fetch('/api/cron/run/' + encodeURIComponent(jobId), {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ timeoutMs: 30000 }),
    });
    const data = await res.json();
    out.textContent = res.ok ? (data.stdout || '(no stdout)') : ('ERROR: ' + (data.error || res.status));
    await loadCronJobs();
  }
</script>
</body>
</html>`;
}
