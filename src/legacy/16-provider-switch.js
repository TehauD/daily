/* PROVIDER SWITCH — one active provider (GitHub or Azure DevOps) drives push, pull, work tracking
   and the integrations that only one of them has. The other can receive a mirrored copy. */
(function(){'use strict';
const h=x=>esc(String(x==null?'':x));
const K={p:'daily:provider',m:'daily:mirror',pm:'daily:publishMode',last:'daily:lastPublish'};
const _gh=ghReady,_az=azReady;
const NAMES={github:'GitHub',ado:'Azure DevOps'};
const cfg=()=>window.__relayConfig||null;
const configured=p=>p==='github'?_gh():_az();
const label=p=>NAMES[p]||p;
const other=p=>p==='github'?'ado':'github';
function available(){const a=[];if(_gh())a.push('github');if(_az())a.push('ado');const c=cfg();((c&&c.provider&&c.provider.available)||[]).forEach(x=>{if(!a.includes(x))a.push(x)});return a}
function active(){const s=store.get(K.p),av=available();if(s&&(av.includes(s)||!av.length))return s;const c=cfg(),d=c&&c.provider&&c.provider.default;if(d&&av.includes(d))return d;return av[0]||s||'github'}
function relayOn(){return !!cfg()}
function caps(p){p=p||active();const c=cfg();if(c&&c.capabilities&&c.capabilities[p]){const x=Object.assign({},c.capabilities[p]);x.repo=x.repo||configured(p);return x}
  return {repo:configured(p),pr:false,issues:false,projects:false,runs:false,conflicts:p==='github',assets:p==='github'}}
function mirror(){const v=store.get(K.m);if(v!==null)return v==='1';const c=cfg();return !!(c&&c.provider&&c.provider.mirror)}
function mirrorTarget(){const a=active(),o=other(a);return mirror()&&configured(o)?o:null}
function publishMode(){const c=cfg(),def=(c&&c.provider&&c.provider.publishMode)||'commit',m=store.get(K.pm)||def;return m==='pr'&&caps().pr?'pr':'commit'}
function branchOf(p){const c=p==='github'?getGH():getAZ();return c.branch||'main'}
function repoUrl(p){const c=p==='github'?getGH():getAZ();if(p==='github')return c.owner&&c.repo?'https://github.com/'+encodeURIComponent(c.owner)+'/'+encodeURIComponent(c.repo):'';
  return c.org&&c.project&&c.repo?'https://dev.azure.com/'+encodeURIComponent(c.org)+'/'+encodeURIComponent(c.project)+'/_git/'+encodeURIComponent(c.repo):''}
function set(p){if(p!=='github'&&p!=='ado')return;store.set(K.p,p);apply();document.dispatchEvent(new CustomEvent('daily:provider',{detail:p}));toast('Active provider: '+label(p))}
/* Push/pull/browse follow the active provider only. */
ghReady=function(){return active()==='github'&&_gh()};
azReady=function(){return active()==='ado'&&_az()};
repoBadges=function(){const g=$('ghBadge'),a=$('azBadge');if(g)g.textContent=_gh()?'— configured':'— not configured';if(a)a.textContent=_az()?'— configured':'— not configured'};
pushRepos=async function(){
  flush();const a=active();
  if(!configured(a)){toast('Connect '+label(a)+' first.');openModal('repoModal');return}
  const run=p=>p==='github'?ghCommit():azCommit();const targets=[a],m=mirrorTarget();if(m)targets.push(m);
  const mode=publishMode();setStatus('pushing');toast(mode==='pr'?'Opening a pull request…':'Pushing…');
  const res=await Promise.allSettled(targets.map(run));setStatus('saved');
  const ok=[],bad=[];res.forEach((r,i)=>{if(r.status==='fulfilled')ok.push(Object.assign({target:targets[i]},r.value||{}));else bad.push(label(targets[i])+': '+((r.reason&&r.reason.message)||r.reason))});
  const last={at:new Date().toISOString(),mode,results:ok.map(x=>({provider:x.provider||label(x.target),url:x.url||'',pr:x.pr||null,unchanged:!!x.unchanged,assets:x.assets||0,branch:x.branch||''})),errors:bad};
  store.set(K.last,JSON.stringify(last));renderLast();
  if(!ok.length){toast(bad.join(' | '));return}
  const pr=ok.find(x=>x.pr);
  const head=pr?('Pull request #'+pr.pr.number+(pr.pr.existing?' updated':' opened')+' on '+(pr.provider||label(pr.target))):('Pushed ✓ '+ok.map(x=>(x.provider||label(x.target))+(x.unchanged?' (no changes)':'')).join(' + '));
  toast(head+(bad.length?' · '+bad.join(' | '):''));
  try{workspaceEvents.emit({category:'repository',name:'publish.completed',status:bad.length?'partial':'success',attributes:{provider:a,mode,mirror:!!m}})}catch(_){}
};
/* ---------- Repository settings ---------- */
const CAPROWS={github:[['repo','Push & pull','Commit entries to the repository and pull them back'],['pr','Pull requests','Publish an entry on its own branch and open a pull request'],['issues','Issues','Track and update GitHub Issues from the Work drawer'],['projects','Projects','Move issues across a GitHub Projects board'],['runs','Actions','See recent workflow runs and re-run failed jobs'],['conflicts','Change checks','Ask before overwriting a note that changed in the repository'],['assets','Image files','Store pasted images as files in assets/']],
  ado:[['repo','Push & pull','Commit entries to Azure Repos and pull them back'],['pr','Pull requests','Publish an entry on its own branch and open a pull request'],['issues','Boards','Track and update Azure Boards work items from the Work drawer'],['runs','Pipelines','See recent pipeline runs and queue them again'],['conflicts','Change checks','Ask before overwriting a note that changed in the repository'],['assets','Image files','Store pasted images as files in assets/']]};
function why(p,k){if(k==='repo')return 'Fill in the fields below';if(!relayOn())return 'Needs the local relay (python relay.py)';
  return {pr:'Configure the repository in .env',issues:p==='github'?'DAILY_GITHUB_ISSUES_ENABLED=true':'DAILY_ADO_WIT_ENABLED=true',projects:'Set DAILY_GITHUB_PROJECT_NUMBER',runs:p==='github'?'DAILY_GITHUB_ACTIONS_ENABLED=true':'DAILY_ADO_PIPELINES_ENABLED=true',conflicts:'Configure the repository',assets:'DAILY_ASSETS=true'}[k]||''}
function renderModal(){
  const seg=$('provSeg');if(!seg)return;const a=active();
  seg.querySelectorAll('button').forEach(b=>{b.classList.toggle('on',b.dataset.p===a);b.setAttribute('aria-selected',b.dataset.p===a);const d=b.querySelector('.pdot');if(d)d.classList.toggle('ok',configured(b.dataset.p))});
  $('provGH').hidden=a!=='github';$('provAZ').hidden=a!=='ado';
  const managed=(a==='github'?getGH():getAZ()).relay;
  $('provMode').textContent=managed?'Managed by the relay (.env) — credentials never reach this page':relayOn()?'Relay connected — this provider uses browser settings':'Stored in this browser';
  ['ghOwner','ghRepo','ghBranch','ghPath','ghToken'].forEach(id=>{const el=$(id);if(el)el.readOnly=!!getGH().relay});
  ['azOrg','azProject','azRepo','azBranch','azPath','azToken'].forEach(id=>{const el=$(id);if(el)el.readOnly=!!getAZ().relay});
  const cp=caps(a);
  $('provCaps').innerHTML=CAPROWS[a].map(([k,t,d])=>{const on=!!cp[k];return '<span class="cap '+(on?'on':'off')+'" title="'+h(on?d:(d+' — '+why(a,k)))+'"><i>'+(on?'✓':'○')+'</i>'+h(t)+'</span>'}).join('');
  const pm=publishMode(),prOK=!!cp.pr;
  $('pubSeg').querySelectorAll('button').forEach(b=>{b.classList.toggle('on',b.dataset.m===pm);if(b.dataset.m==='pr')b.disabled=!prOK});
  $('pubBranch').textContent=branchOf(a);
  $('pubHint').textContent=pm==='pr'?'Each entry gets its own branch ('+(((cfg()||{}).provider||{}).prBranchPrefix||'journal')+'/<date>-<title>) and one pull request; pushing again updates it.':prOK?'Commits land directly on '+branchOf(a)+'.':'Pull requests need the local relay.';
  const o=other(a),mt=$('mirrorToggle');mt.checked=mirror();mt.disabled=!configured(o);$('mirrorName').textContent=label(o)+(configured(o)?'':' (not configured)');
  const at=$('assetsToggle');if(at)at.closest('label').querySelector('.alabel').textContent=relayOn()?'Store pasted images as files in assets/ (the relay setting DAILY_ASSETS controls relay pushes)':'Store pasted images as files in assets/ on GitHub push (keeps .md small & diff-able)';
  $('provWarn').innerHTML=managed?'Tokens live in <code>.env</code> on this computer. Push checks for remote changes and asks before overwriting.':'Tokens are stored only in this browser. '+(a==='github'?'Push checks for remote changes and asks before overwriting.':'Use the relay for change checks on Azure DevOps.');
  const ru=repoUrl(a),ol=$('provOpen');if(ol){ol.hidden=!ru;ol.href=ru||'#';ol.textContent='Open in '+label(a)+' ↗'}
  renderLast();
}
function renderLast(){const el=$('lastPublish');if(!el)return;let l=null;try{l=JSON.parse(store.get(K.last)||'null')}catch(_){}
  if(!l||!l.results){el.innerHTML='';return}
  const t=new Date(l.at).toLocaleString();
  el.innerHTML='Last publish '+h(t)+': '+l.results.map(r=>r.pr?('<a href="'+h(r.pr.url)+'" target="_blank" rel="noopener">'+h(r.provider)+' pull request #'+h(r.pr.number)+' ↗</a>'):(r.url?'<a href="'+h(r.url)+'" target="_blank" rel="noopener">'+h(r.provider)+(r.unchanged?' (no changes)':'')+' ↗</a>':h(r.provider)+(r.unchanged?' (no changes)':''))).join(' · ')+(l.errors&&l.errors.length?' · <span style="color:var(--err)">'+h(l.errors.join(' | '))+'</span>':'')}
function apply(){renderModal();const b=$('rRepo');if(b){b.innerHTML='◎<span class="pv">'+(active()==='github'?'GH':'AZ')+'</span>';b.title='Repositories · '+label(active())}
  try{repoBadges();renderRibbon()}catch(_){}}
/* Ribbon popover: switch provider + jump to provider features */
repoPopover=function(e){e.stopPropagation();const a=active(),cp=caps(a),ready=configured(a),av=['github','ado'];
  const sw='<div class="pop-prov">'+av.map(p=>'<button class="'+(p===a?'primary':'')+'" onclick="DailyProvider.set(\''+p+'\');closePop();repoPopover(event)">'+(configured(p)?'● ':'○ ')+label(p)+'</button>').join('')+'</div>';
  const pm=publishMode();
  const links=[];if(cp.issues)links.push('<button onclick="closePop();openWorkItems(\'focus\')">'+(a==='github'?'Issues':'Work items')+'</button>');
  if(cp.projects)links.push('<button onclick="closePop();openWorkItems(\'project\')">Project board</button>');
  if(cp.runs)links.push('<button onclick="closePop();openWorkItems(\'runs\')">'+(a==='github'?'Actions runs':'Pipeline runs')+'</button>');
  const ru=repoUrl(a);if(ru)links.push('<button onclick="closePop();window.open(\''+ru.replace(/'/g,'%27')+'\',\'_blank\',\'noopener\')">Open '+label(a)+' ↗</button>');
  openPop($('rRepo'),'repo','<h4>'+label(a)+'<small>'+(ready?(pm==='pr'?'Publishing as pull requests':'Publishing to '+branchOf(a))+(mirrorTarget()?' · mirroring to '+label(mirrorTarget()):''):'Not configured yet')+'</small></h4>'+sw+
    '<button class="primary" onclick="closePop();pushRepos()">'+(pm==='pr'?'⇡ Open pull request':'↑ Push current entry')+' <span class="st '+(ready?'ready':'')+'">'+(ready?'ready':'setup')+'</span></button><button onclick="closePop();pullRepos()">↓ Pull entries</button>'+links.join('')+'<button onclick="closePop();openRepository(\'overview\')">Browse repository</button><button onclick="closePop();openModal(\'repoModal\')">Repository settings</button>')};
/* Relay-mode Test + Diagnose use the relay's view of the repository */
async function relayTest(p){const st=p==='github'?'ghStatus':'azStatus';setSt(st,'Testing…','info');
  try{const r=await fetch('/api/repositories/test?provider='+p);const j=await r.json();if(!r.ok)throw new Error((j.error&&j.error.message)||r.status);
    setSt(st,'Connected ✓ '+h(j.name)+(j.private?' (private)':'')+' · branch '+h(j.branch)+(j.branchExists?'':' <b>not found</b>')+(j.canPush===false?' · <b>read-only token</b>':''),j.branchExists&&j.canPush!==false?'ok':'err')}catch(e){setSt(st,'Relay test failed: '+h(e.message),'err')}}
const _testGH=testGH,_testAZ=testAZ;
testGH=function(){return getGH().relay?relayTest('github'):_testGH()};
testAZ=function(){return getAZ().relay?relayTest('ado'):_testAZ()};
const _diag=diagRepos;
diagRepos=async function(outId,append){const a=active(),c=a==='github'?getGH():getAZ();if(!c.relay)return _diag(outId,append);
  const out=$(outId||'repoDiag');out.style.display='block';out.textContent='Diagnosing '+label(a)+' through the relay…';
  try{const t=await (await fetch('/api/repositories/test?provider='+a)).json();const f=await (await fetch('/api/repositories/files?provider='+a)).json();
    const files=f.value||[];out.textContent=['■ '+label(a)+' '+(t.name||'?')+(t.project?(' ('+t.project+')'):''),'  branch: '+t.branch+(t.branchExists?'':'  ← NOT FOUND'),'  folder: '+(t.root||'(root)'),'  journal files: '+files.length,'  newest: '+(files.map(x=>x.path).sort().slice(-3).join(', ')||'(none)'),'  publish: '+publishMode()+(mirrorTarget()?' · mirror → '+label(mirrorTarget()):''),'  capabilities: '+Object.entries(caps(a)).filter(x=>x[1]).map(x=>x[0]).join(', ')].join('\n')}
  catch(e){out.textContent='Diagnose failed: '+e.message}};
function wire(){
  const seg=$('provSeg');if(!seg||seg._w)return;seg._w=true;
  seg.querySelectorAll('button').forEach(b=>b.onclick=()=>set(b.dataset.p));
  $('pubSeg').querySelectorAll('button').forEach(b=>b.onclick=()=>{if(b.disabled)return;store.set(K.pm,b.dataset.m);renderModal();toast(b.dataset.m==='pr'?'Pushes will open pull requests.':'Pushes will commit directly.')});
  $('mirrorToggle').onchange=e=>{store.set(K.m,e.target.checked?'1':'0');renderModal()};
  const mod=$('repoModal');if(mod)new MutationObserver(()=>{if(mod.classList.contains('open'))renderModal()}).observe(mod,{attributes:true,attributeFilter:['class']});
}
document.addEventListener('daily:relay',()=>{apply()});
window.DailyProvider={active,set,available,configured,caps,mirror,mirrorTarget,publishMode,label,relayOn,repoUrl,apply};
function boot(){wire();apply()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
