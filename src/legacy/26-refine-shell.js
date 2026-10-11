(function(){'use strict';
var $=function(x){return document.getElementById(x)};
var K={ui:'daily:ui.v2',intro:'daily:introSeen',studio:'daily:studioSection'};
function get(k){try{return localStorage.getItem(k)}catch(_){return null}}
function put(k,v){try{localStorage.setItem(k,v)}catch(_){}}
function h(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
var MAC=/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent||'');
var MOD=MAC?'⌘':'Ctrl';
function provGH(){try{return !window.DailyProvider||DailyProvider.active()==='github'}catch(_){return true}}
function relayCfg(){return window.__relayConfig||null}

/* ---------------------------------------------------------------- main view */
function calmDefaults(){
  if(get(K.ui))return;put(K.ui,'1');
  try{var w=window.dailyWorkspace;if(!w)return;var s=w.state();['left','right','bottom'].forEach(function(k){if(s[k]&&s[k].open)w.open(k,false)})}catch(_){}
}
function tagToolbar(){var t=$('toolbar');if(!t)return;t.querySelectorAll('.tb').forEach(function(x){var ti=(x.title||'').toLowerCase();if(/^undo|^redo/.test(ti)){var g=x.closest('.grp');if(g)g.classList.add('tb-hist')}if(/clear format|remove format/.test(ti))x.classList.add('tb-clear')})}
function rails(){
  var gh=provGH(),L={wsRailLeft:['▤','Repository'],wsRailRight:['▥',gh?'Issues':'Work items'],wsRailBottom:['▦','Board · AI']};
  Object.keys(L).forEach(function(k){var b=$(k);if(!b)return;b.innerHTML='<span class="ri" aria-hidden="true">'+L[k][0]+'</span><span class="rl">'+h(L[k][1])+'</span>';b.setAttribute('aria-label','Open '+L[k][1]+' panel');b.title=L[k][1]});
  var t=document.querySelector('#wsRight .ws-head .ttl');if(t)t.textContent=gh?'Issues':'Work items';
  [].forEach.call(document.querySelectorAll('#studioModal .ws-panel-card h5, #studioModal .diag-grid dt'),function(x){x.textContent=x.textContent.replace(/^(Work Items|Work items|Issues)/,gh?'Issues':'Work items')});
}

/* ---------------------------------------------------------------- introduction */
function hasWritten(){try{return typeof allEntries==='function'&&allEntries().some(function(e){return String(e.text||'').trim().length>0})}catch(_){return false}}
function setupLine(){
  var c=relayCfg(),parts=[];
  if(c){
    if(c.github&&c.github.enabled)parts.push('GitHub');
    if(c.ado&&c.ado.enabled)parts.push('Azure DevOps');
    if(c.ai&&c.ai.configured)parts.push('AI · '+(c.ai.model||'configured'));
    return parts.length?{ok:true,text:'Relay connected · '+parts.join(' · ')+' — credentials stay in .env'}:{ok:true,text:'Relay connected · add integrations in .env when you want them'};
  }
  return {ok:false,text:'Running in this browser only · everything works offline; connect a repository or AI in Studio'};
}
function showIntro(){
  if($('introBack'))return;
  var st=setupLine();
  var back=document.createElement('div');back.className='intro-back';back.id='introBack';
  back.innerHTML='<div class="intro-card" role="dialog" aria-modal="true" aria-labelledby="introTitle">'+
    '<button class="ix" data-x aria-label="Close">✕</button>'+
    '<div class="intro-kicker"><span class="mk"><i></i></span>The Daily · local-first journal</div>'+
    '<h2 id="introTitle">A precise record of your work.</h2>'+
    '<p class="intro-lede">Write plainly. The Daily structures, links and keeps every entry — on this device, in plain Markdown, published only when you say so.</p>'+
    '<ol class="intro-steps">'+
      '<li><span class="n">01</span><div><b>Capture</b><span>Press <kbd>/</kbd> for scaffolds — decisions, experiments, findings, blockers. Each one tags itself as you insert it.</span></div></li>'+
      '<li><span class="n">02</span><div><b>Connect</b><span>Tags and links turn entries into a knowledge graph you can browse and search here, or open as an Obsidian vault.</span></div></li>'+
      '<li><span class="n">03</span><div><b>Publish</b><span>Push entries to GitHub or Azure DevOps and keep the related issues, boards and runs beside your notes.</span></div></li>'+
      '<li><span class="n">04</span><div><b>Keep it yours</b><span>No account, no server, no trackers. With the relay, your tokens never leave the <code>.env</code> file on your computer.</span></div></li>'+
    '</ol>'+
    '<div class="intro-keys"><span><kbd>/</kbd>scaffolds</span><span><kbd>'+MOD+' K</kbd>commands</span><span><kbd>'+MOD+' S</kbd>save</span><span><kbd>Alt 1–3</kbd>panels</span></div>'+
    '<div class="intro-status"><i class="'+(st.ok?'ok':'')+'"></i>'+h(st.text)+'</div>'+
    '<div class="intro-actions"><button class="btn primary" data-go="write">Start writing</button><button class="btn" data-go="tour">Take the full tour</button><span class="sp"></span><button class="lnk" data-go="studio">Settings</button></div>'+
  '</div>';
  document.body.appendChild(back);
  var prev=document.activeElement;
  function close(next){put(K.intro,new Date().toISOString());document.removeEventListener('keydown',onKey,true);back.remove();
    if(next==='tour'&&typeof openAbout==='function')openAbout();
    else if(next==='studio'&&typeof openStudioHome==='function')openStudioHome('general');
    else{var e=$('entry');if(e)try{e.focus()}catch(_){}else if(prev&&prev.focus)prev.focus()}}
  function onKey(e){if(e.key==='Escape'){e.preventDefault();close()}else if(e.key==='Tab'){var f=back.querySelectorAll('button');var first=f[0],last=f[f.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}}
  document.addEventListener('keydown',onKey,true);
  back.addEventListener('click',function(e){if(e.target===back){close();return}var x=e.target.closest('[data-x],[data-go]');if(x)close(x.dataset.go)});
  setTimeout(function(){var p=back.querySelector('[data-go="write"]');if(p)p.focus()},30);
}
window.dailyIntro={show:showIntro,reset:function(){try{localStorage.removeItem(K.intro)}catch(_){}}};

/* ---------------------------------------------------------------- Studio */
var NAV=[
  ['Personal',[['general','General','Name, theme, editor width'],['appearance','Appearance','Color, type, density'],['workspace','Panels','Docks, presets, shortcuts']]],
  ['Intelligence',[['models','AI model','Provider and connection'],['intelligence','Signals','What gets surfaced, and when'],['knowledge','Knowledge schema','Tags and frontmatter']]],
  ['Connections',[['integrations','Repository & tracking','GitHub or Azure DevOps']]],
  ['Data & system',[['data','Backup & export','Portability and storage'],['advanced','Diagnostics','Runtime checks and reset'],['about','About','Version and introduction']]]
];
var INFO={};NAV.forEach(function(g){g[1].forEach(function(x){INFO[x[0]]=x})});
function sec(k){return document.querySelector('#studioModal .studio-section[data-s="'+k+'"]')}
function ensureSection(k){var s=sec(k);if(s)return s;var host=document.querySelector('#studioModal .studio-content');if(!host)return null;s=document.createElement('section');s.className='studio-section';s.dataset.s=k;s.innerHTML='<h4></h4><p class="intro"></p>';host.appendChild(s);return s}
function row(label,desc,control){return '<div class="st-row"><div class="lb"><b>'+h(label)+'</b>'+(desc?'<small>'+h(desc)+'</small>':'')+'</div><div class="ct">'+control+'</div></div>'}
/* Wrap loose nodes into cards, starting a new card at each loose <h5>. */
function normalize(s){
  var kids=[].slice.call(s.children).filter(function(c){return c.tagName!=='H4'&&!(c.classList.contains('intro')&&c.parentElement===s&&c.tagName==='P')});
  var card=null;
  kids.forEach(function(c){
    if(c.classList.contains('studio-card')||c.classList.contains('ws-panel-grid')){card=null;return}
    if(c.tagName==='H5'||!card){card=document.createElement('div');card.className='studio-card';s.insertBefore(card,c)}
    card.appendChild(c);
  });
  s.querySelectorAll('.studio-card').forEach(function(cd){if(!cd.children.length)cd.remove()});
}
function moveRow(card,node,label,desc){if(!node)return;var r=document.createElement('div');r.className='st-row';r.innerHTML='<div class="lb"><b>'+h(label)+'</b>'+(desc?'<small>'+h(desc)+'</small>':'')+'</div><div class="ct"></div>';r.querySelector('.ct').appendChild(node);card.appendChild(r)}
function dropLabel(node,tag,text){var p=node&&node.previousElementSibling;if(p&&p.tagName===tag&&(!text||p.textContent.trim().toLowerCase().indexOf(text)===0))p.remove()}
function buildGeneral(){
  var s=ensureSection('general');if(s.querySelector('.st-general'))return;
  var name=$('nameField'),theme=$('themeSeg'),width=$('widthSeg');
  dropLabel(name,'H5','your name');dropLabel(theme,'H5','appearance');dropLabel(width,'LABEL','editor width');
  var card=document.createElement('div');card.className='studio-card st-general';
  moveRow(card,name,'Your name','Used in greetings and summaries. Stored only in this browser.');
  moveRow(card,theme,'Theme','Auto follows your operating system.');
  moveRow(card,width,'Editor width','Measure of the writing column.');
  var intro=document.createElement('div');intro.className='st-row';intro.innerHTML='<div class="lb"><b>Introduction</b><small>The welcome overview shown on first visit.</small></div><div class="ct"><button class="btn" data-st="intro">Show introduction</button><button class="btn" data-st="about">Full tour</button></div>';
  card.appendChild(intro);s.appendChild(card);
  var app=sec('appearance'),leg=app&&app.querySelector('.aw-legacy');if(leg){leg.querySelectorAll('.aw-built').forEach(function(c){app.appendChild(c)});leg.querySelectorAll('.studio-launch').forEach(function(x){x.remove()});if(!leg.querySelector('input,button,select,textarea')){leg.innerHTML='';leg.style.display='none'}}
}
function buildIntegrations(){
  var s=ensureSection('integrations');var P=window.DailyProvider;
  var host=s.querySelector('.st-int');if(!host){host=document.createElement('div');host.className='st-int';s.appendChild(host)}
  if(!P){host.innerHTML='<div class="studio-card"><p class="muted">Repository settings are loading…</p></div>';return}
  try{P.apply()}catch(_){}
  var a=P.active(),other=a==='github'?'ado':'github',c=relayCfg(),managed=!!(c&&((a==='github'&&c.github&&c.github.enabled)||(a==='ado'&&c.ado&&c.ado.enabled)));
  var caps=($('provCaps')||{}).innerHTML||'';
  var pm=P.publishMode(),mt=P.mirrorTarget();
  host.innerHTML=
    '<div class="studio-card">'+
      row('Active provider','Publishing, the work drawer and run status follow this choice.','<div class="seg" data-st-prov>'+['github','ado'].map(function(p){return '<button data-p="'+p+'" class="'+(p===a?'on':'')+'">'+(P.configured(p)?'● ':'○ ')+h(P.label(p))+'</button>'}).join('')+'</div>')+
      row('Credentials',managed?'Read from .env by the relay; never sent to this page.':(P.relayOn()?'This provider is not set in .env, so browser settings are used.':'Stored in this browser.'),'<span class="cap '+(P.configured(a)?'on':'off')+'"><i>'+(P.configured(a)?'✓':'○')+'</i>'+(P.configured(a)?(managed?'Managed by relay':'Configured'):'Not configured')+'</span>')+
      row('Publishing',pm==='pr'?'Each entry gets its own branch and pull request.':'Entries are committed directly to the branch.','<span class="cap on"><i>↑</i>'+(pm==='pr'?'Pull request':'Commit')+'</span>'+(mt?'<span class="cap on"><i>⇉</i>Mirrors to '+h(P.label(mt))+'</span>':''))+
      row('Capabilities','Hover a chip for details or what is missing.','<div class="st-caps">'+caps+'</div>')+
      '<div class="bar"><button class="btn primary" data-st="repo">Repository settings…</button><button class="btn" data-st="browse">Browse repository</button><button class="btn" data-st="test">Test connection</button></div>'+
      '<p class="st-note">Tokens, owners and folders are edited in Repository settings. Switching providers here never deletes the other provider’s settings.</p>'+
    '</div>';
  host.querySelectorAll('[data-st-prov] button').forEach(function(b){b.onclick=function(){if(b.dataset.p!==P.active()){P.set(b.dataset.p);buildIntegrations()}}});
}
function buildAbout(){
  var s=ensureSection('about');var host=s.querySelector('.st-about');if(!host){host=document.createElement('div');host.className='st-about';s.appendChild(host)}
  var seen=get(K.intro),c=relayCfg();
  host.innerHTML='<div class="studio-card"><h5>The Daily</h5><p class="muted">A local-first journal for engineering and research work. Entries live in this browser and are published as plain Markdown to a repository you control.</p>'+
    '<dl class="st-kv"><dt>Version</dt><dd id="stVersion">'+(c&&c.version?h(c.version):'—')+'</dd><dt>Mode</dt><dd>'+(c?'Local relay (credentials in .env)':'Browser only')+'</dd><dt>Storage</dt><dd>This browser · '+h(location.host||'file')+'</dd><dt>Introduction</dt><dd>'+(seen?(isNaN(Date.parse(seen))?'Seen':'Seen '+h(new Date(seen).toLocaleDateString())):'Not yet shown')+'</dd><dt>License</dt><dd>MIT</dd></dl>'+
    '<div class="bar"><button class="btn" data-st="intro">Show introduction</button><button class="btn" data-st="about">Full tour</button><button class="btn" data-st="abouttab">Open tour in a new tab</button></div></div>'+
    '<div class="studio-card"><h5>Privacy</h5><p class="muted" style="margin-bottom:0">No analytics, no third-party scripts, no account. Content leaves this device only when you publish to your repository or run an AI action against the provider you configured.</p></div>';
  if(c&&!c.version)fetch('/healthz').then(function(r){return r.json()}).then(function(j){var v=$('stVersion');if(v&&j.version)v.textContent=j.version+' (relay)'}).catch(function(){});
}
function act(k){
  if(k==='intro'){closeModal('studioModal');showIntro()}
  else if(k==='about'){closeModal('studioModal');if(typeof openAbout==='function')openAbout()}
  else if(k==='abouttab'){if(typeof openAboutTab==='function')openAboutTab()}
  else if(k==='repo'){closeModal('studioModal');openModal('repoModal')}
  else if(k==='browse'){closeModal('studioModal');if(typeof openRepository==='function')openRepository('overview')}
  else if(k==='test'){var a=window.DailyProvider?DailyProvider.active():'github';closeModal('studioModal');openModal('repoModal');setTimeout(function(){try{(a==='github'?testGH:testAZ)()}catch(_){}} ,60)}
}
function buildRail(){
  var rail=document.querySelector('#studioModal .studio-rail');if(!rail||rail.dataset.v3)return;rail.dataset.v3='1';
  rail.innerHTML='<label class="st-search"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg><input id="stSearch" type="search" placeholder="Search settings" aria-label="Search settings" autocomplete="off"></label>'+
    NAV.map(function(g){return '<div class="st-group">'+h(g[0])+'</div>'+g[1].map(function(x){return '<button class="studio-nav" data-s="'+x[0]+'" onclick="studioSection(\''+x[0]+'\')">'+h(x[1])+'<small>'+h(x[2])+'</small></button>'}).join('')}).join('')+
    '<div class="st-empty" id="stEmpty" hidden>No matching settings</div>';
  var q=$('stSearch');
  q.addEventListener('input',function(){var t=q.value.trim().toLowerCase(),firstHit=null;
    rail.querySelectorAll('.studio-nav').forEach(function(b){var s=sec(b.dataset.s),hay=(b.textContent+' '+(s?s.textContent:'')+' '+[].map.call(s?s.querySelectorAll('input[placeholder]'):[],function(i){return i.placeholder}).join(' ')).toLowerCase();var hit=!t||hay.indexOf(t)>=0;b.hidden=!hit;if(hit&&!firstHit)firstHit=b});
    rail.querySelectorAll('.st-group').forEach(function(g){var n=g.nextElementSibling,any=false;while(n&&!n.classList.contains('st-group')){if(n.classList.contains('studio-nav')&&!n.hidden)any=true;n=n.nextElementSibling}g.hidden=!any});
    $('stEmpty').hidden=!!firstHit;
    if(t&&firstHit){var cur=rail.querySelector('.studio-nav.on');if(!cur||cur.hidden)studioSection(firstHit.dataset.s)}});
  q.addEventListener('keydown',function(e){if(e.key==='Enter'){var b=rail.querySelector('.studio-nav:not([hidden])');if(b)studioSection(b.dataset.s)}else if(e.key==='Escape'&&q.value){e.stopPropagation();q.value='';q.dispatchEvent(new Event('input'))}});
}
var installed=false;
function installStudio(){
  if(installed)return true;
  var lay=$('studioLayout');if(!lay||!sec('workspace')||!sec('workspace').querySelector('.ws-master'))return false;
  installed=true;
  var modal=document.querySelector('#studioModal .modal');var ms=modal&&modal.querySelector('.ms');if(ms)ms.textContent='Preferences for this browser. Credentials kept in .env are never shown here.';
  try{if(typeof window.renderAppearance==='function')window.renderAppearance()}catch(_){}
  buildGeneral();
  ensureSection('integrations');ensureSection('about');
  ['models','intelligence','knowledge','data','advanced'].forEach(function(k){var s=sec(k);if(s)normalize(s)});
  /* tidy specific headings */
  [].forEach.call(document.querySelectorAll('#studioModal .studio-section[data-s="data"] h5'),function(x){if(x.textContent.trim()==='Data')x.textContent='Storage'});
  [].forEach.call(document.querySelectorAll('#studioModal .studio-section[data-s="appearance"] .aw-built h5'),function(x){if(/^Layout/.test(x.textContent))x.textContent='Layout, motion & editing'});
  Object.keys(INFO).forEach(function(k){var s=ensureSection(k);if(!s)return;var t=s.querySelector('h4'),p=s.querySelector(':scope > p.intro');if(t)t.textContent=INFO[k][1];if(p)p.textContent=INFO[k][2]});
  /* order sections to match the navigation */
  var host=document.querySelector('#studioModal .studio-content');NAV.forEach(function(g){g[1].forEach(function(x){var s=sec(x[0]);if(s)host.appendChild(s)})});
  buildRail();
  [].forEach.call(document.querySelectorAll('#studioModal .studio-danger .btn'),function(btn){var t=btn.textContent.trim(),ai=/AI configuration/.test(t),repo=/repository credentials/.test(t);if(!ai&&!repo)return;btn.removeAttribute('onclick');btn.addEventListener('click',function(){if(!confirm(t+'? This only affects this browser'+(relayCfg()?'; settings in .env are unchanged.':'.')))return;try{if(ai){store.rm(LS.ai);toast('AI configuration removed.')}else{store.rm(LS.gh);store.rm(LS.az);toast('Repository credentials removed.')}}catch(_){}})});
  document.querySelector('#studioModal').addEventListener('click',function(e){var b=e.target.closest('[data-st]');if(b)act(b.dataset.st)});
  /* remember the last section; build live sections when shown */
  var orig=window.studioSection;
  window.studioSection=function(t){if(!sec(t))t='general';orig(t);put(K.studio,t);if(t==='integrations')buildIntegrations();if(t==='about')buildAbout();var c=document.querySelector('#studioModal .studio-content');if(c)c.scrollTop=0};
  var origHome=window.openStudioHome;
  window.openStudioHome=function(t){origHome(t||get(K.studio)||'general');studioSection(t||get(K.studio)||'general')};
  studioSection(get(K.studio)||'general');rails();
  return true;
}

/* ---------------------------------------------------------------- boot */
function boot(){
  calmDefaults();rails();tagToolbar();
  var tries=0;(function wait(){if(!installStudio()&&tries++<60)setTimeout(wait,100)})();
  if(!get(K.intro)&&!hasWritten())setTimeout(function(){if(!get(K.intro)&&!document.querySelector('.mback.open')&&!($('aboutBack')&&$('aboutBack').classList.contains('open')))showIntro()},450);
  else if(!get(K.intro))put(K.intro,'existing-user');
}
document.addEventListener('daily:provider',function(){rails();if(sec('integrations')&&sec('integrations').classList.contains('on'))buildIntegrations()});
document.addEventListener('daily:relay',function(){rails()});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(boot,60)});else setTimeout(boot,60);
})();
