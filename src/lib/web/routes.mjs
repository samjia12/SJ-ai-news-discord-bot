import { Router } from 'express';
import { requireAdminPassword } from './auth.mjs';
import { nowIso } from '../db/db.mjs';
import { translateText } from '../translator/translator.mjs';

export function buildWebRoutes({ db }) {
  const r = Router();

  // HTML dashboard (very minimal v1)
  r.get('/', (_req, res) => {
    res.type('html').send(renderIndexHtml());
  });

  // --- Admin API (Bearer ADMIN_PASSWORD) ---
  r.get('/api/config', requireAdminPassword, (_req, res) => {
    const row = db.prepare(`SELECT provider, api_key, output_language, updated_at FROM secrets ORDER BY updated_at DESC LIMIT 1`).get();
    res.json({
      provider: row?.provider ?? 'openai',
      apiKey: row?.api_key ?? '',
      outputLanguage: row?.output_language ?? 'en',
      updatedAt: row?.updated_at ?? null,
    });
  });

  r.post('/api/config', requireAdminPassword, (req, res) => {
    const provider = String(req.body?.provider || 'openai').toLowerCase();
    const apiKey = String(req.body?.apiKey || '').trim();
    const outputLanguage = String(req.body?.outputLanguage || 'en').trim();

    if (!apiKey) {
      return res.status(400).json({ error: 'apiKey is required' });
    }

    const now = nowIso();
    db.prepare(
      `INSERT INTO secrets (provider, api_key, output_language, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(provider, apiKey, outputLanguage, now, now);

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
    const rows = db
      .prepare(`SELECT guild_id, allowed, channel_id, enabled, updated_at FROM guilds ORDER BY updated_at DESC LIMIT 200`)
      .all();
    res.json({ rows });
  });

  r.get('/api/poll-runs', requireAdminPassword, (_req, res) => {
    const rows = db
      .prepare(`SELECT id, started_at, finished_at, items_fetched, items_new, error FROM poll_runs ORDER BY id DESC LIMIT 50`)
      .all();
    res.json({ rows });
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
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; max-width: 920px; margin: 0 auto; }
    code, pre { background: #f6f8fa; padding: 2px 6px; border-radius: 6px; }
    pre { padding: 12px; overflow: auto; }
    .row { display: flex; gap: 16px; flex-wrap: wrap; }
    .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; flex: 1 1 360px; }
    input, select, textarea { width: 100%; padding: 8px; margin: 6px 0 12px; }
    button { padding: 10px 14px; }
    .small { color: #6b7280; font-size: 13px; }
  </style>
</head>
<body>
  <h1>SJ AI News Discord Bot</h1>
  <p class="small">This is a local dashboard. Authenticate using <code>ADMIN_PASSWORD</code>.</p>

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
      <div class="small">Examples: <code>en</code>, <code>zh</code>, <code>ja</code>… (DeepL uses best-effort mapping).</div>

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
      <h2>Guilds (seen)</h2>
      <button onclick="loadGuilds()">Refresh</button>
      <pre id="guilds"></pre>
      <div class="small">A guild appears here after you run a slash command in it at least once.</div>
    </div>

    <div class="card">
      <h2>Recent poll runs</h2>
      <button onclick="loadPollRuns()">Refresh</button>
      <pre id="pollRuns"></pre>
    </div>
  </div>

<script>
  function authHeader() {
    const pw = localStorage.getItem('adminPw') || '';
    return { 'Authorization': 'Bearer ' + pw };
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
    document.getElementById('cfgStatus').textContent = data.updatedAt ? ('Loaded (updated: ' + data.updatedAt + ')') : 'Loaded (no config saved yet)';
  }

  async function saveConfig() {
    const body = {
      provider: document.getElementById('provider').value,
      apiKey: document.getElementById('apiKey').value,
      outputLanguage: document.getElementById('lang').value,
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
    document.getElementById('guilds').textContent = res.ok ? JSON.stringify(data.rows, null, 2) : ('ERROR: ' + (data.error || res.status));
  }

  async function loadPollRuns() {
    const res = await fetch('/api/poll-runs', { headers: authHeader() });
    const data = await res.json();
    document.getElementById('pollRuns').textContent = res.ok ? JSON.stringify(data.rows, null, 2) : ('ERROR: ' + (data.error || res.status));
  }
</script>
</body>
</html>`;
}
