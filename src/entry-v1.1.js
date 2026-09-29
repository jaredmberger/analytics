import base from './intelligence.js';
import { BUILD_META } from '../generated/build-meta.js';
const SERVICE='Curator Analytics',REPOSITORY='jaredmberger/analytics';
export default{async fetch(request,env,ctx){const u=new URL(request.url);if(request.method==='GET'&&u.pathname==='/api/recovery-export'){const auth=requireRecoveryExportToken(request,env);if(auth)return auth;return recoveryExport(env)}if(request.method==='GET'&&u.pathname==='/api/runtime')return json(runtime(env));if(request.method==='GET'&&u.pathname==='/api/ops-health')return json({ok:true,service:SERVICE,mode:'on-demand',status:'healthy',schedule:null,note:'No scheduled freshness requirement; service is request-driven.',checkedAt:new Date().toISOString()});return base.fetch(request,env,ctx)}};
function runtime(env){const m=env.CF_VERSION_METADATA||{};return{ok:true,contractVersion:1,service:SERVICE,repository:REPOSITORY,productionBranch:'main',version:'1.1.0',commit:BUILD_META.commit||null,cloudflareDeploymentId:m.id||null,runtime:'cloudflare-workers',cloudflareVersion:{id:m.id||null,tag:m.tag||null,timestamp:m.timestamp||null},build:BUILD_META,observedAt:new Date().toISOString()}}
function json(v,s=200){return new Response(JSON.stringify(v,null,2),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'}})}

function requireRecoveryExportToken(request,env){
  if(!env.RECOVERY_EXPORT_TOKEN)return json({ok:false,error:'Recovery export is disabled because RECOVERY_EXPORT_TOKEN is not configured.'},503);
  const supplied=request.headers.get('x-curator-recovery-key');
  return supplied===env.RECOVERY_EXPORT_TOKEN?null:json({ok:false,error:'Unauthorized recovery export request.'},401);
}
async function recoveryExport(env){
  if(!env.CURATOR_ANALYTICS_RECORDS)return json({ok:false,error:'CURATOR_ANALYTICS_RECORDS is not configured.'},500);
  try{
    const entries=[];let cursor;
    do{
      const page=await env.CURATOR_ANALYTICS_RECORDS.list({limit:1000,...(cursor?{cursor}:{})});
      for(const item of page.keys){
        const raw=await env.CURATOR_ANALYTICS_RECORDS.get(item.name,'text');
        if(raw===null)throw new Error(`Listed KV key disappeared during export: ${item.name}`);
        entries.push({key:item.name,value:raw});
      }
      cursor=page.list_complete?undefined:page.cursor;
    }while(cursor);
    entries.sort((a,b)=>a.key.localeCompare(b.key));
    const data={entries};
    const exportedAt=new Date().toISOString();
    const dataSha256=await sha256(JSON.stringify(data));
    const payload={
      format:'curator-analytics-kv-recovery',
      schemaVersion:1,
      exportedAt,
      source:{service:SERVICE,binding:'CURATOR_ANALYTICS_RECORDS',namespaceId:'159b868253094d3db41c4698a636fc4c'},
      integrity:{algorithm:'SHA-256',dataSha256},
      summary:{keyCount:entries.length},
      data
    };
    const stamp=exportedAt.replace(/[:.]/g,'-');
    return new Response(JSON.stringify(payload,null,2),{status:200,headers:{'content-type':'application/json; charset=utf-8','content-disposition':`attachment; filename="curator-analytics-recovery-${stamp}.json"`,'cache-control':'no-store','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow, noarchive'}});
  }catch(error){return json({ok:false,error:'Recovery export failed.',detail:error?.message||String(error)},500)}
}
async function sha256(value){
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
