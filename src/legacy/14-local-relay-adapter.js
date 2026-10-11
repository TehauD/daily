(function(){'use strict';
/* Optional relay client key (DAILY_CLIENT_KEY). Open the app once as /#relay-key=<key>;
   it is saved locally, removed from the address bar, and attached to same-origin
   /api, /v1 and /healthz requests only — never to third-party hosts. */
(function(){try{const m=/[#&]relay-key=([^&]+)/.exec(location.hash||'');if(m){const s=JSON.parse(store.get(LS.set)||'{}');s.relayClientKey=decodeURIComponent(m[1]);store.set(LS.set,JSON.stringify(s));history.replaceState(null,'',location.pathname+location.search);}}catch(_){}
  if(window.__dailyFetchWrapped)return;window.__dailyFetchWrapped=true;const nativeFetch=window.fetch.bind(window);
  window.fetch=function(input,init){try{const u=new URL(typeof input==='string'?input:(input&&input.url)||'',location.href);let k='';try{k=(JSON.parse(store.get(LS.set)||'{}').relayClientKey)||''}catch(_){}
    if(k&&u.origin===location.origin&&/^\/(api|v1)\/|^\/healthz$/.test(u.pathname)){init=Object.assign({},init||{});const h=new Headers(init.headers||(typeof input!=='string'&&input&&input.headers)||{});if(!h.has('X-Daily-Client-Key'))h.set('X-Daily-Client-Key',k);init.headers=h;}}catch(_){}
    return nativeFetch(input,init);};})();
const RELAY={config:null};
async function relayJSON(url,opt={}){const s=getS?.()||{};const key=s.relayClientKey||'';const h=Object.assign({'Content-Type':'application/json'},opt.headers||{});if(key)h['X-Daily-Client-Key']=key;const r=await fetch(url,Object.assign({},opt,{headers:h}));const raw=await r.text();let j;try{j=JSON.parse(raw)}catch(_){j={error:{message:raw}}}if(!r.ok)throw new Error(j?.error?.message||j?.message||('Relay '+r.status));return j}
/* When the relay provides an integration, the relay's .env wins: any token previously
   typed into this browser is replaced by a credential-free "relay" marker. */
function mergeEnv(){const c=RELAY.config;if(!c)return;
  if(c.ai?.configured){store.set(LS.ai,JSON.stringify({prov:'local',base:location.origin,model:c.ai.model,key:'',ver:'',relay:true}));}
  if(c.github?.enabled){store.set(LS.gh,JSON.stringify({owner:c.github.owner,repo:c.github.repository,branch:c.github.branch,path:c.github.root,token:'relay',relay:true}));}
  if(c.ado?.enabled){store.set(LS.az,JSON.stringify({org:c.ado.organization,project:c.ado.project,repo:c.ado.repository,branch:c.ado.branch,path:c.ado.root,token:'relay',relay:true}));}
  fillAI();fillRepo();renderRibbon();
}
/* Relay not reachable (e.g. served by the static Express host): drop stale relay markers. */
function clearRelayMarkers(){let n=0;[[LS.gh,getGH],[LS.az,getAZ]].forEach(([k,g])=>{if(g().relay){store.rm(k);n++}});try{const a=JSON.parse(store.get(LS.ai)||'{}');if(a.relay){store.rm(LS.ai);n++}}catch(_){}if(n){try{fillAI();fillRepo();renderRibbon()}catch(_){}}}
async function init(){try{RELAY.config=await relayJSON('/api/config');window.__relayConfig=RELAY.config;mergeEnv();try{document.dispatchEvent(new CustomEvent('daily:relay',{detail:RELAY.config}))}catch(_){}workspaceEvents?.emit?.({category:'storage',name:'relay.configuration.loaded',status:'success',attributes:{secretsReturned:false}})}catch(_){clearRelayMarkers()}}
const directGhCommit=window.ghCommit,directAzCommit=window.azCommit,directGhList=window.ghList,directAzList=window.azList,directGhFetch=window.ghFetch,directAzFetch=window.azFetch;
async function relayPush(provider){const e=collect(),parts=String(e.date).split('-'),rel=parts.concat([(e.slug||'note')+'--'+e.id+'.md']).join('/');
  const sk=window.__dailyShaKey?window.__dailyShaKey(provider==='github'?'github':'azure',e.id):'';const mode=(window.DailyProvider&&DailyProvider.publishMode())||'commit';
  const name=provider==='github'?'GitHub':'Azure DevOps',title='Journal '+e.date+' - '+(e.title||'Note');
  const body={provider,path:rel,markdown:buildMD(),message:title,title,mode,knownSha:(sk&&store.get(sk))||'',date:e.date,summary:String(e.text||'').replace(/[#>*_`]/g,'').replace(/\s+/g,' ').trim().slice(0,300)};
  let r;try{r=await relayJSON('/api/repositories/push',{method:'POST',body:JSON.stringify(body)})}
  catch(err){if(!/REMOTE_CHANGED/.test(err.message))throw err;
    if(!confirm('“'+(e.title||e.date)+'” changed in '+name+' since your last sync.\n\nOverwrite the copy in '+name+' with this version?\n\nChoose Cancel, then Pull, to keep the remote changes.'))throw new Error('Push canceled: the note changed in '+name);
    body.force=true;r=await relayJSON('/api/repositories/push',{method:'POST',body:JSON.stringify(body)})}
  if(r&&r.sha&&mode!=='pr'&&sk)store.set(sk,r.sha);return r}
window.ghCommit=async function(){const c=getGH();if(!c.relay)return directGhCommit();return relayPush('github')};
window.azCommit=async function(){const c=getAZ();if(!c.relay)return directAzCommit();return relayPush('ado')};
window.ghList=async function(){if(!getGH().relay)return directGhList();return (await relayJSON('/api/repositories/files?provider=github')).value||[]};
window.azList=async function(){if(!getAZ().relay)return directAzList();return (await relayJSON('/api/repositories/files?provider=ado')).value||[]};
window.ghFetch=async function(f){if(!getGH().relay)return directGhFetch(f);const r=await fetch('/api/repositories/content?provider=github&path='+encodeURIComponent(f.path));if(!r.ok)throw new Error('Relay content '+r.status);return r.text()};
window.azFetch=async function(f){if(!getAZ().relay)return directAzFetch(f);const r=await fetch('/api/repositories/content?provider=ado&path='+encodeURIComponent(f.path));if(!r.ok)throw new Error('Relay content '+r.status);return r.text()};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
