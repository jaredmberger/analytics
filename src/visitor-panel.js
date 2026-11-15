// Private, read-only visitor summary. Data is supplied by the existing GA4 Worker.
export const visitorPanel = `<section id="daily-visitors" style="margin:24px auto;max-width:1100px;padding:22px;border:1px solid rgba(191,164,106,.4);border-radius:14px;background:#121d1c;color:#f2eee3;font-family:inherit">
<h2 style="margin:0 0 7px;color:#decba4">Daily Visitors</h2>
<p style="margin:0 0 16px;color:#bcb6a8">Google Analytics 4 · Active users (not page views)</p>
<div id="visitor-cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:12px" aria-live="polite"><p>Loading visitor counts…</p></div>
<h3 style="font-size:15px;margin:22px 0 8px;color:#decba4">Last 7 calendar days</h3>
<div id="visitor-bars" style="display:flex;align-items:end;gap:8px;height:130px" role="img" aria-label="Daily active user chart"></div>
<p id="visitor-note" style="font-size:12px;color:#bcb6a8;line-height:1.5">Today is incomplete. GA4's property time zone determines calendar days.</p>
</section>
<script>
(async function(){
const cards=document.getElementById('visitor-cards'),bars=document.getElementById('visitor-bars'),note=document.getElementById('visitor-note');
try{
const response=await fetch('/api/visitor-snapshot',{cache:'no-store'}),d=await response.json();
if(!response.ok||!d.ok)throw Error('Unavailable');
const values=[['Today',d.today],['Yesterday',d.yesterday],['Last 30 minutes',d.last30Minutes]];
cards.replaceChildren();
for(const [label,value] of values){const card=document.createElement('article');card.style.cssText='padding:15px;border:1px solid rgba(191,164,106,.22);border-radius:10px;background:#192724';const name=document.createElement('div');name.style.cssText='font-size:12px;color:#bcb6a8';name.textContent=label;const number=document.createElement('div');number.style.cssText='font:600 32px Georgia,serif;color:#f2eee3;margin-top:7px';number.textContent=Number(value).toLocaleString();card.append(name,number);cards.append(card);}
const rolling=document.createElement('article');rolling.style.cssText='padding:15px;border:1px solid rgba(191,164,106,.22);border-radius:10px;background:#192724';const heading=document.createElement('div');heading.style.cssText='font-size:12px;color:#bcb6a8';heading.textContent='Approx. last 24 hours · sessions';const count=document.createElement('div');count.style.cssText='font:600 32px Georgia,serif;color:#f2eee3;margin-top:7px';count.textContent='…';rolling.append(heading,count);cards.append(rolling);
fetch('/api/rolling-sessions',{cache:'no-store'}).then(async r=>{const v=await r.json();if(!r.ok||!v.ok)throw Error('Unavailable');count.textContent=Number(v.sessions).toLocaleString();rolling.title=v.note;}).catch(()=>{count.textContent='—';rolling.title='Hourly session count unavailable';});
bars.replaceChildren();const max=Math.max(1,...d.daily.map(x=>x.users));
for(const item of d.daily){const col=document.createElement('div');col.style.cssText='flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:end;height:100%';const bar=document.createElement('div');bar.style.cssText='width:100%;max-width:85px;background:#bfa46a;border-radius:4px 4px 0 0';bar.style.height=Math.max(2,item.users/max*95)+'%';const day=document.createElement('span');day.style.cssText='font-size:10px;color:#bcb6a8;margin-top:5px';day.textContent=item.date.slice(4,6)+'/'+item.date.slice(6,8);col.title=item.date+': '+item.users+' active users';col.append(bar,day);bars.append(col);}
note.textContent='Today is incomplete. Calendar days follow the GA4 property time zone. Last 30 minutes is a realtime active-user count, not a rolling 24-hour total.';
}catch(e){cards.textContent='Visitor counts are temporarily unavailable. The existing dashboard remains operational.';note.textContent='Try refreshing later.';}
})();
</script>`;
