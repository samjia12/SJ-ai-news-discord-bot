import { Router } from 'express';
import { requireAdminPassword } from './auth.mjs';
import { nowIso } from '../db/db.mjs';
import { translateText } from '../translator/translator.mjs';
import { TASK_META } from './task_meta.mjs';
import { renderTasksHtml } from './tasks_html.mjs';
import { readCronJobsSafe, readAllCronRunsSafe, readCronRunsSinceMs, decorateJob, decorateRun, buildWeekView } from './tasks_utils.mjs';

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

  // ------------------------------
  // Tasks dashboard (Clawdbot cron)
  // ------------------------------

  r.get('/tasks', (_req, res) => {
    res.type('html').send(renderTasksHtml());
  });

  r.get('/api/tasks/jobs', requireAdminPassword, (_req, res) => {
    const jobs = readCronJobsSafe();
    const decorated = (jobs.jobs || []).map((j) => decorateJob(j));
    res.json({ ok: jobs.ok, error: jobs.error, path: jobs.path, jobs: decorated });
  });

  r.get('/api/tasks/runs', requireAdminPassword, (req, res) => {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
    const type = req.query.type ? String(req.query.type) : 'all'; // all|work|life
    const status = req.query.status ? String(req.query.status) : 'all'; // all|ok|error|skipped
    const jobId = req.query.jobId ? String(req.query.jobId) : null;

    const jobs = readCronJobsSafe();
    const jobMap = new Map((jobs.jobs || []).map((j) => [String(j.id), j]));

    const rows = readAllCronRunsSafe({ limit, jobId });
    const filtered = rows
      .map((r) => decorateRun(r, jobMap))
      .filter((r) => {
        if (type !== 'all' && r.type !== type) return false;
        if (status !== 'all' && String(r.status) !== status) return false;
        return true;
      });

    res.json({ ok: true, rows: filtered.slice(0, limit) });
  });

  // For week view: return events for the next 7 days in Asia/Hong_Kong.
  r.get('/api/tasks/week', requireAdminPassword, (req, res) => {
    const baseIso = req.query.baseDate ? String(req.query.baseDate) : null; // YYYY-MM-DD
    const type = req.query.type ? String(req.query.type) : 'all';

    const jobs = readCronJobsSafe();

    // Pull recent runs (bounded) to compute high-frequency per-day stats.
    const now = Date.now();
    const sinceMs = now - 9 * 24 * 3600 * 1000; // 9 days buffer for week view
    const hfIds = (jobs.jobs || []).filter((j) => j?.enabled && j?.schedule?.kind === 'every').map((j) => String(j.id));
    const runs = readCronRunsSinceMs({ sinceMs, jobIds: hfIds, maxLinesPerFile: 3000 });

    const out = buildWeekView({ jobs: jobs.jobs || [], baseIso, runs });
    const filtered = out.events.filter((e) => (type === 'all' ? true : e.type === type));

    res.json({ ok: true, tz: 'Asia/Hong_Kong', baseDate: out.baseDate, range: out.range, events: filtered, highFreq: out.highFreq, highFreqStats: out.highFreqStats });
  });

  return r;
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
</script>
</body>
</html>`;
}
