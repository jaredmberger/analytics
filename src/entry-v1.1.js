import base from './intelligence.js';
import { BUILD_META } from '../generated/build-meta.js';
const SERVICE='Curator Analytics',REPOSITORY='jaredmberger/analytics';
export default{async fetch(request,env,ctx){const u=new URL(request.url);if(request.method==='GET'&&u.pathname==='/api/runtime')return json(runtime(env));if(request.method==='GET'&&u.pathname==='/api/ops-health')return json({ok:true,service:SERVICE,mode:'on-demand',status:'healthy',schedule:null,note:'No scheduled freshness requirement; service is request-driven.',checkedAt:new Date().toISOString()});return base.fetch(request,env,ctx)}};
function runtime(env){const m=env.CF_VERSION_METADATA||{};return{ok:true,service:SERVICE,version:'1.1.0',repository:REPOSITORY,runtime:'cloudflare-workers',cloudflareVersion:{id:m.id||null,tag:m.tag||null,timestamp:m.timestamp||null},build:BUILD_META,observedAt:new Date().toISOString()}}
function json(v,s=200){return new Response(JSON.stringify(v,null,2),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'}})}
