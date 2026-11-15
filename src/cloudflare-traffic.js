// Independent Cloudflare Web Analytics view. Requires an account-scoped token with Analytics Read.
const SITE_TAG = 'c6685b04b037464da823287221531f32';
const API = 'https://api.cloudflare.com/client/v4/graphql';
const json = (data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
export async function traffic(request,env) {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) return json({ok:false,error:'Cloudflare analytics credentials unavailable'},503);
  const days = Number(new URL(request.url).searchParams.get('days')||7);
  if (![7,28].includes(days)) return json({ok:false,error:'Supported periods: 7 or 28 days'},400);
  const end = new Date();
  const start = new Date(end.getTime()-(days-1)*86400000);
  const date = d=>d.toISOString().slice(0,10);
  const query = `query Traffic($account: String!, $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject) {
    viewer { accounts(filter:{accountTag:$account}) {
      rumPageloadEventsAdaptiveGroups(limit:35,filter:$filter) { count dimensions { date } }
    } }
  }`;
  try {
    const response=await fetch(API,{method:'POST',headers:{authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN,'content-type':'application/json'},body:JSON.stringify({query,variables:{account:env.CLOUDFLARE_ACCOUNT_ID,filter:{siteTag:SITE_TAG,datetime_geq:date(start)+'T00:00:00Z',datetime_leq:end.toISOString()}}})});
    const payload=await response.json();
    if (!response.ok||payload.errors?.length) throw new Error('Cloudflare Analytics query failed');
    const groups=payload.data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups;
    if (!Array.isArray(groups)) throw new Error('No analytics dataset returned');
    const byDay=new Map(groups.map(g=>[g.dimensions.date,g.count]));
    const daily=Array.from({length:days},(_,i)=>{const d=new Date(start.getTime()+i*86400000);return {date:date(d),pageLoadEvents:byDay.get(date(d))||0}});
    return json({ok:true,source:'Cloudflare Web Analytics',metric:'Recorded page-load events (not unique visitors)',sampled:true,days,daily,total:daily.reduce((s,d)=>s+d.pageLoadEvents,0),asOf:end.toISOString(),note:'Counts may be sampled; compare trends rather than treating these as GA4 page views.'});
  } catch(error) {return json({ok:false,error:'Cloudflare analytics temporarily unavailable; GA4 remains available.'},502)}
}
export const panel=`<section id="cloudflare-traffic" style="margin:24px auto;max-width:1100px;padding:22px;border:1px solid #786a4c;border-radius:14px;background:#171d23;color:#e9e1d1;font-family:inherit">
<h2 style="margin:0 0 8px;color:#c7ac75">Cloudflare · Traffic Confidence</h2>
<p style="margin:0 0 12px;color:#b6bec5">Independent recorded page-load activity, not unique visitors or GA4 sessions.</p>
<div id="cf-traffic-status" role="status">Loading Cloudflare data…</div><div id="cf-traffic-bars" style="display:flex;align-items:end;gap:5px;height:120px;margin-top:15px" aria-label="Daily page-load activity"></div>
<p style="font-size:12px;color:#aeb8bf">Cloudflare counts may be sampled. The current day is incomplete. GA4 and Cloudflare measure different events.</p>
</section><script>
(async()=>{const status=document.getElementById('cf-traffic-status'),bars=document.getElementById('cf-traffic-bars');try{
const r=await fetch('/api/cloudflare-traffic?days=7',{cache:'no-store'}),d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'Unavailable');
status.textContent=d.total.toLocaleString()+' recorded page-load events in the last 7 calendar days (including today)';
const max=Math.max(1,...d.daily.map(x=>x.pageLoadEvents));
for(const day of d.daily){const b=document.createElement('div');b.style.cssText='flex:1;min-width:0;background:#bfa46a;border-radius:4px 4px 0 0';b.style.height=Math.max(2,day.pageLoadEvents/max*100)+'%';b.title=day.date+': '+day.pageLoadEvents.toLocaleString();b.setAttribute('aria-label',b.title);bars.appendChild(b);}
}catch(e){status.textContent='Cloudflare view unavailable; your existing GA4 dashboard remains operational.';}})();
</script>`;
