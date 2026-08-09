const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const GA_API = 'https://analyticsdata.googleapis.com/v1beta';

function b64url(input) {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToArrayBuffer(pem) {
  const normalized = pem.replace(/\\n/g, '\n');
  const base64 = normalized
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function createJwt(email, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({
    iss: email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );
  let binary = '';
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return `${unsigned}.${b64url(binary)}`;
}

async function getAccessToken(env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY secret.');
  }
  const assertion = await createJwt(env.GOOGLE_SERVICE_ACCOUNT_EMAIL, env.GOOGLE_PRIVATE_KEY);
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Google OAuth failed: ${data.error_description || data.error || response.status}`);
  return data.access_token;
}

async function gaReport(env, token, body) {
  const propertyId = env.GA_PROPERTY_ID || '519622084';
  const response = await fetch(`${GA_API}/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Analytics Data API failed: ${data.error?.message || response.status}`);
  return data;
}

function metric(row, index) { return Number(row?.metricValues?.[index]?.value || 0); }
function dim(row, index) { return row?.dimensionValues?.[index]?.value || ''; }
function pctChange(current, previous) {
  if (!previous) return current ? null : 0;
  return ((current - previous) / previous) * 100;
}
function round(value, places = 1) {
  const p = 10 ** places;
  return Math.round(value * p) / p;
}
function isoDateOffset(daysAgo) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}
function periodRanges(days) {
  return {
    current: { startDate: `${days - 1}daysAgo`, endDate: 'today' },
    previous: { startDate: isoDateOffset((days * 2) - 1), endDate: isoDateOffset(days) },
  };
}

async function buildDashboard(env, days) {
  const token = await getAccessToken(env);
  const ranges = periodRanges(days);
  const commonMetrics = [
    { name: 'activeUsers' },
    { name: 'sessions' },
    { name: 'screenPageViews' },
    { name: 'engagedSessions' },
    { name: 'userEngagementDuration' },
  ];

  const [currentOverview, previousOverview, daily, pages, previousPages, acquisition, countries, devices] = await Promise.all([
    gaReport(env, token, { dateRanges: [ranges.current], metrics: commonMetrics }),
    gaReport(env, token, { dateRanges: [ranges.previous], metrics: commonMetrics }),
    gaReport(env, token, {
      dateRanges: [ranges.current], dimensions: [{ name: 'date' }], metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
      orderBys: [{ dimension: { dimensionName: 'date' } }], limit: '100',
    }),
    gaReport(env, token, {
      dateRanges: [ranges.current], dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
      metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }, { name: 'userEngagementDuration' }],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: '30',
    }),
    gaReport(env, token, {
      dateRanges: [ranges.previous], dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }], limit: '10000',
    }),
    gaReport(env, token, {
      dateRanges: [ranges.current], dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'engagedSessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: '12',
    }),
    gaReport(env, token, {
      dateRanges: [ranges.current], dimensions: [{ name: 'country' }], metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }], limit: '12',
    }),
    gaReport(env, token, {
      dateRanges: [ranges.current], dimensions: [{ name: 'deviceCategory' }], metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }], limit: '8',
    }),
  ]);

  const c = currentOverview.rows?.[0];
  const p = previousOverview.rows?.[0];
  const current = {
    activeUsers: metric(c, 0), sessions: metric(c, 1), views: metric(c, 2), engagedSessions: metric(c, 3), engagementSeconds: metric(c, 4),
  };
  const previous = {
    activeUsers: metric(p, 0), sessions: metric(p, 1), views: metric(p, 2), engagedSessions: metric(p, 3), engagementSeconds: metric(p, 4),
  };
  current.viewsPerSession = current.sessions ? current.views / current.sessions : 0;
  current.engagementRate = current.sessions ? current.engagedSessions / current.sessions : 0;
  current.avgEngagementSeconds = current.activeUsers ? current.engagementSeconds / current.activeUsers : 0;
  previous.viewsPerSession = previous.sessions ? previous.views / previous.sessions : 0;
  previous.engagementRate = previous.sessions ? previous.engagedSessions / previous.sessions : 0;
  previous.avgEngagementSeconds = previous.activeUsers ? previous.engagementSeconds / previous.activeUsers : 0;

  const previousPageMap = new Map((previousPages.rows || []).map(row => [dim(row, 0), metric(row, 0)]));
  const pageRows = (pages.rows || []).map(row => {
    const path = dim(row, 0);
    const views = metric(row, 0);
    const users = metric(row, 1);
    const engagementSeconds = metric(row, 2);
    const previousViews = previousPageMap.get(path) || 0;
    return {
      path,
      title: dim(row, 1) || path,
      views,
      users,
      avgEngagementSeconds: users ? engagementSeconds / users : 0,
      previousViews,
      changePct: pctChange(views, previousViews),
    };
  });

  const signals = [];
  const comparable = pageRows.filter(x => x.previousViews >= 20 && x.views >= 20 && x.changePct !== null);
  [...comparable].sort((a,b) => b.changePct - a.changePct).slice(0,3).forEach(x => {
    if (x.changePct >= 20) signals.push({ type:'rise', title:'Rising content', text:`${x.title} is up ${round(x.changePct)}% versus the previous ${days}-day period.`, path:x.path });
  });
  [...comparable].sort((a,b) => a.changePct - b.changePct).slice(0,2).forEach(x => {
    if (x.changePct <= -20) signals.push({ type:'fall', title:'Attention declining', text:`${x.title} is down ${Math.abs(round(x.changePct))}% versus the previous period.`, path:x.path });
  });
  [...pageRows].filter(x => x.views >= 25).sort((a,b) => b.avgEngagementSeconds - a.avgEngagementSeconds).slice(0,2).forEach(x => {
    if (x.avgEngagementSeconds >= 60) signals.push({ type:'quality', title:'High-attention content', text:`${x.title} averages ${Math.round(x.avgEngagementSeconds)} seconds of engagement per active user.`, path:x.path });
  });
  if (!signals.length) signals.push({ type:'steady', title:'Stable period', text:'No unusually strong page-level movement crossed the current CuratorOS signal thresholds.' });

  const payload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    propertyId: env.GA_PROPERTY_ID || '519622084',
    days,
    current,
    previous,
    changes: {
      activeUsers: pctChange(current.activeUsers, previous.activeUsers),
      sessions: pctChange(current.sessions, previous.sessions),
      views: pctChange(current.views, previous.views),
      viewsPerSession: pctChange(current.viewsPerSession, previous.viewsPerSession),
      engagementRate: pctChange(current.engagementRate, previous.engagementRate),
      avgEngagementSeconds: pctChange(current.avgEngagementSeconds, previous.avgEngagementSeconds),
    },
    daily: (daily.rows || []).map(r => ({ date: dim(r,0), users:metric(r,0), sessions:metric(r,1), views:metric(r,2) })),
    pages: pageRows,
    acquisition: (acquisition.rows || []).map(r => ({ channel:dim(r,0), sessions:metric(r,0), users:metric(r,1), engagedSessions:metric(r,2) })),
    countries: (countries.rows || []).map(r => ({ country:dim(r,0), users:metric(r,0), sessions:metric(r,1) })),
    devices: (devices.rows || []).map(r => ({ device:dim(r,0), users:metric(r,0), sessions:metric(r,1) })),
    signals: signals.slice(0,6),
  };

  if (env.CURATOR_ANALYTICS_RECORDS) {
    try {
      await env.CURATOR_ANALYTICS_RECORDS.put('dashboard:latest', JSON.stringify(payload));
      const stamp = payload.generatedAt.slice(0,10);
      await env.CURATOR_ANALYTICS_RECORDS.put(`snapshot:${days}d:${stamp}`, JSON.stringify(payload), { expirationTtl: 60 * 60 * 24 * 180 });
    } catch (_) {}
  }
  return payload;
}

async function runGaTest(env) {
  const token = await getAccessToken(env);
  const data = await gaReport(env, token, {
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    metrics: [{ name:'activeUsers' }, { name:'sessions' }, { name:'screenPageViews' }],
  });
  const row = data.rows?.[0];
  return { propertyId: env.GA_PROPERTY_ID || '519622084', period:'last 7 days', activeUsers:metric(row,0), sessions:metric(row,1), views:metric(row,2), rowCount:data.rowCount ?? 0 };
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), { status, headers:{ 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' } });
}

const APP_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#08100f"><title>CuratorOS Analytics</title>
<style>
:root{color-scheme:dark;--bg:#08100f;--surface:#101918;--surface2:#15201e;--text:#f2eee3;--muted:#bcb6a8;--faint:#847e73;--brass:#bfa46a;--brass2:#decba4;--line:rgba(191,164,106,.28);--success:#67b98b;--warn:#d5a84f;--danger:#d86f68;--info:#72a7c7;--display:Georgia,Cambria,"Times New Roman",serif;--ui:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--shadow:0 18px 50px rgba(0,0,0,.28)}*{box-sizing:border-box}body{margin:0;min-height:100vh;color:var(--text);font-family:var(--ui);background:radial-gradient(circle at 14% 0%,rgba(191,164,106,.095),transparent 32rem),linear-gradient(180deg,#0a1211 0%,#07100f 100%)}button,select{font:inherit}.shell{width:min(1240px,calc(100% - 28px));margin:auto;padding:max(24px,env(safe-area-inset-top)) 0 max(34px,env(safe-area-inset-bottom))}.top{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin-bottom:22px}.eyebrow{margin:0 0 5px;color:var(--brass);font:700 12px/1.3 var(--ui);letter-spacing:.18em;text-transform:uppercase}h1{margin:0;font:600 clamp(38px,6vw,66px)/.98 var(--display);letter-spacing:-.035em}.sub{max-width:760px;margin:11px 0 0;color:var(--muted);font-size:14px;line-height:1.5}.toolbar{display:flex;gap:8px;align-items:center}.select,.btn{min-height:44px;border:1px solid var(--line);border-radius:12px;color:var(--text);background:rgba(16,25,24,.9);padding:9px 12px;font-weight:700}.btn{cursor:pointer}.btn:hover,.select:focus,.btn:focus{border-color:var(--brass);outline:none;box-shadow:0 0 0 3px rgba(191,164,106,.14)}.status{display:flex;align-items:center;gap:8px;margin:0 0 18px;color:var(--muted);font-size:12px}.dot{width:8px;height:8px;border-radius:50%;background:var(--success);box-shadow:0 0 0 4px rgba(103,185,139,.10)}.metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-bottom:18px}.metric,.panel{border:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.043),rgba(255,255,255,.018));box-shadow:var(--shadow)}.metric{border-radius:16px;padding:15px;min-width:0}.metric .label{color:var(--muted);font-size:10px;letter-spacing:.1em;text-transform:uppercase;font-weight:800}.metric .value{margin-top:8px;font:600 28px/1 var(--display);white-space:nowrap}.change{margin-top:8px;font-size:11px;font-weight:800}.up{color:#93d5ae}.down{color:#eba29d}.flat{color:var(--faint)}.layout{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(300px,.8fr);gap:12px}.panel{border-radius:18px;padding:17px;margin-bottom:12px;overflow:hidden}.panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:13px}.panel h2{margin:0;font:600 22px/1.1 var(--display)}.hint{color:var(--faint);font-size:11px}.chart{height:190px;display:flex;align-items:flex-end;gap:3px;padding-top:12px;border-bottom:1px solid rgba(191,164,106,.17)}.bar{flex:1;min-width:3px;border-radius:4px 4px 0 0;background:linear-gradient(180deg,var(--brass),rgba(191,164,106,.28));opacity:.88}.table-wrap{overflow:auto;margin:0 -4px}.table{width:100%;border-collapse:collapse;font-size:12px}.table th{position:sticky;top:0;background:#111a19;color:var(--brass2);font-size:10px;letter-spacing:.08em;text-transform:uppercase;text-align:left}.table th,.table td{padding:10px 8px;border-bottom:1px solid rgba(191,164,106,.13);vertical-align:top}.table tr:last-child td{border-bottom:0}.num{text-align:right!important;font-variant-numeric:tabular-nums}.path{max-width:410px}.path b{display:block;font:600 13px/1.25 var(--display);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.path span{display:block;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px}.signals{display:grid;gap:8px}.signal{border:1px solid rgba(191,164,106,.19);border-radius:13px;padding:12px;background:rgba(255,255,255,.018)}.signal strong{display:block;font-size:12px;color:var(--brass2);margin-bottom:5px}.signal p{margin:0;color:var(--muted);font-size:12px;line-height:1.45}.mini-list{display:grid;gap:9px}.mini{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center}.mini .name{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mini .val{font:600 15px/1 var(--display)}.meter{height:4px;background:rgba(255,255,255,.05);border-radius:99px;overflow:hidden;margin-top:5px}.meter i{display:block;height:100%;background:var(--brass);border-radius:99px}.empty{padding:40px 20px;text-align:center;color:var(--muted)}.error{border:1px solid rgba(216,111,104,.45);background:rgba(216,111,104,.1);color:#efbbb7;border-radius:14px;padding:14px;margin-bottom:18px}.footer{color:var(--faint);font-size:10px;text-align:center;padding-top:8px}@media(max-width:1050px){.metrics{grid-template-columns:repeat(3,1fr)}.layout{grid-template-columns:1fr}}@media(max-width:640px){.shell{width:min(100% - 18px,1240px)}.top{align-items:flex-start;flex-direction:column}.toolbar{width:100%}.select,.btn{flex:1}.metrics{grid-template-columns:repeat(2,1fr)}.metric .value{font-size:25px}.panel{padding:14px}.chart{height:150px}.table{min-width:720px}}@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style></head><body><main class="shell"><header class="top"><div><p class="eyebrow">Ocean Liner Curator · CuratorOS</p><h1>Analytics</h1><p class="sub">Audience, content, discovery, and engagement intelligence distilled from Google Analytics for editorial decisions—not a replica of the GA interface.</p></div><div class="toolbar"><select id="period" class="select" aria-label="Reporting period"><option value="7">7 days</option><option value="28" selected>28 days</option><option value="90">90 days</option></select><button id="refresh" class="btn">Refresh</button></div></header><div class="status"><span class="dot"></span><span id="status">Connecting to Analytics…</span></div><div id="error"></div><section id="metrics" class="metrics"></section><div class="layout"><div><section class="panel"><div class="panel-head"><h2>Traffic movement</h2><span class="hint" id="chartHint"></span></div><div id="chart" class="chart" aria-label="Daily page views chart"></div></section><section class="panel"><div class="panel-head"><h2>Content</h2><span class="hint">Top pages by views</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Page</th><th class="num">Views</th><th class="num">Users</th><th class="num">Attention</th><th class="num">Change</th></tr></thead><tbody id="pages"></tbody></table></div></section><section class="panel"><div class="panel-head"><h2>Acquisition</h2><span class="hint">How sessions begin</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Channel</th><th class="num">Sessions</th><th class="num">Users</th><th class="num">Engaged</th></tr></thead><tbody id="acquisition"></tbody></table></div></section></div><aside><section class="panel"><div class="panel-head"><h2>Signals</h2><span class="hint">CuratorOS observations</span></div><div id="signals" class="signals"></div></section><section class="panel"><div class="panel-head"><h2>Audience</h2><span class="hint">Top countries</span></div><div id="countries" class="mini-list"></div></section><section class="panel"><div class="panel-head"><h2>Devices</h2><span class="hint">Active users</span></div><div id="devices" class="mini-list"></div></section></aside></div><footer class="footer">CuratorOS Analytics · GA4 property 519622084 · snapshots retained in CURATOR_ANALYTICS_RECORDS</footer></main>
<script>
const $=id=>document.getElementById(id);const nf=new Intl.NumberFormat();const pf=new Intl.NumberFormat(undefined,{style:'percent',maximumFractionDigits:1});
function fmtNum(v){return nf.format(Math.round(v||0))}function fmtSec(v){v=Math.round(v||0);if(v<60)return v+'s';return Math.floor(v/60)+'m '+(v%60)+'s'}function change(v){if(v===null||!isFinite(v))return '<span class="change flat">new</span>';const cls=v>1?'up':v<-1?'down':'flat';const arrow=v>1?'↑ ':v<-1?'↓ ':'';return '<span class="change '+cls+'">'+arrow+Math.abs(v).toFixed(1)+'%</span>'}function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function metricCard(label,value,c){return '<article class="metric"><div class="label">'+label+'</div><div class="value">'+value+'</div>'+change(c)+'</article>'}
function render(d){$('metrics').innerHTML=metricCard('Active users',fmtNum(d.current.activeUsers),d.changes.activeUsers)+metricCard('Sessions',fmtNum(d.current.sessions),d.changes.sessions)+metricCard('Views',fmtNum(d.current.views),d.changes.views)+metricCard('Views / session',d.current.viewsPerSession.toFixed(2),d.changes.viewsPerSession)+metricCard('Engagement rate',pf.format(d.current.engagementRate),d.changes.engagementRate)+metricCard('Avg. attention',fmtSec(d.current.avgEngagementSeconds),d.changes.avgEngagementSeconds);const max=Math.max(1,...d.daily.map(x=>x.views));$('chart').innerHTML=d.daily.map(x=>'<div class="bar" title="'+escapeHtml(x.date)+': '+fmtNum(x.views)+' views" style="height:'+Math.max(3,(x.views/max)*100)+'%"></div>').join('');$('chartHint').textContent=d.days+' days · '+fmtNum(d.current.views)+' views';$('pages').innerHTML=d.pages.slice(0,20).map(x=>'<tr><td class="path"><b>'+escapeHtml(x.title)+'</b><span>'+escapeHtml(x.path)+'</span></td><td class="num">'+fmtNum(x.views)+'</td><td class="num">'+fmtNum(x.users)+'</td><td class="num">'+fmtSec(x.avgEngagementSeconds)+'</td><td class="num">'+change(x.changePct)+'</td></tr>').join('');$('acquisition').innerHTML=d.acquisition.map(x=>'<tr><td>'+escapeHtml(x.channel||'Unassigned')+'</td><td class="num">'+fmtNum(x.sessions)+'</td><td class="num">'+fmtNum(x.users)+'</td><td class="num">'+fmtNum(x.engagedSessions)+'</td></tr>').join('');$('signals').innerHTML=d.signals.map(x=>'<article class="signal"><strong>'+escapeHtml(x.title)+'</strong><p>'+escapeHtml(x.text)+'</p></article>').join('');renderMini('countries',d.countries,'country','users');renderMini('devices',d.devices,'device','users');$('status').textContent='Live GA4 data · updated '+new Date(d.generatedAt).toLocaleString();}
function renderMini(id,rows,nameKey,valueKey){const max=Math.max(1,...rows.map(x=>x[valueKey]));$(id).innerHTML=rows.map(x=>'<div><div class="mini"><span class="name">'+escapeHtml(x[nameKey]||'Unknown')+'</span><span class="val">'+fmtNum(x[valueKey])+'</span></div><div class="meter"><i style="width:'+((x[valueKey]/max)*100)+'%"></i></div></div>').join('')}
async function load(){const days=$('period').value;$('status').textContent='Refreshing '+days+'-day report…';$('error').innerHTML='';$('refresh').disabled=true;try{const r=await fetch('/api/dashboard?days='+days,{cache:'no-store'});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'Analytics request failed');render(d)}catch(e){$('error').innerHTML='<div class="error"><strong>Analytics could not refresh.</strong><br>'+escapeHtml(e.message)+'</div>';$('status').textContent='Data connection needs attention'}finally{$('refresh').disabled=false}}$('refresh').addEventListener('click',load);$('period').addEventListener('change',load);load();
</script></body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/ga-test') {
      try { return json({ ok:true, ...(await runGaTest(env)) }); }
      catch (error) { return json({ ok:false, error:error instanceof Error?error.message:String(error) },500); }
    }
    if (url.pathname === '/api/dashboard') {
      try {
        const requested = Number(url.searchParams.get('days') || 28);
        const days = [7,28,90].includes(requested) ? requested : 28;
        return json(await buildDashboard(env, days));
      } catch (error) {
        return json({ ok:false, error:error instanceof Error?error.message:String(error) },500);
      }
    }
    if (url.pathname === '/' || url.pathname === '/index.html') return new Response(APP_HTML,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
    return new Response('Not found',{status:404});
  },
};
