export function renderTasksHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Tasks Dashboard</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 20px; max-width: 1200px; margin: 0 auto; }
    .top { display:flex; gap:12px; flex-wrap:wrap; align-items:center; }
    .tabs { display:flex; gap:8px; margin: 12px 0; }
    .tab { padding: 8px 12px; border:1px solid #e5e7eb; border-radius: 999px; cursor:pointer; background:#fff; }
    .tab.active { background:#111827; color:#fff; border-color:#111827; }
    .row { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; }
    .card { border:1px solid #e5e7eb; border-radius: 12px; padding: 14px; margin: 12px 0; }
    .small { color:#6b7280; font-size: 13px; }
    input, select { padding:8px; border:1px solid #e5e7eb; border-radius: 8px; }
    button { padding:8px 12px; border:1px solid #e5e7eb; border-radius: 8px; background:#fff; cursor:pointer; }
    button.primary { background:#111827; color:#fff; border-color:#111827; }
    table { width:100%; border-collapse: collapse; }
    th, td { text-align:left; padding:8px; border-bottom:1px solid #f1f5f9; vertical-align: top; }
    .pill { display:inline-block; padding:2px 8px; border-radius: 999px; font-size: 12px; border:1px solid #e5e7eb; }
    .pill.ok { color:#065f46; border-color:#a7f3d0; background:#ecfdf5; }
    .pill.err { color:#b91c1c; border-color:#fecaca; background:#fef2f2; }
    .pill.skip { color:#92400e; border-color:#fde68a; background:#fffbeb; }
    .pill.work { background:#eff6ff; border-color:#bfdbfe; color:#1d4ed8; }
    .pill.life { background:#ecfeff; border-color:#a5f3fc; color:#0e7490; }
    .weekGrid { display:grid; grid-template-columns: 120px repeat(7, 1fr); gap:8px; }
    .cell { border:1px solid #e5e7eb; border-radius: 10px; padding: 10px; min-height: 120px; }
    .dayTitle { font-weight:700; margin-bottom: 6px; }
    .event { border-left: 4px solid #111827; padding-left: 8px; margin: 6px 0; }
    .event.work { border-left-color:#2563eb; }
    .event.life { border-left-color:#0891b2; }
    .eventTime { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color:#6b7280; }
    pre { background:#0b1020; color:#e5e7eb; padding: 12px; border-radius: 10px; overflow:auto; }
  </style>
</head>
<body>
  <h1>Reminders & Tasks Dashboard</h1>
  <div class="small">Week view (UTC+8) + runs view. Authenticate using <code>ADMIN_PASSWORD</code>.</div>

  <div class="card">
    <div class="top">
      <div>
        <div class="small">Admin password</div>
        <input id="pw" type="password" placeholder="ADMIN_PASSWORD" style="min-width: 260px" />
      </div>
      <div>
        <button class="primary" onclick="savePw()">Save</button>
      </div>
      <div class="small" id="authStatus"></div>
    </div>
  </div>

  <div class="tabs">
    <div id="tabWeek" class="tab active" onclick="setTab('week')">Week</div>
    <div id="tabRuns" class="tab" onclick="setTab('runs')">Runs</div>
  </div>

  <div id="weekPane" class="card"></div>
  <div id="runsPane" class="card" style="display:none"></div>

<script>
  function authHeader(){
    const pw = localStorage.getItem('adminPw') || '';
    return { 'Authorization': 'Bearer ' + pw };
  }
  function savePw(){
    localStorage.setItem('adminPw', document.getElementById('pw').value);
    document.getElementById('authStatus').textContent = 'Saved.';
    refreshAll();
  }
  function esc(s){
    return String(s ?? '').replace(/[&<>"']/g, (c)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c]));
  }
  function pill(status){
    const map = { ok:'ok', error:'err', skipped:'skip' };
    const cls = map[String(status)] || '';
    return '<span class="pill ' + cls + '">' + esc(status || '') + '</span>';
  }
  function setTab(which){
    document.getElementById('tabWeek').classList.toggle('active', which==='week');
    document.getElementById('tabRuns').classList.toggle('active', which==='runs');
    document.getElementById('weekPane').style.display = which==='week' ? '' : 'none';
    document.getElementById('runsPane').style.display = which==='runs' ? '' : 'none';
    refreshAll();
  }

  async function refreshAll(){
    const activeWeek = document.getElementById('weekPane').style.display !== 'none';
    if(activeWeek) await loadWeek();
    else await loadRuns();
  }

  async function loadWeek(){
    const el = document.getElementById('weekPane');
    el.innerHTML = '<div class="small">Loading…</div>';
    const res = await fetch('/api/tasks/week', { headers: authHeader() });
    const data = await res.json();
    if(!res.ok || !data.ok){
      el.innerHTML = '<div style="color:#b91c1c">ERROR: ' + esc(data.error || res.status) + '</div>';
      return;
    }

    const days = data.range.days;
    const events = data.events;

    // group by date
    const byDay = {};
    for(const d of days) byDay[d] = [];
    for(const e of events){
      if(!byDay[e.date]) byDay[e.date] = [];
      byDay[e.date].push(e);
    }
    for(const k of Object.keys(byDay)) byDay[k].sort((a,b)=>a.time.localeCompare(b.time));

    let html = '';
    html += '<div class="row" style="justify-content:space-between">' +
      '<div><strong>Week</strong> <span class="small">(' + esc(data.baseDate) + ' → ' + esc(data.range.endDate) + ')</span></div>' +
      '<div class="small">High frequency: ' + esc((data.highFreq||[]).map(x=>x.title).join(' · ') || '—') + '</div>' +
    '</div>';

    html += '<div class="weekGrid" style="margin-top:10px">';
    html += '<div></div>';
    const hfStats = data.highFreqStats || {};
    const hfList = data.highFreq || [];

    for(const d of days){
      html += '<div class="cell"><div class="dayTitle">' + esc(d) + '</div>';

      // High-frequency daily stats banner
      if (hfList.length > 0) {
        html += '<div class="small" style="margin:6px 0 8px">High-frequency runs</div>';
        for (const hf of hfList) {
          const s = (hfStats[hf.jobId] && hfStats[hf.jobId][d]) ? hfStats[hf.jobId][d] : null;
          const total = s ? s.total : 0;
          const ok = s ? s.ok : 0;
          const err = s ? s.error : 0;
          const skip = s ? s.skipped : 0;
          const sentYes = s ? s.sentYes : 0;
          const sentNo = s ? s.sentNo : 0;

          // Simple density bar
          const denom = Math.max(1, total);
          const okPct = Math.round((ok / denom) * 100);
          const errPct = Math.round((err / denom) * 100);
          const skipPct = Math.max(0, 100 - okPct - errPct);

          html += '<div style="margin:6px 0">';
          html += '<div class="small"><span class="pill ' + esc(hf.type) + '">' + esc(hf.type) + '</span> <strong>' + esc(hf.title) + '</strong></div>';
          html += '<div style="height:8px; background:#f3f4f6; border-radius:999px; overflow:hidden; margin-top:4px">' +
            '<div style="height:8px; width:' + okPct + '%; background:#10b981; float:left"></div>' +
            '<div style="height:8px; width:' + errPct + '%; background:#ef4444; float:left"></div>' +
            '<div style="height:8px; width:' + skipPct + '%; background:#f59e0b; float:left"></div>' +
          '</div>';
          html += '<div class="small">runs: ' + total + ' (ok ' + ok + ', err ' + err + ', skip ' + skip + ') · sent: ' + sentYes + ' / no: ' + sentNo + '</div>';
          html += '</div>';
        }
      }

      const items = byDay[d] || [];
      if(items.length===0) html += '<div class="small">No scheduled items</div>';
      for(const e of items){
        html += '<div class="event ' + esc(e.type) + '">' +
          '<div class="eventTime">' + esc(e.time) + ' · <span class="pill ' + esc(e.type) + '">' + esc(e.type) + '</span> ' + pill(e.lastStatus) + '</div>' +
          '<div><strong>' + esc(e.title) + '</strong></div>' +
          '<div class="small">Targets: ' + esc((e.targets||[]).map(t=>t.label+':'+t.target).join(', ') || '—') + '</div>' +
        '</div>';
      }
      html += '</div>';
    }
    html += '</div>';

    html += '<div class="small" style="margin-top:10px">Tip: high-frequency jobs are summarized, not expanded into every occurrence.</div>';

    el.innerHTML = html;
  }

  async function loadRuns(){
    const el = document.getElementById('runsPane');
    el.innerHTML = '<div class="small">Loading…</div>';

    let html = '';
    html += '<div class="row">' +
      '<div><label class="small">Type</label><br/><select id="fType"><option value="all">all</option><option value="work">work</option><option value="life">life</option></select></div>' +
      '<div><label class="small">Status</label><br/><select id="fStatus"><option value="all">all</option><option value="ok">ok</option><option value="error">error</option><option value="skipped">skipped</option></select></div>' +
      '<div><label class="small">Limit</label><br/><input id="fLimit" value="120" style="width:120px"/></div>' +
      '<div><button class="primary" onclick="loadRuns()">Refresh</button></div>' +
    '</div>';
    html += '<div id="runsTable"></div>';
    el.innerHTML = html;

    const type = document.getElementById('fType').value;
    const status = document.getElementById('fStatus').value;
    const limit = document.getElementById('fLimit').value;

    const qs = new URLSearchParams();
    qs.set('type', type);
    qs.set('status', status);
    qs.set('limit', limit);

    const res = await fetch('/api/tasks/runs?' + qs.toString(), { headers: authHeader() });
    const data = await res.json();
    const out = document.getElementById('runsTable');

    if(!res.ok || !data.ok){
      out.innerHTML = '<div style="color:#b91c1c">ERROR: ' + esc(data.error || res.status) + '</div>';
      return;
    }

    const rows = data.rows || [];
    if(rows.length===0){
      out.innerHTML = '<div class="small">No runs found.</div>';
      return;
    }

    // Alerts summary (last N rows returned)
    let okC=0, errC=0, skipC=0, sentY=0, sentN=0, sentU=0;
    let execFail=0, kindSkip=0;
    const byJob = new Map();
    for (const r of rows) {
      if (r.status === 'ok') okC++;
      else if (r.status === 'error') errC++;
      else if (r.status === 'skipped') skipC++;

      if (r.sent === true) sentY++;
      else if (r.sent === false) sentN++;
      else sentU++;

      const s = String(r.summary || '');
      if (/Exec:|exec failed|MODULE_NOT_FOUND|command not found|Cannot find module/i.test(s)) execFail++;
      if (/requires payload\.kind=agentTurn/i.test(s)) kindSkip++;

      const k = r.jobId;
      const cur = byJob.get(k) || { title: r.title || k, error:0, skipped:0 };
      if (r.status === 'error') cur.error++;
      if (r.status === 'skipped') cur.skipped++;
      byJob.set(k, cur);
    }

    const topProblems = Array.from(byJob.entries())
      .map(([jobId,v]) => ({ jobId, title:v.title, bad: v.error + v.skipped, error:v.error, skipped:v.skipped }))
      .filter(x => x.bad > 0)
      .sort((a,b) => b.bad - a.bad)
      .slice(0, 5);

    let alertHtml = '';
    if (errC + skipC > 0) {
      alertHtml += '<div style="border:1px solid #fecaca; background:#fef2f2; padding:10px; border-radius:10px; margin:10px 0">';
      alertHtml += '<div><strong>Alerts</strong> <span class="small">(based on current filter window)</span></div>';
      alertHtml += '<div class="small">errors: ' + errC + ' · skipped: ' + skipC + ' · exec-failed: ' + execFail + ' · kind(agentTurn) skipped: ' + kindSkip + '</div>';
      if (topProblems.length) {
        alertHtml += '<div class="small" style="margin-top:6px"><strong>Top problematic tasks:</strong><br/>' +
          topProblems.map(p => esc(p.title) + ' (' + esc(p.jobId) + ') — bad ' + p.bad + ' (err ' + p.error + ', skip ' + p.skipped + ')').join('<br/>') +
        '</div>';
      }
      alertHtml += '</div>';
    }

    let t = '';
    t += alertHtml;
    t += '<div class="small">Totals: ok ' + okC + ' · error ' + errC + ' · skipped ' + skipC + ' · sent ' + sentY + ' · no ' + sentN + ' · ? ' + sentU + '</div>';

    t += '<table><thead><tr>' +
      '<th>Time (UTC+8)</th><th>Task</th><th>Type</th><th>Status</th><th>Sent</th><th>Targets</th><th>Duration</th><th>Summary</th>' +
    '</tr></thead><tbody>';

    for(const r of rows){
      const sent = r.sent === true ? '<span class="pill ok">sent</span>' : (r.sent === false ? '<span class="pill skip">no</span>' : '<span class="pill">?</span>');
      t += '<tr>';
      t += '<td><code>' + esc(r.timeHKT || '') + '</code></td>';
      t += '<td><div><strong>' + esc(r.title || r.jobId) + '</strong></div><div class="small"><code>' + esc(r.jobId) + '</code></div></td>';
      t += '<td><span class="pill ' + esc(r.type) + '">' + esc(r.type) + '</span></td>';
      t += '<td>' + pill(r.status) + '</td>';
      t += '<td>' + sent + '</td>';
      t += '<td class="small">' + esc((r.targets||[]).map(t=>t.label+':'+t.target).join(', ') || '—') + '</td>';
      t += '<td><code>' + esc(r.durationSec ?? '') + '</code></td>';
      t += '<td class="small">' + esc((r.summary||'').slice(0, 240)) + '</td>';
      t += '</tr>';
    }

    t += '</tbody></table>';
    out.innerHTML = t;
  }

  // initial
  refreshAll();
</script>
</body>
</html>`;
}
