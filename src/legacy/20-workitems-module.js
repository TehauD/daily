(function(){'use strict';
/* ---- state ---- */
var CFG=null, TAB='focus', ITEMS=[], DETAILS={}, dismissedAmbient='', booting=false;
/* ---- multi-project state ---- */
var PROJECT=(function(){try{return localStorage.getItem('daily.wit.project')||''}catch(e){return ''}})();
var PROJECTS=null, TYPES_CACHE={}, projectsLoading=false;
function defaultProject(){return TR().project||''}
function curProject(){return GH()?defaultProject():(PROJECT||defaultProject())}
function setProject(p){PROJECT=p||'';try{PROJECT?localStorage.setItem('daily.wit.project',PROJECT):localStorage.removeItem('daily.wit.project')}catch(e){}}
function multiProject(){return !GH()&&TR().multiProject!==false}
/* querystring + body helpers that scope every call to the chosen project */
function pq(extra){var p=curProject(),parts=['provider='+PV()];if(p&&!GH())parts.push('project='+encodeURIComponent(p));(extra||[]).forEach(function(x){parts.push(x)});return parts.length?'?'+parts.join('&'):''}
function withP(obj){var o=Object.assign({},obj||{});var p=curProject();if(p&&!GH())o.project=p;o.provider=PV();return o}
var STATES=['New','Active','Resolved','Closed','Committed','Approved','Done','To Do','In Progress','Doing','Proposed','Removed'];
/* ---- provider awareness: GitHub Issues or Azure Boards, chosen by the active provider ---- */
function PV(){try{return window.DailyProvider?DailyProvider.active():'ado'}catch(e){return 'ado'}}
function GH(){return PV()==='github'}
function TR(){var t=CFG&&CFG.tracking&&CFG.tracking[PV()];if(t)return t;
  if(!GH()&&CFG&&CFG.workItems)return Object.assign({system:'Azure DevOps',label:'Work items',noun:'work item',refPrefix:'ado',states:STATES,iterationLabel:'Iteration',tagsLabel:'Tags',html:true,
    webUrl:CFG.workItems.organization?'https://dev.azure.com/'+encodeURIComponent(CFG.workItems.organization)+'/_workitems/edit/{id}':''},CFG.workItems);
  return {enabled:false,system:GH()?'GitHub':'Azure DevOps',label:GH()?'Issues':'Work items',noun:GH()?'issue':'work item',refPrefix:GH()?'gh':'ado',states:GH()?['Open','Closed','Not planned']:STATES,types:[]}}
function CAP(k){try{return !!DailyProvider.caps()[k]}catch(e){return false}}
function states(){return TR().states||STATES}
function noun(){return TR().noun||'work item'}
/* ---- tiny utils ---- */
function d(id){return document.getElementById(id)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function say(m){try{if(typeof toast==='function')toast(m)}catch(e){}}
function log(name,attrs,level){try{if(window.workspaceEvents)workspaceEvents.emit({category:'repository',name:name,status:level==='error'?'failed':'success',level:level||'info',attributes:attrs||{}})}catch(e){}}
function txt(){try{return entryText()}catch(e){return ''}}
function clientKey(){try{return (typeof getS==='function'&&getS().relayClientKey)||''}catch(e){return ''}}
function F(it,k){return it&&it.fields&&it.fields[k]!=null?it.fields[k]:''}
function stateClass(s){s=String(s||'').toLowerCase();if(/(closed|done|completed|removed|not planned)/.test(s))return 'closed';if(s==='open')return 'active';if(/(resolved|committed)/.test(s))return 'resolved';if(/(active|in progress|approved|doing|committed)/.test(s))return 'active';return 'new'}
function assignedName(it){var a=F(it,'System.AssignedTo');return a&&a.displayName?a.displayName:(typeof a==='string'&&a?a:'Unassigned')}
function editURL(id){var u=TR().webUrl;return u?u.replace('{id}',encodeURIComponent(id)):'#'}
function stripHtml(s){return String(s||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
function refIds(){var t=txt(),out=[],m,re=new RegExp('#'+(TR().refPrefix||'ado')+'\\/(\\d+)','g');while((m=re.exec(t)))if(out.indexOf(m[1])<0)out.push(m[1]);return out}
async function api(path,opt){opt=opt||{};var h=Object.assign({'Content-Type':'application/json'},opt.headers||{});var k=clientKey();if(k)h['X-Daily-Client-Key']=k;opt.headers=h;var r=await fetch(path,opt);var raw=await r.text();var j;try{j=JSON.parse(raw)}catch(e){j={error:{message:raw||('HTTP '+r.status)}}}if(!r.ok)throw new Error((j&&j.error&&j.error.message)||(j&&j.message)||('HTTP '+r.status));return j}
/* ---- config ---- */
async function loadConfig(force){if(CFG&&!force)return CFG;try{CFG=await api('/api/config')}catch(e){CFG=null}return CFG}
function enabled(){return !!TR().enabled}
function relayUp(){return !!CFG}
function types(){var live=TYPES_CACHE[PV()+':'+curProject()];if(live&&live.length)return live;return TR().types||['Bug','Task','User Story']}
/* Load the project list once and fill the header picker. */
async function loadProjects(force){
  if(!enabled())return;
  if(PROJECTS&&!force){fillProjectPicker();return}
  if(projectsLoading)return;projectsLoading=true;
  var sel=d('witProject');if(sel)sel.innerHTML='<option>Loading projects…</option>';
  try{var j=await api('/api/workitems/projects');PROJECTS=j.value||[];
    if(!curProject()&&j.default)setProject('');/* keep env default implicit */
    fillProjectPicker();
  }catch(e){PROJECTS=[];var s2=d('witProject');if(s2){var dp=defaultProject();s2.innerHTML='<option value="">'+(dp?esc(dp):'(default)')+'</option>';s2.title='Project list unavailable: '+e.message}}
  finally{projectsLoading=false}
}
function fillProjectPicker(){
  var sel=d('witProject');if(!sel)return;
  if(!multiProject()){sel.style.display='none';return}
  sel.style.display='';
  var cur=curProject(),dp=defaultProject(),opts=[];
  var have=(PROJECTS||[]).some(function(p){return p.name===cur});
  (PROJECTS||[]).forEach(function(p){opts.push('<option value="'+esc(p.name)+'"'+(p.name===cur?' selected':'')+'>'+esc(p.name)+(p.name===dp?' \u2605':'')+'</option>')});
  if(cur&&!have)opts.unshift('<option value="'+esc(cur)+'" selected>'+esc(cur)+'</option>');
  if(!opts.length)opts.push('<option value="">'+(dp?esc(dp):'(no projects)')+'</option>');
  sel.innerHTML=opts.join('');
  sel.onchange=async function(){setProject(sel.value);DETAILS={};ITEMS=[];say('Project: '+(curProject()||'default'));await loadTypes();renderDiag();render();refreshChips();refreshAmbient()};
}
/* Optional: pull live work item types for the selected project (falls back to env list). */
async function loadTypes(){var p=PV()+':'+curProject();if(TYPES_CACHE[p])return;try{var j=await api('/api/workitems/types'+pq());var names=(j.value||[]).map(function(t){return t.name}).filter(function(n){return n&&!/^(Code Review|Feedback|Shared|Test )/.test(n)});if(names.length)TYPES_CACHE[p]=names}catch(e){}}
/* ---- detection (reuses the app's own intelligence) ---- */
function detected(){
  var t=txt(),out={decision:0,blocker:0,task:0};
  try{if(typeof candidates==='function'){candidates(t).forEach(function(c){if(c.tag==='type/decision')out.decision++;else if(c.tag==='type/blocker')out.blocker++})}}catch(e){}
  (t.match(/^\s*[-*]\s+\[ \]/gm)||[]).forEach(function(){out.task++});
  out.total=out.decision+out.blocker+out.task;out.signature=out.decision+'|'+out.blocker+'|'+out.task;
  return out;
}
/* ============================================================ DRAWER ============================================================ */
function openDrawer(tab){if(tab)TAB=tab;var el=d('witDrawer');el.classList.add('open');el.setAttribute('aria-hidden','false');renderTabs();renderDiag();render();ensureConfigThenRender();if(enabled()){loadProjects();loadTypes()}}
function closeDrawer(){var el=d('witDrawer');el.classList.remove('open');el.setAttribute('aria-hidden','true')}
window.openWorkItems=function(tab){openDrawer(tab||'focus')};
window.closeWorkItems=closeDrawer;
async function ensureConfigThenRender(){if(!CFG){await loadConfig();renderDiag();render();if(enabled()){loadProjects();loadTypes()}}}
function tabList(){var t=[['focus','Focus'],['board',GH()?'Issues':'Board'],['create','Create']];if(GH()&&TR().projects&&CAP('projects'))t.push(['project','Project']);if(CAP('runs'))t.push(['runs',GH()?'Actions':'Pipelines']);return t}
function renderTabs(){var host=d('witTabs'),list=tabList();if(!list.some(function(x){return x[0]===TAB}))TAB='focus';
  host.innerHTML=list.map(function(x){return '<button data-wt="'+x[0]+'"'+(x[0]===TAB?' class="on"':'')+'>'+x[1]+'</button>'}).join('');
  host.querySelectorAll('button').forEach(function(b){b.onclick=function(){TAB=b.dataset.wt;render()}});
  var tt=d('witTitle');if(tt)tt.textContent=TR().label||'Work items';var sub=d('witSub');if(sub)sub.innerHTML=esc(TR().system||'')+' &middot; '+esc(curProject()||'not configured');
  var sel=d('witProject');if(sel&&!multiProject())sel.style.display='none'}
function renderDiag(){
  var relay=relayUp(), en=enabled();
  var wit=relay?(en?'<b>on</b>':'<b class="off">off</b>'):'<b class="err">n/a</b>';
  var proj=curProject()?esc(curProject()):'&mdash;';
  var isDefault=curProject()&&curProject()===defaultProject();
  d('witDiag').innerHTML='Relay '+(relay?'<b>up</b>':'<b class="err">down</b>')+' &middot; '+esc(TR().label||'Work items')+' '+wit+' &middot; '+(GH()?'Repo':'Project')+' <b>'+proj+'</b>'+(isDefault&&!GH()?' \u2605':'')+' &middot; Linked <b>'+refIds().length+'</b>';
}
function render(){
  renderTabs();
  var b=d('witBody');
  if(!relayUp()){b.innerHTML=notConnected();return}
  if(TAB==='runs'){renderRuns(b);return}
  if(!enabled()){b.innerHTML=notEnabled();return}
  if(TAB==='focus')renderFocus(b);
  else if(TAB==='board')renderBoard(b);
  else if(TAB==='project')renderProjectBoard(b);
  else renderCreate(b);
}
function notConnected(){return '<div class="wit-empty"><b>The relay isn\u2019t reachable.</b><br><br>Open The Daily through the relay at <code>http://127.0.0.1:8000</code> (run <code>python relay.py</code>), not from a file. Then reopen this drawer.</div>'}
function notEnabled(){if(GH())return '<div class="wit-empty"><b>GitHub Issues are off.</b><br><br>In <code>.env</code> set <code>DAILY_GITHUB_ISSUES_ENABLED=true</code> and give the GitHub token <b>Issues: Read and write</b>.<br>Restart the relay and reopen.</div>';return '<div class="wit-empty"><b>Work item tracking is off.</b><br><br>In <code>.env</code> set:<br><code>DAILY_ADO_ENABLED=true</code><br><code>DAILY_ADO_WIT_ENABLED=true</code><br>plus <code>DAILY_ADO_ORGANIZATION</code>, <code>DAILY_ADO_PROJECT</code>, and a PAT with <b>Work Items (Read &amp; Write)</b>.<br>Restart the relay and reopen.</div>'}
/* ---------------- FOCUS: this entry + its tracked work ---------------- */
async function renderFocus(b){
  var ids=refIds(), det=detected();
  var html='';
  /* detected-but-untracked */
  if(det.total){
    var parts=[];if(det.decision)parts.push('<b>'+det.decision+'</b> decision'+(det.decision>1?'s':''));if(det.blocker)parts.push('<b>'+det.blocker+'</b> blocker'+(det.blocker>1?'s':''));if(det.task)parts.push('<b>'+det.task+'</b> task'+(det.task>1?'s':''));
    html+='<div class="wit-detected"><div class="dtxt">This entry contains '+parts.join(' &middot; ')+' that aren\u2019t tracked in '+esc(TR().system)+' yet.</div><div class="acts"><button onclick="witDraftFromEntry()">&#10022; Draft '+esc(noun())+'</button><button class="ghost" onclick="openWorkItems(\'create\')">Create manually</button></div></div>';
  }
  html+='<div class="wit-sec">Tracked by this entry ('+ids.length+')</div>';
  if(!ids.length){html+='<div class="wit-empty">No <code>#'+esc(TR().refPrefix||'ado')+'/&lt;id&gt;</code> links in this entry yet.<br>Draft one above, or link an existing item from the <b>Board</b> tab.</div>'}
  b.innerHTML=html+'<div id="witFocusList"></div>';
  var list=d('witFocusList');
  if(!ids.length)return;
  list.innerHTML=ids.map(function(id){return '<div class="wit-card" id="witF_'+id+'"><div class="wit-empty" style="padding:14px">Loading #'+id+'\u2026</div></div>'}).join('');
  ids.forEach(async function(id){try{var it=DETAILS[id]||(DETAILS[id]=await api('/api/workitems/'+id+pq()));var el=d('witF_'+id);if(el){el.outerHTML=cardHTML(it,true);loadCardComments(id);loadCardProject(id)}}catch(e){var el2=d('witF_'+id);if(el2)el2.innerHTML='<div class="wit-empty" style="padding:14px">#'+id+' could not load: '+esc(e.message)+'</div>'}});
}
/* --- Safe HTML rendering for ADO rich-text fields (Description, Acceptance, Repro) --- */
var WIT_ALLOWED={A:1,B:1,STRONG:1,I:1,EM:1,U:1,P:1,BR:1,DIV:1,SPAN:1,UL:1,OL:1,LI:1,H1:1,H2:1,H3:1,H4:1,PRE:1,CODE:1,BLOCKQUOTE:1,TABLE:1,THEAD:1,TBODY:1,TR:1,TD:1,TH:1,IMG:1,HR:1};
function sanitizeHtml(html){
  if(!html)return '';
  var doc;try{doc=new DOMParser().parseFromString('<div>'+html+'</div>','text/html')}catch(e){return esc(stripHtml(html))}
  var root=doc.body.firstChild;
  (function walk(node){
    var kids=Array.prototype.slice.call(node.childNodes);
    kids.forEach(function(ch){
      if(ch.nodeType===1){
        var tag=ch.tagName;
        if(!WIT_ALLOWED[tag]){ // unwrap disallowed tags, keep their text
          while(ch.firstChild)node.insertBefore(ch.firstChild,ch);node.removeChild(ch);return;
        }
        // strip all attributes except safe href/src
        Array.prototype.slice.call(ch.attributes||[]).forEach(function(a){
          var n=a.name.toLowerCase(),v=a.value||'';
          var keep=(tag==='A'&&n==='href'&&/^(https?:|mailto:)/i.test(v))||(tag==='IMG'&&n==='src'&&/^(https?:|data:image\/)/i.test(v));
          if(!keep)ch.removeAttribute(a.name);
        });
        if(tag==='A'){ch.setAttribute('target','_blank');ch.setAttribute('rel','noopener noreferrer')}
        walk(ch);
      }else if(ch.nodeType===8){node.removeChild(ch)} // drop comments
    });
  })(root);
  return root.innerHTML;
}
function hasText(html){return stripHtml(html).length>0}
/* --- Parse Test Case steps XML (Microsoft.VSTS.TCM.Steps) into Action/Expected rows --- */
function decodeEntities(s){try{var t=document.createElement('textarea');t.innerHTML=String(s||'');return t.value}catch(e){return String(s||'')}}
function parseTestSteps(xml){
  if(!xml||typeof xml!=='string'||xml.indexOf('<step')<0)return [];
  var out=[];
  try{
    var doc=new DOMParser().parseFromString(xml,'text/xml');
    if(!doc.getElementsByTagName('parsererror').length){
      var steps=doc.getElementsByTagName('step');
      for(var i=0;i<steps.length;i++){
        var ps=steps[i].getElementsByTagName('parameterizedString');
        out.push({action:stripHtml(ps[0]?ps[0].textContent:''),expected:stripHtml(ps[1]?ps[1].textContent:'')});
      }
      if(out.length)return out;
    }
  }catch(e){}
  /* regex fallback */
  try{
    var stepRe=/<step\b[^>]*>([\s\S]*?)<\/step>/gi,psRe=/<parameterizedString[^>]*>([\s\S]*?)<\/parameterizedString>/gi,m;
    while((m=stepRe.exec(xml))){
      var body=m[1],p,cells=[];while((p=psRe.exec(body)))cells.push(p[1]);psRe.lastIndex=0;
      out.push({action:stripHtml(decodeEntities(cells[0]||'')),expected:stripHtml(decodeEntities(cells[1]||''))});
    }
  }catch(e){}
  return out;
}
function fmtDate(s){if(!s)return '';try{var d2=new Date(s);return d2.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})}catch(e){return String(s).slice(0,10)}}
function initials(name){name=String(name||'?').trim();var p=name.split(/\s+/);return ((p[0]||'')[0]||'')+((p[1]||'')[0]||'')||name[0]||'?'}
function section(id,label,count,bodyHTML,collapsed){
  return '<div class="wit-detail-sec'+(collapsed?' collapsed':'')+'" id="'+id+'"><div class="h" onclick="witToggleSec(\''+id+'\')"><span class="caret">\u25BE</span>'+esc(label)+(count!=null?'<span class="cnt">'+count+'</span>':'')+'</div><div class="body">'+bodyHTML+'</div></div>';
}
window.witToggleSec=function(id){var el=d(id);if(el)el.classList.toggle('collapsed')};
function factsHTML(it){
  var rows=[];
  function add(k,v){if(v!=null&&String(v).trim()!=='')rows.push('<div class="k">'+esc(k)+'</div><div class="v">'+esc(v)+'</div>')}
  add('Type',F(it,'System.WorkItemType'));
  add('State',F(it,'System.State')+(F(it,'System.Reason')?' \u00b7 '+F(it,'System.Reason'):''));
  add('Assigned',assignedName(it));
  var pr=F(it,'Microsoft.VSTS.Common.Priority');if(pr)add('Priority','P'+pr);
  add('Area',F(it,'System.AreaPath'));
  add(TR().iterationLabel||'Iteration',F(it,'System.IterationPath'));
  var tags=F(it,'System.Tags');if(tags)add(TR().tagsLabel||'Tags',String(tags).split(';').map(function(x){return x.trim()}).filter(Boolean).join(', '));
  add('Created',fmtDate(F(it,'System.CreatedDate'))+(F(it,'System.CreatedBy')&&F(it,'System.CreatedBy').displayName?' by '+F(it,'System.CreatedBy').displayName:''));
  add('Changed',fmtDate(F(it,'System.ChangedDate')));
  return '<div class="wit-facts">'+rows.join('')+'</div>';
}
function cardHTML(it,editable){
  var id=it.id,st=F(it,'System.State'),ty=F(it,'System.WorkItemType');
  var h='<div class="wit-card" id="witF_'+id+'">'+
    '<div class="top"><span class="wit-dot '+stateClass(st)+'" style="margin-top:5px"></span><b>'+esc(F(it,'System.Title'))+'</b><a class="wit-open" href="'+editURL(id)+'" target="_blank" rel="noopener">#'+id+' \u2197</a></div>'+
    '<div class="meta"><span class="wit-badge type">'+esc(ty)+'</span><span class="wit-badge">'+esc(st)+'</span><span class="wit-badge">'+esc(assignedName(it))+'</span>'+(F(it,'Microsoft.VSTS.Common.Priority')?'<span class="wit-badge">P'+esc(F(it,'Microsoft.VSTS.Common.Priority'))+'</span>':'')+'</div>';
  if(editable){
    /* quick-edit */
    h+='<div class="row"><label>State</label><input list="witStateList" id="wf_state_'+id+'" value="'+esc(st)+'"></div>'+
       '<div class="row"><label>Assigned</label><input id="wf_asg_'+id+'" value="'+esc(assignedName(it))+'" placeholder="'+(GH()?'GitHub username':'email or name')+'"></div>'+
       (GH()&&TR().projects&&CAP('projects')?'<div class="row"><label>Project</label><select id="wf_proj_'+id+'" onchange="witSetProjectStatus('+id+',this.value)"><option>Loading\u2026</option></select></div>':'')+
       '<div class="acts">'+
         '<button class="primary" onclick="witSaveCard('+id+')">Save</button>'+
         '<button class="ai" onclick="witSummarize('+id+')">&#10022; Summarize into entry</button>'+
         '<button class="ai" onclick="witGenAcceptance('+id+')">&#10022; Acceptance criteria</button>'+
       '</div>';
    /* --- rich detail sections --- */
    h+='<div id="witDetail_'+id+'">'+detailSectionsHTML(it)+'</div>';
  }
  return h+'</div>';
}
/* Build all the detail sections for a work item (Details, Description, Acceptance, Repro, Steps, Discussion). */
function detailSectionsHTML(it){
  var id=it.id,ty=String(F(it,'System.WorkItemType')||'').toLowerCase();
  var out='';
  out+=section('sec_facts_'+id,'Details',null,factsHTML(it),false);
  var desc=F(it,'System.Description');
  out+=section('sec_desc_'+id,'Description',null,hasText(desc)?'<div class="wit-rich">'+sanitizeHtml(desc)+'</div>':'<div class="wit-muted">No description.</div>',!hasText(desc));
  var ac=F(it,'Microsoft.VSTS.Common.AcceptanceCriteria');
  if(hasText(ac)||/user story|feature|epic|product backlog/.test(ty))
    out+=section('sec_ac_'+id,'Acceptance criteria',null,hasText(ac)?'<div class="wit-rich">'+sanitizeHtml(ac)+'</div>':'<div class="wit-muted">None yet. Use \u2726 Acceptance criteria to draft with AI.</div>',!hasText(ac));
  var repro=F(it,'Microsoft.VSTS.TCM.ReproSteps');
  if(hasText(repro))out+=section('sec_repro_'+id,'Repro steps',null,'<div class="wit-rich">'+sanitizeHtml(repro)+'</div>',false);
  var steps=parseTestSteps(F(it,'Microsoft.VSTS.TCM.Steps'));
  if(steps.length){
    var rows='<div class="wit-steps"><div class="wit-step head"><div class="n">#</div><div class="act">Action</div><div class="exp">Expected</div></div>'+
      steps.map(function(s,i){return '<div class="wit-step"><div class="n">'+(i+1)+'</div><div class="act">'+esc(s.action||'\u2014')+'</div><div class="exp">'+esc(s.expected||'')+'</div></div>'}).join('')+'</div>';
    out+=section('sec_steps_'+id,'Test steps',steps.length,rows,false);
  }
  /* discussion loads async */
  out+=section('sec_disc_'+id,'Discussion','\u2026','<div id="witDisc_'+id+'"><div class="wit-muted">Loading comments\u2026</div></div>'+
    '<div class="wit-cmtbox"><textarea id="witCmt_'+id+'" placeholder="Add a comment\u2026"></textarea><button onclick="witPostComment('+id+')">Post</button></div>',false);
  return out;
}
/* Load + render the comment thread inline into a card. */
async function loadCardComments(id){
  var host=d('witDisc_'+id);if(!host)return;
  try{
    var j=await api('/api/workitems/'+id+'/comments'+pq());
    var list=(j&&j.comments)||[];
    var secCnt=d('sec_disc_'+id);if(secCnt){var c=secCnt.querySelector('.cnt');if(c)c.textContent=list.length}
    if(!list.length){host.innerHTML='<div class="wit-muted">No comments yet.</div>';return}
    // ADO returns newest-first; show oldest-first for readability
    list=list.slice().sort(function(a,b){return new Date(a.createdDate)-new Date(b.createdDate)});
    host.innerHTML='<div class="wit-disc">'+list.map(function(c){
      var who=(c.createdBy&&c.createdBy.displayName)||'Unknown';
      return '<div class="wit-cmt"><div class="who"><span class="av">'+esc(initials(who).toUpperCase())+'</span>'+esc(who)+'<span class="when">'+esc(fmtDate(c.createdDate))+'</span></div><div class="tx wit-rich">'+sanitizeHtml(c.text||'')+'</div></div>';
    }).join('')+'</div>';
  }catch(e){host.innerHTML='<div class="wit-muted">Comments unavailable: '+esc(e.message)+'</div>'}
}
window.witPostComment=async function(id){
  var ta=d('witCmt_'+id);if(!ta)return;var t=(ta.value||'').trim();if(!t){say('Write a comment first.');return}
  try{await api('/api/workitems/comment'+pq(),{method:'POST',body:JSON.stringify(withP({id:id,text:t}))});ta.value='';say('Comment posted to #'+id+'.');loadCardComments(id)}catch(e){say('Comment failed: '+e.message)}
};
/* Generate acceptance criteria with AI and save to the work item's field. */
window.witGenAcceptance=async function(id){
  if(!aiOK()){say('Connect an AI provider in Studio first.');return}
  var it=DETAILS[id];if(!it){say('Load the item first.');return}
  say('Drafting acceptance criteria for #'+id+'\u2026');
  try{
    var r=await aiChat([{role:'system',content:'Write 3-6 concise, testable acceptance criteria as an HTML unordered list (<ul><li>\u2026</li></ul>) only. No preamble.'},{role:'user',content:'Title: '+F(it,'System.Title')+'\nType: '+F(it,'System.WorkItemType')+'\nDescription: '+stripHtml(F(it,'System.Description'))}],{max:500,temp:.3});
    var htmlAc=/<li/i.test(r)?r:('<ul>'+r.split(/\n+/).filter(Boolean).map(function(x){return '<li>'+esc(x.replace(/^[-*]\s*/,''))+'</li>'}).join('')+'</ul>');
    DETAILS[id]=await api('/api/workitems/update'+pq(),{method:'POST',body:JSON.stringify(withP({id:id,fields:{'Microsoft.VSTS.Common.AcceptanceCriteria':htmlAc}}))});
    say('Acceptance criteria saved to #'+id+'.');
    var host=d('witDetail_'+id);if(host){host.innerHTML=detailSectionsHTML(DETAILS[id]);loadCardComments(id)}
  }catch(e){say('AI/save failed: '+e.message)}
};
window.witSaveCard=async function(id){
  var it=DETAILS[id];if(!it)return;var f={};
  var st=d('wf_state_'+id).value.trim();if(st&&st!==String(F(it,'System.State')||''))f['System.State']=st;
  var asg=d('wf_asg_'+id).value.trim();if(asg&&asg!==assignedName(it)&&asg!=='Unassigned')f['System.AssignedTo']=asg;
  if(!Object.keys(f).length){say('No changes to save.');return}
  try{DETAILS[id]=await api('/api/workitems/update'+pq(),{method:'POST',body:JSON.stringify(withP({id:id,fields:f}))});say('#'+id+' updated.');render();refreshChips();log('workitem.update.completed',{id:id})}catch(e){say('Update failed: '+e.message)}
};
window.witComment=async function(id){
  var t=prompt('Add a comment to work item #'+id+':');if(!t||!t.trim())return;
  try{await api('/api/workitems/comment'+pq(),{method:'POST',body:JSON.stringify(withP({id:id,text:t.trim()}))});say('Comment posted to #'+id+'.')}catch(e){say('Comment failed: '+e.message)}
};
/* ---------------- BOARD: query view ---------------- */
function renderBoard(b){
  b.innerHTML='<datalist id="witStateList">'+states().map(function(s){return '<option value="'+esc(s)+'">'}).join('')+'</datalist>'+
    '<div class="wit-toolbar">'+
      '<label><input type="checkbox" id="witMine" checked onchange="witQuery()"> Mine</label>'+
      (GH()?'<select id="witStateF" onchange="witQuery()"><option value="open">Open</option><option value="closed">Closed</option><option value="notplanned">Not planned</option><option value="all">All</option></select>'
           :'<select id="witStateF" onchange="witQuery()"><option value="open">Open</option><option value="active">Active</option><option value="new">New</option><option value="resolved">Resolved</option><option value="all">All</option></select>')+
      '<select id="witTypeF" onchange="witQuery()"><option value="">All types</option>'+types().map(function(t){return '<option value="'+esc(t)+'">'+esc(t)+'</option>'}).join('')+'</select>'+
      '<input class="search" id="witSearch" placeholder="Search titles\u2026" onkeydown="if(event.key===\'Enter\')witQuery()">'+
      '<button onclick="witQuery()">Search</button>'+
    '</div>'+
    '<div id="witBoardList"><div class="wit-empty">Loading\u2026</div></div>';
  witQuery();
}
function boardFilters(){
  if(GH()){var g=(d('witStateF')||{}).value||'open',gb={assignedToMe:(d('witMine')||{}).checked,search:((d('witSearch')||{}).value||'').trim()};
    if(g!=='all')gb.states=[{open:'Open',closed:'Closed',notplanned:'Not planned'}[g]];var gt=(d('witTypeF')||{}).value;if(gt)gb.types=[gt];return withP(gb)}
  var st=(d('witStateF')||{}).value||'open',states=null;
  if(st==='active')states=['Active','In Progress','Committed','Doing'];
  else if(st==='new')states=['New','To Do','Proposed'];
  else if(st==='resolved')states=['Resolved'];
  else if(st==='all')states='ALL';
  var body={assignedToMe:(d('witMine')||{}).checked,search:((d('witSearch')||{}).value||'').trim()};
  if(states&&states!=='ALL')body.states=states;
  if(states==='ALL'){var s=body.search.replace(/'/g,"''");body.wiql="SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject]=@project"+(body.assignedToMe?" AND [System.AssignedTo]=@Me":"")+(s?" AND [System.Title] CONTAINS '"+s+"'":"")+" ORDER BY [System.ChangedDate] DESC"}
  var tf=(d('witTypeF')||{}).value;if(tf)body.types=[tf];
  return withP(body);
}
window.witQuery=async function(){
  var el=d('witBoardList');if(!el)return;el.innerHTML='<div class="wit-empty"><span class="wit-busy">Querying\u2026</span></div>';
  try{var j=await api('/api/workitems/query'+pq(),{method:'POST',body:JSON.stringify(boardFilters())});ITEMS=j.value||[];
    if(!ITEMS.length){el.innerHTML='<div class="wit-empty">No '+esc(noun())+'s match.</div>';return}
    el.innerHTML=ITEMS.map(function(it){var id=it.id,st=F(it,'System.State'),linked=refIds().indexOf(String(id))>=0;
      return '<div class="wit-card"><div class="top"><span class="wit-dot '+stateClass(st)+'" style="margin-top:5px"></span><b>'+esc(F(it,'System.Title'))+'</b><a class="wit-open" href="'+editURL(id)+'" target="_blank" rel="noopener">#'+id+' \u2197</a></div><div class="meta"><span class="wit-badge type">'+esc(F(it,'System.WorkItemType'))+'</span><span class="wit-badge">'+esc(st)+'</span><span class="wit-badge">'+esc(assignedName(it))+'</span></div><div class="acts">'+(linked?'<button disabled style="opacity:.5">Linked \u2713</button>':'<button class="primary" onclick="witLink('+id+')">Link to entry</button>')+'<button class="ai" onclick="witSummarize('+id+')">&#10022; Summarize</button></div></div>'}).join('');
    DETAILS={};ITEMS.forEach(function(it){DETAILS[it.id]=it});log('workitem.query.completed',{count:ITEMS.length});
  }catch(e){el.innerHTML='<div class="wit-empty">Query failed: '+esc(e.message)+'</div>'}
};
/* ---------------- CREATE: AI-assisted ---------------- */
function renderCreate(b,pref){
  pref=pref||{};
  b.innerHTML='<div class="wit-card">'+
    '<div class="row"><label>'+(GH()?'Repository':'Project')+'</label><div style="font:600 12px var(--font);color:var(--ink)">'+esc(curProject()||'(default)')+(!GH()&&curProject()&&curProject()===defaultProject()?' <span style="color:var(--faint)">\u2605 default</span>':'')+(GH()?'':' <span style="color:var(--faint);font-weight:400">\u2014 change in header</span>')+'</div></div>'+
    '<div class="row"><label>Type</label><select id="witN_type">'+types().map(function(t){return '<option'+(t===(pref.type||TR().defaultType)?' selected':'')+'>'+esc(t)+'</option>'}).join('')+'</select></div>'+
    '<div class="row"><label>Title</label><input id="witN_title" value="'+esc(pref.title||'')+'"></div>'+
    '<div class="row"><label>Priority</label><input id="witN_prio" value="'+esc(pref.priority||(GH()?'':'2'))+'" placeholder="'+(GH()?'optional, 1-4 (adds a P label)':'1-4')+'"></div>'+
    '<div class="row"><label>'+esc(TR().tagsLabel||'Tags')+'</label><input id="witN_tags" value="'+esc(pref.tags||'the-daily')+'" placeholder="separate with ;"></div>'+
    '<div class="row"><label>Description</label><textarea id="witN_desc">'+esc(pref.description||'')+'</textarea></div>'+
    '<div class="acts">'+
      '<button class="primary" onclick="witCreate()">Create &amp; link</button>'+
      '<button class="ai" onclick="witDraftFromEntry()">&#10022; Draft from entry</button>'+
      '<button class="ai" onclick="witDraftFromSelection()">&#10022; From selection</button>'+
      '<button class="ai" onclick="witAcceptance()">&#10022; Acceptance criteria</button>'+
    '</div>'+
    '<div class="wit-note">'+(GH()?'Created as a GitHub issue with the relay-held token; the type and priority become labels and the description is Markdown.':'Created via JSON Patch on the relay-held PAT.')+' On success, <code>#'+esc(TR().refPrefix||'ado')+'/&lt;id&gt;</code> is inserted into this entry to link it'+(enterpriseOn()?' and a <b>tracks</b> edge is added to the enterprise graph':'')+'.</div>'+
  '</div>';
}
window.witCreate=async function(){
  var title=(d('witN_title').value||'').trim();if(!title){say('A title is required.');return}
  var fields={'System.Title':title};var pr=parseInt(d('witN_prio').value,10);if(pr)fields['Microsoft.VSTS.Common.Priority']=pr;
  var tags=(d('witN_tags').value||'').trim();if(tags)fields['System.Tags']=tags;
  var desc=(d('witN_desc').value||'').trim();if(desc)fields['System.Description']=TR().html===false?desc:desc.replace(/\n/g,'<br>');
  try{var it=await api('/api/workitems'+pq(),{method:'POST',body:JSON.stringify(withP({type:d('witN_type').value,fields:fields}))});
    DETAILS[it.id]=it;say('Created '+noun()+' #'+it.id+'.');linkId(it.id);await ingest(it);TAB='focus';render();refreshChips();log('workitem.create.completed',{id:it.id});
  }catch(e){say('Create failed: '+e.message)}
};
/* ---------------- AI actions ---------------- */
function aiOK(){return typeof aiReady==='function'&&aiReady()}
window.witDraftFromEntry=async function(){
  await loadConfig();if(!enabled()){openWorkItems('focus');return}
  if(!aiOK()){say('Connect an AI provider in Studio first \u2014 opening a blank form.');openWorkItems('create');return}
  var t=txt();if(!t.trim()){say('Write something first.');openWorkItems('create');return}
  openDrawer('create');say('Drafting from this entry\u2026');
  try{var obj=await aiDraft(t.slice(0,12000));renderCreate(d('witBody'),obj);say('Draft ready \u2014 review and Create.')}catch(e){say('AI draft failed: '+e.message);openWorkItems('create')}
};
window.witDraftFromSelection=async function(){
  var sel=(window.getSelection&&window.getSelection().toString())||'';
  if(!sel.trim()){say('Select some text in the entry first.');return}
  if(!aiOK()){say('Connect an AI provider first.');return}
  openDrawer('create');say('Drafting from selection\u2026');
  try{var obj=await aiDraft(sel);renderCreate(d('witBody'),obj);say('Draft ready.')}catch(e){say('AI draft failed: '+e.message)}
};
async function aiDraft(source){
  var ty=types().join(', ');
  var r=await aiChat([{role:'system',content:'From the text, draft ONE '+TR().system+' '+noun()+'. Return ONLY strict minified JSON: {"type":"<one of: '+ty+'>","title":"...","priority":2,"description":"...","acceptanceCriteria":["...","..."]}. Pick the most fitting type; title under 120 chars; base everything only on the text.'},{role:'user',content:source}],{max:700,temp:.3});
  var m=r.match(/\{[\s\S]*\}/);var o=m?JSON.parse(m[0]):{};
  var desc=o.description||'';if(o.acceptanceCriteria&&o.acceptanceCriteria.length)desc+='\n\nAcceptance criteria:\n'+o.acceptanceCriteria.map(function(x){return '- '+x}).join('\n');
  return {type:o.type,title:o.title,priority:o.priority,description:desc.trim()};
}
window.witAcceptance=async function(){
  if(!aiOK()){say('Connect an AI provider first.');return}
  var title=(d('witN_title')||{}).value||'',desc=(d('witN_desc')||{}).value||'';
  if(!title.trim()&&!desc.trim()){say('Add a title or description first.');return}
  say('Generating acceptance criteria\u2026');
  try{var r=await aiChat([{role:'system',content:'Write 3-6 concise, testable acceptance criteria as a plain Markdown bullet list. Return only the list.'},{role:'user',content:'Title: '+title+'\n'+desc}],{max:400,temp:.3});
    var ta=d('witN_desc');ta.value=(ta.value.trim()?ta.value.trim()+'\n\n':'')+'Acceptance criteria:\n'+r.trim();say('Acceptance criteria added.')}catch(e){say('AI error: '+e.message)}
};
window.witSummarize=async function(id){
  if(!aiOK()){say('Connect an AI provider first.');return}
  var it=DETAILS[id]||(DETAILS[id]=await api('/api/workitems/'+id+pq()).catch(function(){return null}));if(!it){say('Load failed.');return}
  say('Summarizing #'+id+'\u2026');
  try{var r=await aiChat([{role:'system',content:'Summarize this '+TR().system+' '+noun()+' into a concise Markdown journal note: a bold one-line status, then Context, then Next steps. Only supported facts.'},{role:'user',content:'#'+id+' '+F(it,'System.WorkItemType')+' ['+F(it,'System.State')+']\nTitle: '+F(it,'System.Title')+'\nDescription: '+stripHtml(F(it,'System.Description'))}],{max:600,temp:.3});
    if(typeof insertBlock==='function')insertBlock('\n> [!info] '+(GH()?'Issue':'Work item')+' #'+id+'\n'+r+'\n#'+(TR().refPrefix||'ado')+'/'+id+' ');if(typeof scheduleSave==='function')scheduleSave();refreshChips();ingest(it);say('Summary inserted below the entry.');
  }catch(e){say('AI error: '+e.message)}
};
/* ---------------- provider switch ---------------- */
function onProviderChange(){DETAILS={};ITEMS=[];TYPES_CACHE={};PROJECTS=null;
  var nb=d('witNav');if(nb)nb.textContent=GH()?'Issues':'Work Items';var rb=d('rWit');if(rb)rb.title=(TR().label||'Work items')+' · '+(TR().system||'')+' (Ctrl+Shift+W)';
  if(d('witDrawer').classList.contains('open')){renderDiag();render();if(enabled()){loadProjects(true);loadTypes()}}refreshChips();refreshAmbient()}
/* ---------------- GitHub Projects (v2) ---------------- */
async function loadCardProject(id){var sel=d('wf_proj_'+id);if(!sel)return;
  try{var j=await api('/api/projects/issue?number='+id);var opts=['<option value="">'+(j.inProject?'No status':'Not on the board')+'</option>'].concat((j.statuses||[]).map(function(s){return '<option'+(s===j.status?' selected':'')+'>'+esc(s)+'</option>'}));
    sel.innerHTML=opts.join('');sel.title=(j.project&&j.project.title)||''}catch(e){sel.innerHTML='<option>Unavailable</option>';sel.disabled=true;sel.title=e.message}}
window.witSetProjectStatus=async function(id,status){if(!status)return;try{await api('/api/projects/item',{method:'POST',body:JSON.stringify({issue:id,status:status})});say('#'+id+' → '+status+' on the project board.')}catch(e){say('Project update failed: '+e.message)}};
async function renderProjectBoard(b){b.innerHTML='<div class="wit-empty"><span class="wit-busy">Loading the project board…</span></div>';
  try{var p=await api('/api/projects');var cols=(p.statuses||[]).concat(['']);
    var linked=refIds();var missing=linked.filter(function(n){return !p.items.some(function(i){return i.kind==='issue'&&String(i.number)===String(n)})});
    var head='<div class="wit-toolbar"><b style="font:650 12px var(--font)">'+esc(p.title||'Project')+'</b><a class="wit-open" href="'+esc(p.url||'#')+'" target="_blank" rel="noopener">Open board ↗</a><span style="flex:1"></span>'+
      (missing.length?'<button onclick="witAddLinkedToProject()">Add '+missing.length+' linked issue'+(missing.length>1?'s':'')+'</button>':'')+'<button onclick="witProjectRefresh()">Refresh</button></div>';
    b.innerHTML=head+'<div class="wit-cols">'+cols.map(function(c){var its=p.items.filter(function(i){return (i.status||'')===c});
      if(!c&&!its.length)return '';
      return '<section class="wit-col"><h4><span>'+esc(c||'No status')+'</span><span>'+its.length+'</span></h4>'+its.map(function(i){
        return '<div class="it"><b>'+esc(i.title||'(untitled)')+'</b><div class="sub">'+(i.number?'<a href="'+esc(i.url)+'" target="_blank" rel="noopener">#'+i.number+'</a>':'')+'<span>'+esc(i.kind)+'</span>'+(i.state?'<span>'+esc(i.state)+'</span>':'')+'</div>'+
          '<select aria-label="Status" data-item="'+esc(i.itemId)+'" onchange="witMoveItem(this.dataset.item,this.value)">'+(p.statuses||[]).map(function(s){return '<option'+(s===i.status?' selected':'')+'>'+esc(s)+'</option>'}).join('')+(i.status?'':'<option selected value="">No status</option>')+'</select></div>'}).join('')+'</section>'}).join('')+'</div>';
    window._witProj=p}catch(e){b.innerHTML='<div class="wit-empty">Project board unavailable: '+esc(e.message)+'<br><br>Set <code>DAILY_GITHUB_PROJECT_NUMBER</code>. For a project on a personal account, put a classic token with the <code>project</code> scope in <code>DAILY_GITHUB_PROJECTS_TOKEN</code>.</div>'}}
window.witMoveItem=async function(itemId,status){if(!status)return;try{await api('/api/projects/item',{method:'POST',body:JSON.stringify({itemId:itemId,status:status})});say('Moved to '+status+'.');renderProjectBoard(d('witBody'))}catch(e){say('Move failed: '+e.message)}};
window.witProjectRefresh=function(){api('/api/projects?refresh=1').catch(function(){}).then(function(){renderProjectBoard(d('witBody'))})};
window.witAddLinkedToProject=async function(){var p=window._witProj;if(!p)return;var first=(p.statuses||[])[0]||'';var ids=refIds().filter(function(n){return !p.items.some(function(i){return i.kind==='issue'&&String(i.number)===String(n)})});
  for(var k=0;k<ids.length;k++){try{await api('/api/projects/item',{method:'POST',body:JSON.stringify({issue:+ids[k],status:first})})}catch(e){say('#'+ids[k]+': '+e.message)}}say('Added '+ids.length+' issue'+(ids.length>1?'s':'')+' to '+(p.title||'the board')+'.');renderProjectBoard(d('witBody'))};
/* ---------------- pipeline runs (GitHub Actions / Azure Pipelines) ---------------- */
function ago(s){if(!s)return '';var m=Math.round((Date.now()-new Date(s))/60000);if(m<1)return 'just now';if(m<60)return m+'m ago';var h=Math.round(m/60);if(h<48)return h+'h ago';return Math.round(h/24)+'d ago'}
async function renderRuns(b){b.innerHTML='<div class="wit-empty"><span class="wit-busy">Loading runs…</span></div>';
  try{var j=await api('/api/runs?provider='+PV());var runs=j.value||[];
    var head='<div class="wit-toolbar"><b style="font:650 12px var(--font)">'+esc(j.provider)+'</b><a class="wit-open" href="'+esc(j.url||'#')+'" target="_blank" rel="noopener">Open ↗</a><span style="flex:1"></span><button onclick="witRunsRefresh()">Refresh</button></div>';
    if(!runs.length){b.innerHTML=head+'<div class="wit-empty">No runs yet.</div>';return}
    b.innerHTML=head+'<div class="wit-runs">'+runs.map(function(r){var cls=r.status!=='completed'?'running':(r.result||'');
      var again=GH()?(/failure|cancelled/.test(r.result)?'Re-run failed jobs':'Re-run'):'Queue again';
      return '<div class="wit-run"><span class="st '+esc(cls)+'" title="'+esc(r.status+(r.result?' · '+r.result:''))+'"></span><b>'+esc(r.name)+(r.title?' — '+esc(r.title):'')+'</b>'+
        '<div class="acts">'+(r.status==='completed'?'<button data-id="'+(+r.id)+'" data-result="'+esc(r.result||'')+'" onclick="witRerun(+this.dataset.id,this.dataset.result)">'+again+'</button>':'')+(r.url?'<a href="'+esc(r.url)+'" target="_blank" rel="noopener" aria-label="Open run">↗</a>':'')+'</div>'+
        '<div class="sub">'+esc([r.status==='completed'?(r.result||'done'):String(r.status||'').replace('_',' '),r.branch,r.commit,r.actor,ago(r.started)].filter(Boolean).join(' · '))+'</div></div>'}).join('')+'</div>'}
  catch(e){b.innerHTML='<div class="wit-empty">Runs unavailable: '+esc(e.message)+'<br><br>'+(GH()?'Give the GitHub token <b>Actions: Read</b> (and <b>Read and write</b> to re-run).':'Give the PAT <b>Build: Read &amp; execute</b>.')+'</div>'}}
window.witRunsRefresh=function(){renderRuns(d('witBody'))};
window.witRerun=async function(id,result){try{var r=await api('/api/runs/rerun?provider='+PV(),{method:'POST',body:JSON.stringify({id:id,result:result})});say((GH()?'Re-running ':'Queued: ')+(r.mode||'')+'.');setTimeout(function(){if(TAB==='runs')renderRuns(d('witBody'))},1500)}catch(e){say('Re-run failed: '+e.message)}};
/* ---------------- linking + graph ---------------- */
function linkId(id){if(refIds().indexOf(String(id))>=0){say('Entry already references #'+id+'.');return}if(typeof insertBlock==='function')insertBlock('\n#'+(TR().refPrefix||'ado')+'/'+id+' ');if(typeof scheduleSave==='function')scheduleSave();refreshChips()}
window.witLink=function(id){linkId(id);if(DETAILS[id])ingest(DETAILS[id]);say('Linked #'+id+' to the entry.');if(TAB==='board')witQuery()};
function enterpriseOn(){return !!(CFG&&CFG.features&&CFG.features.enterprise)}
async function ingest(it){if(!enterpriseOn())return;try{var e=(typeof collect==='function')?collect():null;var wid='workitem:'+it.id;var nodes=[{id:wid,type:'workitem',label:'#'+it.id+' '+F(it,'System.Title'),workItemType:F(it,'System.WorkItemType'),state:F(it,'System.State'),visibility:'team'}];var edges=[];if(e){nodes.push({id:'entry:'+e.id,type:'entry',label:e.title||e.date,date:e.date,visibility:'private',ownerId:'local-user'});edges.push({source:'entry:'+e.id,target:wid,type:'tracks'})}await api('/api/enterprise/ingest',{method:'POST',body:JSON.stringify({nodes:nodes,edges:edges})})}catch(e){}}
/* ============================================================ IN-EDITOR SURFACES ============================================================ */
/* ribbon button */
function installRibbonButton(){
  var ribbon=d('ribbon');if(!ribbon||d('rWit'))return;
  var btn=document.createElement('button');btn.className='r-btn r-wit';btn.id='rWit';btn.type='button';
  btn.title=(TR().label||'Work items')+' \u00b7 '+(TR().system||'')+' (Ctrl+Shift+W)';btn.setAttribute('aria-label','Work Items');
  btn.innerHTML='\u25EB<span class="wit-count" id="witRibbonCount"></span>';
  btn.onclick=function(){openWorkItems('focus')};
  var console_=d('rConsole');if(console_&&console_.parentNode===ribbon)ribbon.insertBefore(btn,console_);else ribbon.appendChild(btn);
}
/* chips row + ambient strip (inserted just above the ribbon) */
function installStrips(){
  var ribbon=d('ribbon');if(!ribbon)return;
  if(!d('witChips')){var chips=document.createElement('div');chips.className='wit-chips';chips.id='witChips';ribbon.parentNode.insertBefore(chips,ribbon)}
  if(!d('witAmbient')){var amb=document.createElement('div');amb.className='wit-ambient';amb.id='witAmbient';ribbon.parentNode.insertBefore(amb,d('witChips'))}
  var entry=d('entry');if(entry&&!entry._witWired){entry._witWired=true;entry.addEventListener('input',function(){clearTimeout(window._witT);window._witT=setTimeout(onEntryChange,700)})}
  var src=d('source');if(src&&!src._witWired){src._witWired=true;src.addEventListener('input',function(){clearTimeout(window._witT);window._witT=setTimeout(onEntryChange,700)})}
  document.addEventListener('daily:focus-applied',onEntryChange);
}
function onEntryChange(){refreshChips();refreshAmbient();if(d('witDrawer').classList.contains('open')){renderDiag();if(TAB==='focus')render()}}
function refreshChips(){
  var row=d('witChips');if(!row)return;var ids=refIds();
  var count=d('witRibbonCount');if(count){count.textContent=ids.length||'';count.classList.toggle('show',ids.length>0)}
  if(!enabled()||!ids.length){row.classList.remove('show');row.innerHTML='';return}
  row.classList.add('show');
  row.innerHTML='<span class="lbl">'+esc(TR().label||'Work items')+'</span>'+ids.map(function(id){return '<span class="wit-chip" data-id="'+id+'" onclick="openWorkItems(\'focus\')"><span class="dot"></span><span class="id">#'+id+'</span><span class="t">\u2026</span></span>'}).join('');
  ids.forEach(async function(id){try{var it=DETAILS[id]||(DETAILS[id]=await api('/api/workitems/'+id+pq()));var el=row.querySelector('.wit-chip[data-id="'+id+'"]');if(!el)return;el.querySelector('.dot').className='dot '+stateClass(F(it,'System.State'));el.querySelector('.t').textContent=String(F(it,'System.Title')||'').slice(0,34);el.title=F(it,'System.WorkItemType')+' \u00b7 '+F(it,'System.State')}catch(e){var el2=row.querySelector('.wit-chip[data-id="'+id+'"]');if(el2){el2.querySelector('.dot').className='dot err';el2.querySelector('.t').textContent='#'+id}}});
}
function refreshAmbient(){
  var amb=d('witAmbient');if(!amb)return;
  if(!enabled()){amb.classList.remove('show');return}
  var det=detected();
  if(!det.total||det.signature===dismissedAmbient){amb.classList.remove('show');return}
  var parts=[];if(det.decision)parts.push(det.decision+' decision'+(det.decision>1?'s':''));if(det.blocker)parts.push(det.blocker+' blocker'+(det.blocker>1?'s':''));if(det.task)parts.push(det.task+' task'+(det.task>1?'s':''));
  amb.classList.add('show');
  amb.innerHTML='<span class="glyph">\u2726</span><span class="txt"><b>'+parts.join(' \u00b7 ')+'</b> in this entry could be tracked in '+esc(TR().system)+'.</span><button onclick="witDraftFromEntry()">Draft</button><button class="ghost" onclick="openWorkItems(\'focus\')">Review</button><button class="x" title="Dismiss" onclick="witDismissAmbient()">\u00d7</button>';
}
window.witDismissAmbient=function(){dismissedAmbient=detected().signature;d('witAmbient').classList.remove('show')};
/* nav button (secondary entry point) */
function installNav(){
  var nav=document.querySelector('.nav');if(!nav||d('witNav'))return;
  var b=document.createElement('button');b.id='witNav';b.textContent=GH()?'Issues':'Work Items';b.onclick=function(){openWorkItems('focus')};
  var ent=d('enterpriseNav');if(ent&&ent.parentNode===nav)nav.insertBefore(b,ent);else nav.insertBefore(b,nav.querySelector('button:last-child'));
}
/* ============================================================ BOOT (robust, multi-anchor, retrying) ============================================================ */
function wireDrawer(){
  d('witCloseBtn').onclick=closeDrawer;
  d('witRefresh').onclick=function(){DETAILS={};TYPES_CACHE={};loadConfig(true).then(function(){return loadProjects(true)}).then(function(){return loadTypes()}).then(function(){renderDiag();render();refreshChips()})};
  document.addEventListener('daily:provider',onProviderChange);document.addEventListener('daily:relay',onProviderChange);
  document.addEventListener('keydown',function(e){if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='w'){e.preventDefault();d('witDrawer').classList.contains('open')?closeDrawer():openWorkItems('focus')}if(e.key==='Escape'&&d('witDrawer').classList.contains('open'))closeDrawer()});
}
async function init(){
  if(booting)return;booting=true;
  wireDrawer();installRibbonButton();installStrips();installNav();
  await loadConfig();
  refreshChips();refreshAmbient();
  log('workitems.module.ready',{relay:relayUp(),enabled:enabled()});
}
/* retry until the editor + ribbon exist, regardless of module load order */
var tries=0,iv=setInterval(function(){
  if(d('ribbon')&&d('entry')&&document.querySelector('.nav')){clearInterval(iv);init();}
  else if(++tries>160){clearInterval(iv);/* last-ditch: still wire the drawer so the nav works */ try{if(document.querySelector('.nav'))installNav();wireDrawer();loadConfig();}catch(e){}}
},50);
/* ---- Public API so the Workspace Shell can embed WIT surfaces in docks ---- */
window.DailyWIT={
  ready:function(){return !!CFG},
  enabled:function(){return enabled()},
  ensure:async function(){if(!CFG)await loadConfig();if(enabled()){loadProjects();loadTypes()}return {relay:relayUp(),enabled:enabled()}},
  mountFocus:async function(el){if(!el)return;await this.ensure();TAB='focus';await renderFocus(el);},
  mountBoard:async function(el){if(!el)return;await this.ensure();renderBoard(el);},
  refresh:function(){DETAILS={};TYPES_CACHE={};loadConfig(true).then(function(){return loadProjects(true)}).then(function(){return loadTypes()})},
  projects:function(){return PROJECTS||[]},
  loadProjects:function(f){return loadProjects(f)},
  curProject:function(){return curProject()},
  setProject:function(p){setProject(p);DETAILS={};ITEMS=[];},
  onProviderChange:function(){try{onProviderChange()}catch(e){}},
  defaultProject:function(){return defaultProject()},
  multiProject:function(){return multiProject()},
  linkedIds:function(){return refIds()},
  onEntryChange:function(){try{onEntryChange()}catch(e){}}
};
})();
