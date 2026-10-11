(function(){'use strict';
var KEY='daily.workspace.v1';
var S=load();
function load(){try{return Object.assign({on:false,left:{open:false,w:280},right:{open:false,w:400},bottom:{open:false,h:260},bottomTab:'board',rightTab:'focus',aiHistory:[]},JSON.parse(localStorage.getItem(KEY)||'{}'))}catch(e){return{on:false,left:{open:false,w:280},right:{open:false,w:400},bottom:{open:false,h:260},bottomTab:'board',rightTab:'focus',aiHistory:[]}}}
function save(){try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}}
function el(s){return document.querySelector(s)}
function id(x){return document.getElementById(x)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function css(k,v){document.documentElement.style.setProperty(k,v)}
function measureTop(){var t=document.querySelector('.top');css('--ws-top',((t?t.offsetHeight:52))+'px')}

/* ---------------- layout apply ---------------- */
function apply(){
  document.body.classList.toggle('ws-on',!!S.on);
  var L=S.left.open&&S.on,R=S.right.open&&S.on,B=S.bottom.open&&S.on;
  css('--ws-dl',L?S.left.w+'px':'0px');
  css('--ws-dr',R?S.right.w+'px':'0px');
  css('--ws-db',B?S.bottom.h+'px':'0px');
  id('wsLeft').dataset.open=L?'1':'0';
  id('wsRight').dataset.open=R?'1':'0';
  id('wsBottom').dataset.open=B?'1':'0';
  id('wsRailLeft').classList.toggle('show',S.on&&!S.left.open);
  id('wsRailRight').classList.toggle('show',S.on&&!S.right.open);
  id('wsRailBottom').classList.toggle('show',S.on&&!S.bottom.open);
  save();
}
function openDock(side,on){S[side].open=(on==null?!S[side].open:!!on);if(!S.on&&S[side].open)S.on=true;apply();if(S[side].open)renderDock(side);syncStudioSection();}
window.dailyWorkspace={
  toggle:function(on){S.on=(on==null?!S.on:!!on);if(S.on&&!(S.left.open||S.right.open||S.bottom.open))S.left.open=S.right.open=S.bottom.open=true;apply();renderAll();syncStudioSection();},
  open:function(side,on){openDock(side,on)},
  preset:function(name){applyPreset(name)},
  state:function(){return JSON.parse(JSON.stringify(S))}
};

/* ---------------- presets (mirror Experience names) ---------------- */
var PRESETS={
  builder:{on:true,left:true,right:true,bottom:'board'},
  focused:{on:true,left:false,right:false,bottom:false},
  executive:{on:true,left:false,right:true,bottom:'ai'},
  research:{on:true,left:true,right:false,bottom:'ai'},
  creative:{on:true,left:false,right:false,bottom:false}
};
function applyPreset(name){var p=PRESETS[name];if(!p)return;S.on=p.on;S.left.open=!!p.left;S.right.open=!!p.right;S.bottom.open=!!p.bottom;if(p.bottom)S.bottomTab=p.bottom;apply();renderAll();syncStudioSection();if(typeof toast==='function')toast('Workspace: '+name);}

/* ---------------- resize ---------------- */
function wireResize(){
  document.querySelectorAll('[data-ws-rz]').forEach(function(h){
    var side=h.dataset.wsRz;
    h.addEventListener('pointerdown',function(e){
      e.preventDefault();h.classList.add('drag');h.setPointerCapture(e.pointerId);
      var sx=e.clientX,sy=e.clientY,sw=S.left.w,swr=S.right.w,sh=S.bottom.h;
      function mv(ev){
        if(side==='left')S.left.w=Math.max(200,Math.min(520,sw+(ev.clientX-sx)));
        else if(side==='right')S.right.w=Math.max(280,Math.min(680,swr-(ev.clientX-sx)));
        else S.bottom.h=Math.max(160,Math.min(window.innerHeight*0.7,sh-(ev.clientY-sy)));
        apply();
      }
      function up(ev){h.classList.remove('drag');h.releasePointerCapture(e.pointerId);document.removeEventListener('pointermove',mv);document.removeEventListener('pointerup',up);save();}
      document.addEventListener('pointermove',mv);document.addEventListener('pointerup',up);
    });
  });
}

/* ============================================================ RENDERERS ============================================================ */
function renderAll(){if(S.left.open)renderLeft();if(S.right.open)renderRight();if(S.bottom.open)renderBottom();}
function renderDock(side){if(side==='left')renderLeft();else if(side==='right')renderRight();else renderBottom();}

/* ---- LEFT: Repository tree ---- */
function entries(){try{return (typeof allEntries==='function')?allEntries()||[]:[]}catch(e){return[]}}
function projectOf(x){try{if(typeof projectSlugs==='function'){var s=projectSlugs(x.text||'');if(s&&s.length)return s[0]}}catch(e){}var m=(x.text||'').match(/#project\/([\w\-./]+)/i);return m?m[1]:(x.project||'')}
function renderLeft(){
  var host=id('wsLeftBody');if(!host)return;
  var all=entries();
  var prov='local';try{if(typeof provider==='function')prov=provider()}catch(e){}
  var filter=(host._filter||'').toLowerCase();
  var groups={};
  all.forEach(function(x){var p=projectOf(x)||'Unfiled';(groups[p]=groups[p]||[]).push(x)});
  var names=Object.keys(groups).sort(function(a,b){if(a==='Unfiled')return 1;if(b==='Unfiled')return -1;return a.localeCompare(b)});
  var collapsed=host._collapsed||{};
  var body='<div class="ws-status"><span class="dot"></span>'+esc(prov)+' · '+all.length+' entries</div>'+
    '<div class="ws-tree-tools"><input id="wsTreeSearch" placeholder="Filter entries…" value="'+esc(host._filter||'')+'"><button id="wsTreeNew" title="New entry" style="border:1px solid var(--line);background:var(--canvas);color:var(--ink);border-radius:7px;padding:0 10px;cursor:pointer">＋</button></div>';
  if(!all.length){body+='<div class="ws-empty">No stored entries yet.<br>Write and save, or open Repository to sync.</div>'}
  names.forEach(function(p){
    var items=groups[p].slice().sort(function(a,b){return String(b.date||'').localeCompare(String(a.date||''))});
    var shown=filter?items.filter(function(x){return ((x.title||'')+' '+(x.date||'')+' '+(x.text||'')).toLowerCase().indexOf(filter)>=0}):items;
    if(filter&&!shown.length)return;
    var isC=collapsed[p]&&!filter;
    body+='<div class="ws-grp'+(isC?' collapsed':'')+'" data-grp="'+esc(p)+'"><div class="gh" data-grp-h="'+esc(p)+'"><span class="caret">▾</span>'+esc(p==='Unfiled'?'Unfiled':'#'+p)+'<span class="cnt">'+shown.length+'</span></div><div class="items">'+
      shown.map(function(x){return '<button class="ws-leaf" data-date="'+esc(x.date||'')+'" data-id="'+esc(x.id||'')+'"><span class="dt">'+esc(String(x.date||'').slice(5))+'</span>'+esc(x.title||'Untitled note')+'<span class="src">'+esc(x.source&&x.source!=='local'?'ADO':'local')+'</span></button>'}).join('')+
    '</div></div>';
  });
  host.innerHTML=body;
  var srch=id('wsTreeSearch');if(srch)srch.oninput=function(){host._filter=srch.value;var pos=srch.selectionStart;renderLeft();var s2=id('wsTreeSearch');if(s2){s2.focus();try{s2.setSelectionRange(pos,pos)}catch(e){}}};
  var nw=id('wsTreeNew');if(nw)nw.onclick=function(){try{if(typeof newDailyNote==='function')newDailyNote();else if(typeof openBrowse==='function')openBrowse()}catch(e){}};
  host.querySelectorAll('[data-grp-h]').forEach(function(h){h.onclick=function(){var p=h.dataset.grpH;host._collapsed=host._collapsed||{};host._collapsed[p]=!host._collapsed[p];renderLeft()}});
  host.querySelectorAll('.ws-leaf').forEach(function(b){b.onclick=function(){var dt=b.dataset.date,i=b.dataset.id;try{if(typeof openEntry==='function')openEntry(dt,i);else if(typeof openBrowse==='function')openBrowse()}catch(e){}}});
}

/* ---- RIGHT: Work Items (reuses DailyWIT) ---- */
function witOK(){return !!window.DailyWIT}
async function renderRight(){
  var host=id('wsRightBody');if(!host)return;
  if(!witOK()){host.innerHTML='<div class="ws-empty">Work Items module not loaded.</div>';return}
  await DailyWIT.ensure();
  fillWitProjects();setWitTabs();
  host.innerHTML='<div style="padding:11px" id="wsWitMount"></div>';
  var mount=id('wsWitMount');
  try{
    if(S.rightTab==='board')await DailyWIT.mountBoard(mount);
    else await DailyWIT.mountFocus(mount);
  }catch(e){host.innerHTML='<div class="ws-empty">'+esc(e.message)+'</div>'}
}
function fillWitProjects(){
  var sel=id('wsWitProject');if(!sel)return;
  if(!DailyWIT.multiProject()){sel.style.display='none';return}
  sel.style.display='';
  var ps=DailyWIT.projects()||[],cur=DailyWIT.curProject(),dp=DailyWIT.defaultProject();
  if(!ps.length){sel.innerHTML='<option>'+esc(cur||dp||'(default)')+'</option>';DailyWIT.loadProjects().then(function(){fillWitProjects()});return}
  sel.innerHTML=ps.map(function(p){return '<option'+(p.name===cur?' selected':'')+'>'+esc(p.name)+'</option>'}).join('');
  sel.onchange=function(){DailyWIT.setProject(sel.value);renderRight()};
}
function setWitTabs(){id('wsWitTabs').querySelectorAll('button').forEach(function(b){b.classList.toggle('on',b.dataset.t===S.rightTab);b.onclick=function(){S.rightTab=b.dataset.t;save();setWitTabs();renderRight()}})}

/* ---- BOTTOM: Board + AI tabs ---- */
function renderBottom(){setBottomTabs();var t=S.bottomTab;id('wsPaneBoard').hidden=t!=='board';id('wsPaneAi').hidden=t!=='ai';if(t==='board')renderBottomBoard();else renderAi();}
function setBottomTabs(){id('wsBottomTabs').querySelectorAll('button[data-t]').forEach(function(b){b.classList.toggle('on',b.dataset.t===S.bottomTab);b.onclick=function(){S.bottomTab=b.dataset.t;save();renderBottom()}})}
async function renderBottomBoard(){var host=id('wsPaneBoard');if(!witOK()){host.innerHTML='<div class="ws-empty">Work Items module not loaded.</div>';return}host.innerHTML='<div style="padding:11px" id="wsBoardMount"></div>';try{await DailyWIT.ensure();await DailyWIT.mountBoard(id('wsBoardMount'))}catch(e){host.innerHTML='<div class="ws-empty">'+esc(e.message)+'</div>'}}

/* ---- AI console ---- */
var AI=S.aiHistory||[];
function aiReadyX(){try{return typeof aiReady==='function'&&aiReady()}catch(e){return false}}
function aiScope(){return S.aiScope==='entry'?'entry':'journal'}
function aiQuick(){
  var gh=(function(){try{return !window.DailyProvider||DailyProvider.active()==='github'}catch(e){return true}})();
  return aiScope()==='journal'
    ?[['This week','Summarize what I worked on, decided and learned over the last 7 days.'],['Open threads','What open questions, blockers and unfinished threads appear in my recent entries?'],['Decisions','List the decisions I recorded, with the reasoning I gave and the date of each.'],['What do I know about…','What have I written about ']]
    :[['Summarize entry','Summarize my current journal entry concisely.'],[gh?'Draft an issue':'Draft a work item','From my current entry, propose one '+(gh?'GitHub issue (title, description, labels, acceptance criteria)':'Azure DevOps work item (type, title, description, acceptance criteria)')+'.'],['Next steps','List concrete next steps based on my current entry.']];
}
function renderAi(){
  var log=id('wsAiLog');if(!log)return;
  var R=window.dailyAI;
  if(!AI.length){log.innerHTML='<div class="ws-msg system">'+(aiReadyX()?(aiScope()==='journal'?'Ask about anything in your journal. Answers cite the entries they draw on — click a date to open it.':'Ask about the entry you have open.'):'Connect an AI provider in Studio → AI model to chat here.')+'</div>'}
  else log.innerHTML=AI.map(function(m,i){
    if(m.role==='assistant'&&R)return '<div class="ws-msg assistant ai-rich">'+R.renderAnswer(m.content,m.sources)+(m.meta?'<div class="ai-meta">'+esc(m.meta)+'</div>':'')+'</div>';
    return '<div class="ws-msg '+m.role+'">'+esc(m.content)+'</div>'}).join('');
  log.scrollTop=log.scrollHeight;
  var quick=id('wsAiQuick');var Q=aiQuick();
  quick.innerHTML='<span class="ai-scope" role="group" aria-label="Answer from"><button data-scope="journal" class="'+(aiScope()==='journal'?'on':'')+'">Whole journal</button><button data-scope="entry" class="'+(aiScope()==='entry'?'on':'')+'">This entry</button></span>'+
    Q.map(function(q,i){return '<button data-q="'+i+'">'+esc(q[0])+'</button>'}).join('')+(AI.length?'<button data-clear title="Clear the conversation">Clear</button>':'');
  quick.querySelectorAll('[data-scope]').forEach(function(b){b.onclick=function(){S.aiScope=b.dataset.scope;save();renderAi()}});
  quick.querySelectorAll('[data-q]').forEach(function(b){b.onclick=function(){var p=Q[+b.dataset.q][1],inp=id('wsAiInput');inp.value=p;if(/ $/.test(p)){inp.focus();inp.setSelectionRange(p.length,p.length)}else aiSend()}});
  var cl=quick.querySelector('[data-clear]');if(cl)cl.onclick=function(){AI.length=0;persistAi();renderAi()};
  log.querySelectorAll('[data-cite]').forEach(function(a){a.onclick=function(e){e.preventDefault();if(R)R.openEntry(a.dataset.cite,a.dataset.id)}});
}
function entryContext(){try{return (typeof entryText==='function')?entryText().slice(0,8000):''}catch(e){return''}}
async function aiSend(){
  var inp=id('wsAiInput');var text=(inp.value||'').trim();if(!text)return;
  if(!aiReadyX()){AI.push({role:'system',content:'Connect an AI provider in Studio → AI model first.'});persistAi();renderAi();return}
  AI.push({role:'user',content:text});inp.value='';inp.style.height='auto';persistAi();renderAi();
  var log=id('wsAiLog');var wait=document.createElement('div');wait.className='ws-msg assistant ai-rich';wait.innerHTML='<span class="ai-typing"><i></i><i></i><i></i></span>';log.appendChild(wait);log.scrollTop=log.scrollHeight;
  var R=window.dailyAI,scope=aiScope(),ctx,sources=[];
  if(scope==='journal'&&R){var hits=R.retrieve(text+' '+AI.filter(function(m){return m.role==='user'}).slice(-3,-1).map(function(m){return m.content}).join(' '),7);sources=hits.map(function(h){return {date:h.date,id:h.id,title:h.title}});ctx=R.contextBlock(hits)}
  var sys=scope==='journal'
    ?'You are the research assistant inside The Daily, a personal engineering and research journal. Answer from the journal excerpts below. Cite every claim with the entry date in square brackets, in the form [YYYY-MM-DD]. If the excerpts don\'t contain the answer, say so plainly and suggest what to write down. Be concise and specific; prefer short paragraphs or bullets.\n\n'+(ctx||'(No matching entries were found.)')
    :'You are a concise assistant embedded in The Daily journal. The user\'s current entry follows for context:\n\n'+entryContext();
  var msgs=[{role:'system',content:sys}].concat(AI.filter(function(m){return m.role==='user'||m.role==='assistant'}).slice(-8).map(function(m){return {role:m.role,content:m.content}}));
  try{
    var r=await aiChat(msgs,{max:1200,temp:.3,onToken:function(t){if(R){wait.innerHTML=R.renderAnswer(t,sources);log.scrollTop=log.scrollHeight}}});
    var L=window.__aiLast||{},meta=[];if(scope==='journal')meta.push(sources.length+' entr'+(sources.length===1?'y':'ies')+' sent');if(L.ms)meta.push((L.ms/1000).toFixed(1)+' s');if(L.usage&&L.usage.total_tokens)meta.push(L.usage.total_tokens+' tokens');
    AI.push({role:'assistant',content:r,sources:sources,meta:meta.join(' · ')});persistAi();renderAi()}
  catch(e){wait.className='ws-msg system';wait.textContent='Error: '+e.message}
}
function persistAi(){S.aiHistory=AI.slice(-40);save()}

/* ============================================================ STUDIO SECTION ============================================================
   Workspace is configured from Studio — the same configuration
   center that owns appearance, providers, and everything else.
   The floating nav popover this used to be is gone; day-to-day
   access is the edge rails + Alt+1/2/3/` below, which don't move. */
var PANELS=[['left','▤','Repository','Entry tree, grouped by project','Alt 1'],['right','▥','Work Items','Focus and board views','Alt 2'],['bottom','▦','Board · AI','Kanban board + journal-aware AI chat','Alt 3']];
var PRESET_INFO={builder:'Repository + Work Items + Board',focused:'Everything closed — just the entry',executive:'Work Items + AI console',research:'Repository + AI console',creative:'Everything closed — open canvas'};
function panelCard(p){return '<div class="studio-card ws-panel-card"><div class="ws-panel-head"><span class="ws-panel-icon">'+p[1]+'</span><div><h5>'+esc(p[2])+'</h5><small class="muted">'+esc(p[3])+'</small></div><button class="ws-switch" data-side-switch="'+p[0]+'"><i></i></button></div><div class="ws-panel-meta"><span>'+esc(p[2])+' dock</span><kbd>'+esc(p[4])+'</kbd></div></div>'}
function installStudioSection(){
  var sec=document.querySelector('.studio-section[data-s="workspace"]');
  if(!sec)return false;
  if(sec.querySelector('.ws-master'))return true;
  sec.insertAdjacentHTML('beforeend',
    '<div class="studio-card ws-master"><div class="ws-master-row"><div><h5>Docking workspace</h5><small class="muted">Turn the three-panel workspace on or off.</small></div><button class="ws-switch" id="wsStudioMaster"><i></i></button></div></div>'+
    '<div class="ws-panel-grid">'+PANELS.map(panelCard).join('')+'</div>'+
    '<div class="studio-card"><h5>Layout presets</h5><div class="intro" style="margin:3px 0 10px">Presets choose which panels are open — nothing else changes.</div><div class="ws-preset-grid">'+
      Object.keys(PRESET_INFO).map(function(n){return '<button class="ws-preset-btn" data-ws-preset="'+n+'"><b>'+n[0].toUpperCase()+n.slice(1)+'</b><small>'+esc(PRESET_INFO[n])+'</small></button>'}).join('')+
    '</div></div>'+
    '<div class="studio-card"><h5>Shortcuts</h5><dl class="diag-grid"><dt>Toggle workspace</dt><dd>Alt + `</dd><dt>Repository panel</dt><dd>Alt + 1</dd><dt>Work Items panel</dt><dd>Alt + 2</dd><dt>Board · AI panel</dt><dd>Alt + 3</dd></dl></div>');
  id('wsStudioMaster').onclick=function(){dailyWorkspace.toggle()};
  sec.querySelectorAll('[data-side-switch]').forEach(function(sw){sw.onclick=function(){openDock(sw.dataset.sideSwitch)}});
  sec.querySelectorAll('[data-ws-preset]').forEach(function(p){p.onclick=function(){applyPreset(p.dataset.wsPreset)}});
  return true;
}
function syncStudioSection(){
  var sec=document.querySelector('.studio-section[data-s="workspace"]');if(!sec)return;
  var m=id('wsStudioMaster');if(m)m.classList.toggle('on',!!S.on);
  sec.querySelectorAll('[data-side-switch]').forEach(function(sw){sw.classList.toggle('on',S.on&&S[sw.dataset.sideSwitch].open)});
  sec.querySelectorAll('[data-ws-preset]').forEach(function(p){var n=p.dataset.wsPreset,pr=PRESETS[n];p.classList.toggle('on',!!pr&&S.on===pr.on&&S.left.open===!!pr.left&&S.right.open===!!pr.right&&S.bottom.open===!!pr.bottom)});
}

/* ---------------- boot ---------------- */
function wireHeaderButtons(){
  document.querySelectorAll('[data-ws-close]').forEach(function(b){b.onclick=function(){openDock(b.dataset.wsClose,false)}});
  id('wsRailLeft').onclick=function(){openDock('left',true)};
  id('wsRailRight').onclick=function(){openDock('right',true)};
  id('wsRailBottom').onclick=function(){openDock('bottom',true)};
  id('wsLeftRefresh').onclick=renderLeft;
  id('wsLeftOpen').onclick=function(){try{(typeof openRepository==='function'?openRepository:openBrowse)('overview')}catch(e){}};
  id('wsRightRefresh').onclick=function(){if(witOK())DailyWIT.refresh();setTimeout(renderRight,250)};
  id('wsAiSend').onclick=aiSend;
  var ta=id('wsAiInput');if(ta){ta.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();aiSend()}});ta.addEventListener('input',function(){ta.style.height='auto';ta.style.height=Math.min(120,ta.scrollHeight)+'px'})}
}
function keys(){
  document.addEventListener('keydown',function(e){
    if(e.altKey&&e.key==='`'){e.preventDefault();dailyWorkspace.toggle()}
    else if(e.altKey&&e.key==='1'){e.preventDefault();openDock('left')}
    else if(e.altKey&&e.key==='2'){e.preventDefault();openDock('right')}
    else if(e.altKey&&e.key==='3'){e.preventDefault();openDock('bottom')}
  });
}
/* keep Work Items Focus in sync as the user edits (#ado/<id> links) */
function watchEntry(){
  var e=id('entry'),src=id('source');
  function ping(){if(S.on&&S.right.open&&S.rightTab==='focus'){clearTimeout(window._wsT);window._wsT=setTimeout(function(){renderRight()},800)}}
  if(e)e.addEventListener('input',ping);if(src)src.addEventListener('input',ping);
}
function init(){
  measureTop();window.addEventListener('resize',measureTop);
  wireHeaderButtons();wireResize();keys();watchEntry();
  apply();renderAll();syncStudioSection();
  var st=0,siv=setInterval(function(){if(installStudioSection()||++st>200){clearInterval(siv);syncStudioSection()}},50);
}
var t=0,iv=setInterval(function(){
  if(document.querySelector('.nav')&&id('entry')&&document.querySelector('.top')){clearInterval(iv);init()}
  else if(++t>200)clearInterval(iv);
},50);
})();
