'use strict';
/* ============================================================ CORE ============================================================ */
const $=id=>document.getElementById(id);
const todayISO=()=>new Date().toISOString().slice(0,10);
const esc=s=>(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LS={entry:d=>'daily:entry:'+d,sha:d=>'daily:sha:'+d,set:'daily:settings',gh:'daily:gh',az:'daily:az',ai:'daily:ai',pi:'daily:promptIdx',prompt:d=>'daily:prompt:'+d};
/* quota-guarded storage */
let _quotaWarned=false;
const store={get:k=>{try{return localStorage.getItem(k)}catch{return null}},
  set:(k,v)=>{try{localStorage.setItem(k,v);return true;}catch(e){if(e&&(e.name==='QuotaExceededError'||e.code===22||e.code===1014)){if(!_quotaWarned){_quotaWarned=true;toast('⚠ Browser storage is full — export a backup (Studio) or remove large images. Recent change not saved locally.');setTimeout(()=>_quotaWarned=false,4000);}}return false;}},
  rm:k=>{try{localStorage.removeItem(k)}catch{}},keys:()=>{try{return Object.keys(localStorage)}catch{return[]}}};
let curDate=todayISO(), mode='write', saveTimer=null;
function toast(m){const t=$('toast');t.innerHTML=m;t.classList.add('show');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('show'),3000);}
const DEFAULTS={name:'',theme:'auto',width:900,assets:true,stream:true,obsidian:true};
function getS(){try{return Object.assign({},DEFAULTS,JSON.parse(store.get(LS.set))||{})}catch{return{...DEFAULTS}}}
function saveS(s){store.set(LS.set,JSON.stringify(s))}
function applyS(){const s=getS();const root=document.documentElement;root.style.setProperty('--measure',s.width+'px');const theme=(s.theme==='light'||s.theme==='dark'||s.theme==='auto')?s.theme:'auto';root.setAttribute('data-theme',theme);root.style.colorScheme=theme==='auto'?'light dark':theme;if(document.body)document.body.style.background='var(--bg)';if($('nameField'))$('nameField').value=s.name||'';if($('assetsToggle'))$('assetsToggle').checked=s.assets!==false;if($('streamToggle'))$('streamToggle').checked=s.stream!==false;if($('obsidianToggle'))$('obsidianToggle').checked=s.obsidian!==false;document.querySelectorAll('#themeSeg button').forEach(b=>b.classList.toggle('on',b.dataset.th===theme));document.querySelectorAll('#widthSeg button').forEach(b=>b.classList.toggle('on',+b.dataset.w===s.width));}
function setTheme(t){const s=getS();s.theme=t;saveS(s);applyS();}
function setWidth(w){const s=getS();s.width=w;saveS(s);applyS();}
function assetsPref(){return getS().assets!==false;}
function saveAssetsPref(on){const s=getS();s.assets=!!on;saveS(s);}
function streamPref(){return getS().stream!==false;}
function saveStreamPref(on){const s=getS();s.stream=!!on;saveS(s);}
function obsidianTagPref(){return getS().obsidian!==false;}
function saveObsidianPref(on){const s=getS();s.obsidian=!!on;saveS(s);}
/* ============================================================ DAILY PROMPTS (guided, stored, resonant)
   Each prompt carries a guided reflection template + an Obsidian #type/* tag.
   Clicking the prompt expands it into structured follow-up questions AND records
   the prompt in the entry schema (frontmatter `prompt:`).
   ============================================================ */
const PROMPTS=[
  {id:'focus',q:"What are you working on?",ic:'🎯',tag:'type/focus',body:['**What** ','**Why now** ','**Definition of done** ','**Next smallest step** ']},
  {id:'ship',q:"What did you ship or move forward?",ic:'★',tag:'type/win',body:['**What moved** ','**Impact** ','**Who benefits** ','**Repeatable?** ']},
  {id:'block',q:"What blocked you today?",ic:'⛌',tag:'type/blocker',body:['**Blocked on** ','**Impact if unresolved** ','**Who/what unblocks it** ','**Workaround / escalate by** ']},
  {id:'decide',q:"What decision did you make, and why?",ic:'◆',tag:'type/decision',body:['**Decision** ','**Context** ','**Options considered** ','**Rationale** ','**Revisit when** ']},
  {id:'learn',q:"What did you learn?",ic:'▣',tag:'type/learning',body:['**Insight** ','**Evidence** ','**So what / apply to** ','**Open question** ']},
  {id:'next',q:"What are you trying next?",ic:'⚗',tag:'type/experiment',body:['**Hypothesis** ','**First test** ','**Signal I\'ll watch** ','**If it works / if it doesn\'t** ']},
  {id:'remember',q:"What's worth remembering about today?",ic:'🧠',tag:'type/learning',body:['**The moment** ','**Why it mattered** ','**What it connects to** ','**Future-me should** ']},
  {id:'future',q:"What would future-you want to know?",ic:'◷',tag:'type/note',body:['**Situation** ','**What I\'d tell myself** ','**Watch out for** ','**Remember why** ']},
  {id:'step',q:"What's the next smallest step?",ic:'⤳',tag:'type/task',body:['- [ ] ','**Why this first** ','**Blocked by** ','**Done looks like** ']},
  {id:'people',q:"Who did you help, or who helped you?",ic:'🤝',tag:'type/people',body:['**Who** ','**What happened** ','**How to reciprocate / follow up** ']}
];
const PROMPT_BY_ID=Object.fromEntries(PROMPTS.map(p=>[p.id,p]));
let curPromptId=PROMPTS[0].id;
function promptOf(id){return PROMPT_BY_ID[id]||PROMPTS[0];}
function defaultPromptIdFor(d){const n=new Date((d||curDate)+'T12:00').getDate();return PROMPTS[n%PROMPTS.length].id;}
/* the prompt bound to a given date — stored on first view, upgraded when the user reflects */
function promptIdForDate(d){const saved=store.get(LS.prompt(d));if(saved&&PROMPT_BY_ID[saved])return saved;const id=defaultPromptIdFor(d);store.set(LS.prompt(d),id);return id;}
function setPromptForDate(d,id){store.set(LS.prompt(d),id);}
function showPrompt(){const p=promptOf(curPromptId);const el=$('promptText');if(!el)return;const cue=el.querySelector('.cue');el.textContent=p.q;if(cue)el.appendChild(cue);else{const c=document.createElement('span');c.className='cue';c.textContent='＋ reflect';el.appendChild(c);}}
function syncPromptForCurrentDay(){curPromptId=promptIdForDate(curDate);showPrompt();}
function nextPrompt(){const i=PROMPTS.findIndex(p=>p.id===curPromptId);curPromptId=PROMPTS[(i+1)%PROMPTS.length].id;setPromptForDate(curDate,curPromptId);store.set(LS.pi,String((i+1)%PROMPTS.length));showPrompt();}
/* expand the current prompt into a guided reflection scaffold, and remember it */
function expandPrompt(){const p=promptOf(curPromptId);setPromptForDate(curDate,p.id);
  const tags=(obsidianTagPref()&&p.tag)?('\n#'+p.tag):'';
  const block=['### '+p.ic+' '+p.q,'',...p.body,tags].join('\n');
  insertBlock('\n'+block);scheduleSave();renderRibbon();
  toast('Guided reflection added'+(tags?' · #'+p.tag:'')+' — the prompt is saved with today.');}
function reflectPrompt(){expandPrompt();}
/* canonical buffer */
let mdBuffer='';
function entryText(){if(mode==='write')mdBuffer=htmlToMD($('entry'));else if(mode==='source')mdBuffer=$('source').value;return mdBuffer;}
function setEntryText(t){mdBuffer=t||'';refreshPane();resetHistory();}
function refreshPane(){if(mode==='source'){$('source').value=mdBuffer;}else if(mode==='preview'){$('preview').innerHTML=renderMD(mdBuffer);}else{$('entry').innerHTML=mdBuffer.trim()?renderMD(mdBuffer):'';}}
function htmlToMD(root){const NL='\n';
  function inline(node){let out='';(node.childNodes||[]).forEach(n=>{if(n.nodeType===3){out+=n.textContent;return;}if(n.nodeType!==1)return;const t=n.tagName.toUpperCase();
    if(t==='BR')out+=NL;else if(t==='STRONG'||t==='B'){const s=inline(n).trim();if(s)out+='**'+s+'**';}else if(t==='EM'||t==='I'){const s=inline(n).trim();if(s)out+='*'+s+'*';}else if(t==='U'){const s=inline(n).trim();if(s)out+='<u>'+s+'</u>';}else if(t==='DEL'||t==='S'||t==='STRIKE'){const s=inline(n).trim();if(s)out+='~~'+s+'~~';}else if(t==='MARK'){const s=inline(n).trim();if(s)out+='=='+s+'==';}else if(t==='CODE')out+='`'+n.textContent+'`';else if(t==='A'){out+='['+inline(n)+']('+(n.getAttribute('href')||'')+')';}else if(t==='IMG')out+='!['+(n.getAttribute('alt')||'')+']('+(n.getAttribute('src')||'')+')';else out+=inline(n);});return out;}
  function block(node,indent){indent=indent||'';const blocks=[];
    (node.childNodes||[]).forEach(n=>{if(n.nodeType===3){const tx=n.textContent.replace(/\u00a0/g,' ').trim();if(tx)blocks.push(indent+tx);return;}if(n.nodeType!==1)return;const t=n.tagName.toUpperCase();
      if(/^H[1-6]$/.test(t))blocks.push(indent+'#'.repeat(+t[1])+' '+inline(n).trim());
      else if(t==='P'){const s=inline(n).replace(/\u00a0/g,' ').trim();blocks.push(indent+s);}
      else if(t==='HR')blocks.push(indent+'---');
      else if(t==='BLOCKQUOTE'){const inner=block(n,'');blocks.push(inner.split(NL).map(l=>indent+'> '+l).join(NL));}
      else if(t==='PRE'){const ce=[...n.childNodes].find(c=>c.nodeType===1&&c.tagName.toUpperCase()==='CODE');const code=(ce?ce.textContent:n.textContent).replace(/\n$/,'');blocks.push(indent+'```'+NL+code+NL+indent+'```');}
      else if(t==='UL'||t==='OL'){blocks.push(listMD(n,indent,t==='OL'));}
      else if(t==='TABLE'){const rows=[];[...n.childNodes].forEach(sec=>{const trs=(sec.nodeType===1&&/^(THEAD|TBODY)$/.test(sec.tagName.toUpperCase()))?[...sec.childNodes]:[sec];trs.forEach(tr=>{if(tr.nodeType===1&&tr.tagName.toUpperCase()==='TR'){const cells=[...tr.childNodes].filter(c=>c.nodeType===1&&/^(TD|TH)$/.test(c.tagName.toUpperCase())).map(c=>inline(c).trim());if(cells.length)rows.push(cells);}});});if(rows.length){let md='| '+rows[0].join(' | ')+' |'+NL+'| '+rows[0].map(()=>'---').join(' | ')+' |';for(let r=1;r<rows.length;r++)md+=NL+'| '+rows[r].join(' | ')+' |';blocks.push(md);}}
      else if(t==='IMG')blocks.push(indent+'!['+(n.getAttribute('alt')||'')+']('+(n.getAttribute('src')||'')+')');
      else if(t==='DIV'){const inner=block(n,indent);if(inner.trim())blocks.push(inner);else if((n.textContent||'').trim())blocks.push(indent+n.textContent.trim());}
      else{const inl=inline(n).trim();if(inl)blocks.push(indent+inl);}});
    return blocks.filter(b=>b!=='').join(NL+NL);}
  /* nested-list serializer: preserves depth via 2-space indent, tasks via [ ]/[x] */
  function listMD(listNode,indent,ordered){const task=listNode.classList&&listNode.classList.contains('task');const lines=[];let i=1;
    [...listNode.childNodes].forEach(li=>{if(li.nodeType!==1||li.tagName.toUpperCase()!=='LI')return;
      let marker=ordered?(i++)+'. ':'- ';let checkbox='';let text='';const nested=[];
      li.childNodes.forEach(c=>{if(c.nodeType===1&&/^(UL|OL)$/.test(c.tagName.toUpperCase()))nested.push(listMD(c,indent+'  ',c.tagName.toUpperCase()==='OL'));
        else if(c.nodeType===1&&c.tagName.toUpperCase()==='INPUT'){checkbox='['+(c.checked?'x':' ')+'] ';}
        else if(c.nodeType===3)text+=c.textContent;else text+=inline({childNodes:[c]});});
      if(task&&!checkbox)checkbox='[ ] ';
      lines.push(indent+marker+checkbox+text.trim());
      nested.forEach(nl=>lines.push(nl));});
    return lines.join(NL);}
  return block(root,'').replace(/\n{3,}/g,'\n\n').trim();}
function collect(){const prev=loadEntry(curDate);const pid=store.get(LS.prompt(curDate))||curPromptId;const pr=PROMPT_BY_ID[pid];return{date:curDate,created:(prev&&prev.created)||new Date().toISOString(),savedAt:new Date().toISOString(),text:entryText(),project:currentProject(),promptId:pid,prompt:pr?pr.q:''};}
function loadEntry(d){try{return JSON.parse(store.get(LS.entry(d)))}catch{return null}}
function allEntries(){const a=[];store.keys().forEach(k=>{if(k.startsWith('daily:entry:')){try{const j=JSON.parse(store.get(k));if(j&&j.text&&j.text.trim())a.push(j)}catch{}}});return a.sort((x,y)=>(x.date||'').localeCompare(y.date||''));}
function scheduleSave(){clearTimeout(saveTimer);setStatus('editing');saveTimer=setTimeout(flush,600);}
function flush(){store.set(LS.entry(curDate),JSON.stringify(collect()));setStatus('saved');renderRibbon();}
function setStatus(s){const d=$('rDot'),t=$('rState');if(!d)return;d.className='r-dot'+(s==='saved'?'':' '+s);t.textContent=s;}
function shift(iso,n){const d=new Date(iso+'T12:00');d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);}
function label(iso){const t=todayISO();if(iso===t)return'Today';if(iso===shift(t,-1))return'Yesterday';if(iso===shift(t,1))return'Tomorrow';return new Date(iso+'T12:00').toLocaleDateString(undefined,{month:'short',day:'numeric'});}
function openDay(iso){flush();curDate=iso;const e=loadEntry(iso);setEntryText(e?e.text:'');updateDateUI();syncPromptForCurrentDay();if(mode!=='write')setMode('write');renderRibbon();setStatus('saved');
  if((!e||!(e.text||'').trim())&&(ghReady()||azReady())){setStatus('pushing');pullOne(iso).then(got=>{setStatus('saved');if(got&&curDate===iso){const fresh=loadEntry(iso);if(fresh&&document.activeElement!==$('entry')){setEntryText(fresh.text);if(mode==='preview')setMode('preview');renderRibbon();}}}).catch(()=>setStatus('saved'));}}
function updateDateUI(){$('dCur').textContent=label(curDate);$('dCur').classList.toggle('today-on',curDate===todayISO());$('dateInput').value=curDate;}
function setMode(m){if(mode==='write')mdBuffer=htmlToMD($('entry'));else if(mode==='source')mdBuffer=$('source').value;mode=m;const w=$('writer');w.classList.remove('mode-write','mode-source','mode-preview','rich');w.classList.add('mode-'+m);if(m==='write')w.classList.add('rich');document.querySelectorAll('#viewSeg button').forEach(b=>b.classList.toggle('on',b.dataset.mode===m));refreshPane();}
/* telemetry */
const short=n=>n<1000?String(n):n<1e6?(n/1000).toFixed(n<1e4?1:0).replace('.0','')+'k':(n/1e6).toFixed(1)+'m';
const bytesL=n=>n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB';
function metrics(){const t=entryText();const words=(t.match(/\S+/g)||[]).length,chars=[...t].length,lines=t?t.split(/\n/).length:0,code=Math.floor((t.match(/```/g)||[]).length/2),size=new TextEncoder().encode(t).length;return{words,chars,lines,code,size,read:Math.max(0,Math.ceil(words/200)),arts:candidates(t).length};}
/* ============================================================ OBSIDIAN-ALIGNED TAG SCHEMA
   Nested tags: type/*, status/*, area/*, project/*  (Obsidian graph + Properties compatible)
   - collectTags()  → the canonical tag list written to YAML frontmatter
   - autoTagInline() → stamps #type/* on detected body elements (idempotent)
   ============================================================ */
const RESERVED_NS=/^(type|status|area|prio|priority|on|with|journal|daily)(\/|$)/i;
const TAG_SRC='#([a-z0-9][a-z0-9_-]*(?:\\/[a-z0-9][a-z0-9_-]*)*)';
function explicitTags(t){const out=[];const re=new RegExp('(?:^|[\\s(])'+TAG_SRC,'gi');let m;while((m=re.exec(t||'')))out.push(m[1].toLowerCase());return out;}
function isReservedTag(tag){return RESERVED_NS.test(tag);}
function projectSlugs(t){const seen=[];explicitTags(t).forEach(tag=>{if(isReservedTag(tag))return;const slug=tag.replace(/^project\//,'');if(slug&&!seen.includes(slug))seen.push(slug);});return seen;}
/* canonical tag list for frontmatter: journal → project/* → type/* (from elements) → author's reserved-ns tags */
function collectTags(t){const tags=['journal'];
  projectSlugs(t).forEach(p=>{const v='project/'+p;if(!tags.includes(v))tags.push(v);});
  [...new Set(candidates(t).map(c=>c.tag).filter(Boolean))].forEach(v=>{if(!tags.includes(v))tags.push(v);});
  explicitTags(t).forEach(tag=>{if(isReservedTag(tag)&&!tags.includes(tag))tags.push(tag);});
  return tags;}
/* stamp #type/* on element lines; skips code fences, headings, tables, quotes; idempotent */
function autoTagInline(md,force){if(!force&&!obsidianTagPref())return md||'';const lines=String(md||'').split('\n');let fence=false;
  return lines.map(line=>{const tl=line.trim();
    if(/^```/.test(tl)){fence=!fence;return line;}
    if(fence||tl.length<12)return line;
    if(/^(#{1,6}\s|>|\||-{3,}$|\*\*\*$|!\[)/.test(tl))return line;
    for(const[re,lab,tag]of CAND){if(re.test(tl)){if(line.includes('#'+tag))break;return line.replace(/\s*$/,'')+' #'+tag;}}
    return line;}).join('\n');}
function applyAutoTags(){const before=entryText();const after=autoTagInline(before,true);if(after===before){toast('No new element tags to add.');return;}setEntryText(after);scheduleSave();renderRibbon();toast('Auto-tagged decisions · learnings · blockers…');}
function currentProject(){const raw=explicitTags(entryText()).filter(x=>!isReservedTag(x)).map(x=>x.replace(/^project\//,''));if(!raw.length)return'';const f={};raw.forEach(x=>f[x]=(f[x]||0)+1);return Object.entries(f).sort((a,b)=>b[1]-a[1])[0][0];}
function storageBytes(){let n=0;store.keys().forEach(k=>{if(k.indexOf('daily:')===0){n+=k.length+((store.get(k)||'').length);}});return n*2;}
function renderQuota(){const b=storageBytes();const cap=5*1024*1024;const pct=Math.min(100,Math.round(b/cap*100));const q=$('rQuota');if(q){q.textContent='· '+bytesL(b)+' ('+pct+'%)';q.className='r-quota'+(pct>90?' err':pct>75?' warn':'');}if($('quotaLine'))$('quotaLine').textContent='Using ~'+bytesL(b)+' of ~5 MB browser storage ('+pct+'%). Images are the biggest consumers — enable “Store images as files” or export a backup.';if($('backupStat'))$('backupStat').textContent=(n=>'· '+n+(n===1?' entry':' entries')+' stored')(allEntries().length)+'';}
function renderRibbon(){const m=metrics();$('rMetrics').textContent=`${short(m.words)}w · ${short(m.chars)}c · ${m.read}m · ${m.lines}L · ${m.code}CB · ${m.arts}A · ${bytesL(m.size)}`;$('rStatus').title=`Words: ${m.words}\nCharacters: ${m.chars}\nReading time: ${m.read} min\nLines: ${m.lines}\nCode blocks: ${m.code}\nArtifacts: ${m.arts}\nSize: ${bytesL(m.size)}`;const p=currentProject();const c=$('rCtx');if(p){c.textContent='#'+p;c.classList.remove('empty')}else{c.textContent='no project';c.classList.add('empty')}const gh=ghReady(),az=azReady();$('rRepo').classList.toggle('ready',gh||az);$('rRepo').title=`Repositories — GitHub ${gh?'✓':'○'} · Azure ${az?'✓':'○'}`;renderQuota();}
const CAND=[[/\b(?:we chose|i chose|decided to|the decision was|going with|opted for)\b/i,'◆ decision','type/decision'],[/\b(?:i learned|turns out|the fix was|solved it|root cause|realized that|lesson[: ])/i,'▣ learning','type/learning'],[/\b(?:hypothesis|experiment|i tried|testing whether|let'?s see if|A\/B)\b/i,'⚗ experiment','type/experiment'],[/\b(?:blocked by|couldn'?t because|not enabled|not approved|no owner|gated|waiting on)\b/i,'⛌ blocker','type/blocker'],[/\b(?:idea|what if|could we|might be worth|opportunity to)\b/i,'💡 idea','type/idea'],[/\b(?:shipped|launched|delivered|completed|done|finished|win\b)/i,'★ win','type/win']];
function candidates(t){const out=[];(t||'').split(/\n+/).forEach(line=>{const l=line.trim();if(l.length<12)return;for(const[re,lab,tag]of CAND){if(re.test(l)){out.push({label:lab,text:l,tag:tag});break;}}});return out;}
/* markdown renderer with NESTED lists */
/* Only allow safe URL schemes in rendered markdown (blocks javascript:, vbscript:, data:text/html, etc.). */
function mdSafeUrl(u,img){const t=String(u).replace(/[\x00-\x20]/g,'');const m=/^([a-z][a-z0-9+.\-]*):/i.exec(t);if(!m)return u;const sc=m[1].toLowerCase();if(sc==='http'||sc==='https'||sc==='mailto')return u;if(img&&((sc==='data'&&/^data:image\//i.test(t))||sc==='blob'))return u;return '#';}
function mdInline(s){s=s.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g,(_,a,u)=>'<img alt="'+a+'" src="'+mdSafeUrl(u,true)+'" style="max-width:100%">');s=s.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g,(_,t,u)=>'<a href="'+mdSafeUrl(u,false)+'" target="_blank" rel="noopener noreferrer">'+t+'</a>');s=s.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');s=s.replace(/~~([^~]+)~~/g,'<del>$1</del>');s=s.replace(/==([^=]+)==/g,'<mark>$1</mark>');s=s.replace(/`([^`]+)`/g,'<code>$1</code>');s=s.replace(/(^|[\s(])\*([^*\n]+)\*/g,'$1<em>$2</em>');return s;}
const LISTRE=/^(\s*)([-*]|\d+\.)\s+(.*)$/;
function renderList(buf,inl){let html='';const stack=[];const li=it=>{if(it.task){const done=/^\[[xX]\]/.test(it.text);return '<input type="checkbox" '+(done?'checked':'')+' onclick="toggleTask(event)">'+inl(it.text.replace(/^\[[ xX]\]\s?/,''));}return inl(it.text);};
  for(const it of buf){const type=it.ord?'ol':'ul';
    while(stack.length&&it.indent<stack[stack.length-1].indent){html+='</li></'+stack.pop().type+'>';}
    if(stack.length&&it.indent===stack[stack.length-1].indent){if(stack[stack.length-1].type!==type){html+='</li></'+stack.pop().type+'>';const cls=it.task?' class="task"':'';html+='<'+type+cls+'>';stack.push({type,indent:it.indent});html+='<li>'+li(it);}else{html+='</li><li>'+li(it);}}
    else{const cls=it.task?' class="task"':'';html+='<'+type+cls+'>';stack.push({type,indent:it.indent});html+='<li>'+li(it);}}
  while(stack.length){html+='</li></'+stack.pop().type+'>';}return html;}
function renderMD(md){const lines=String(md||'').replace(/\r\n?/g,'\n').split('\n');const inl=t=>mdInline(esc(t));let h='',i=0;const isBlk=l=>/^(#{1,6}\s|\s*>|\s*[-*]\s|\s*\d+\.\s|```|\|)/.test(l);
  while(i<lines.length){const l=lines[i];
    if(/^```/.test(l)){const c=[];i++;while(i<lines.length&&!/^```/.test(lines[i])){c.push(lines[i]);i++}i++;h+='<pre><code>'+esc(c.join('\n'))+'</code></pre>';continue;}
    if(/^\s*$/.test(l)){i++;continue;}
    if(/^\s*(---|\*\*\*)\s*$/.test(l)){h+='<hr>';i++;continue;}
    const hd=/^(#{1,6})\s+(.*)$/.exec(l);if(hd){h+=`<h${hd[1].length}>${inl(hd[2])}</h${hd[1].length}>`;i++;continue;}
    if(/^\s*\|/.test(l)){const rows=[];while(i<lines.length&&/^\s*\|/.test(lines[i])){rows.push(lines[i]);i++}const cells=r=>r.split('|').slice(1,-1).map(x=>x.trim());let tb='<table>';rows.forEach((r,ri)=>{if(/^\s*\|[\s:|-]+\|?\s*$/.test(r))return;const tag=ri===0?'th':'td';tb+='<tr>'+cells(r).map(c=>`<${tag}>${inl(c)}</${tag}>`).join('')+'</tr>'});tb+='</table>';h+=tb;continue;}
    if(/^\s*>/.test(l)){const q=[];while(i<lines.length&&/^\s*>/.test(lines[i])){q.push(lines[i].replace(/^\s*>\s?/,''));i++}h+='<blockquote>'+inl(q.join(' '))+'</blockquote>';continue;}
    if(LISTRE.test(l)){const buf=[];while(i<lines.length&&LISTRE.test(lines[i])){const m=LISTRE.exec(lines[i]);const indent=m[1].replace(/\t/g,'  ').length;const ord=/\d+\./.test(m[2]);const text=m[3];const task=/^\[[ xX]\]/.test(text);buf.push({indent,ord,task,text});i++;}h+=renderList(buf,inl);continue;}
    const p=[];while(i<lines.length&&!/^\s*$/.test(lines[i])&&!isBlk(lines[i])){p.push(lines[i]);i++}h+='<p>'+inl(p.join(' '))+'</p>';}
  return h;}
function toggleTask(e){e.stopPropagation();scheduleSave();}
/* ---- Obsidian YAML frontmatter (Properties) ---- */
function yamlStr(s){return '"'+String(s).replace(/"/g,'\\"')+'"';}
function yamlList(arr){return arr.map(x=>'  - '+(/[:#"']|^\s|\s$/.test(x)?yamlStr(x):x)).join('\n');}
function buildFrontmatter(e){const tags=collectTags(e.text);const projects=projectSlugs(e.text);const arts=candidates(e.text);const words=(e.text.match(/\S+/g)||[]).length;const now=new Date().toISOString();const created=e.created||now;
  const lines=['---',
    'title: '+yamlStr(e.date+(projects.length?(' · '+projects[0]):'')),
    'date: '+e.date,
    'created: '+created,
    'modified: '+now,
    'type: journal'];
  if(e.prompt)lines.push('prompt: '+yamlStr(e.prompt));
  lines.push('tags:',yamlList(tags));
  if(projects.length){lines.push('projects:',projects.map(p=>'  - "[['+p+']]"').join('\n'));}
  const arch=[...new Set(arts.map(a=>a.label.split(' ').slice(1).join(' ')))];
  if(arch.length){lines.push('artifact_types:',yamlList(arch));}
  lines.push('aliases:',yamlList(['The Daily '+e.date]),
    'artifacts: '+arts.length,
    'words: '+words,
    'cssclasses:',yamlList(['the-daily']),
    '---');
  return lines.join('\n');}
function buildMD(){const e=collect();e.text=autoTagInline(e.text);const cs=candidates(e.text);
  const capLine=cs.length?`> [!abstract] Artifacts\n> ${cs.map(c=>c.label).filter((v,i,a)=>a.indexOf(v)===i).join(' · ')}\n\n`:'';
  const projects=projectSlugs(e.text);
  const footProjects=projects.length?`\n\n**Projects:** ${projects.map(p=>'[['+p+']]').join(' ')}`:'';
  return `${buildFrontmatter(e)}\n\n# ${e.date}\n\n${capLine}${e.text||'_(no entry)_'}${footProjects}\n\n---\n_The Daily · ${new Date().toLocaleString()}_\n`;}
function download(name,content,type){const b=new Blob([content],{type:type||'text/plain'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),4000);}
function exportMD(){download(`the-daily-${curDate}.md`,buildMD(),'text/markdown');toast('Markdown exported.');}
function exportJSON(){download(`the-daily-${curDate}.json`,JSON.stringify(collect(),null,2),'application/json');toast('JSON exported.');}
function exportHTML(){const doc=`<!doctype html><meta charset=utf-8><title>The Daily ${curDate}</title><body style="font-family:system-ui;max-width:720px;margin:40px auto;padding:0 20px">${renderMD(buildMD())}`;download(`the-daily-${curDate}.html`,doc,'text/html');toast('HTML exported.');}
/* whole-journal backup / restore */
function exportAll(){flush();const data={type:'the-daily-backup',version:1,exportedAt:new Date().toISOString(),settings:(()=>{try{return JSON.parse(store.get(LS.set)||'{}')}catch{return{}}})(),entries:{}};store.keys().forEach(k=>{if(k.indexOf('daily:entry:')===0){try{data.entries[k.replace('daily:entry:','')]=JSON.parse(store.get(k));}catch{}}});const n=Object.keys(data.entries).length;download('the-daily-backup-'+todayISO()+'.json',JSON.stringify(data,null,2),'application/json');toast('Exported '+n+' entries as a backup.');}
function importAll(){$('importInput').click();}
function handleImport(file){const rd=new FileReader();rd.onload=ev=>{let data;try{data=JSON.parse(ev.target.result);}catch{toast('Not a valid JSON backup.');return;}if(!data||data.type!=='the-daily-backup'||!data.entries){toast('This file is not a The Daily backup.');return;}const dates=Object.keys(data.entries);let conflicts=0;dates.forEach(d=>{if(loadEntry(d))conflicts++;});const msg='Import '+dates.length+' entries?'+(conflicts?('\n\n'+conflicts+' date(s) already exist locally. Overwrite them?'):'');if(!confirm(msg))return;let ok=0,fail=0;dates.forEach(d=>{const e=data.entries[d];if(store.set(LS.entry(d),JSON.stringify(e)))ok++;else fail++;});if(data.settings&&confirm('Also restore appearance/AI settings from the backup?'))store.set(LS.set,JSON.stringify(data.settings));toast('Imported '+ok+' entries'+(fail?(' · '+fail+' failed (storage full)'):'')+'.');const cur=loadEntry(curDate);if(cur)setEntryText(cur.text);applyS();renderRibbon();};rd.readAsText(file);}
/* clipboard */
async function clip(text,label){try{await navigator.clipboard.writeText(text);toast((label||'Copied')+' to clipboard.');}catch{const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();toast((label||'Copied')+' to clipboard.');}}
function copyMarkdown(){clip(buildMD(),'Markdown');}
function copyRendered(){const tmp=document.createElement('div');tmp.innerHTML=renderMD(buildMD());clip(tmp.innerText,'Rendered text');}
function copySelection(){const s=window.getSelection().toString();if(!s){toast('Select some text first.');return;}clip(s,'Selection');}
async function copyExecSummary(){const t=entryText();if(!t.trim()){toast('Write something first.');return;}if(aiReady()){toast('Summarizing…');try{const r=await aiChat([{role:'system',content:'Turn the journal entry into a concise executive summary in Markdown: Theme, Key Insights, Decisions, Actions. Only supported facts.'},{role:'user',content:t}],{max:600,temp:.3});clip(r,'Executive summary');return;}catch(e){toast('AI error — copied a template.');}}clip(`## Executive Summary — ${curDate}\n\n**Theme:** ${t.split(/\n/).find(l=>l.trim())||'—'}\n\n**Highlights:**\n- \n`,'Executive summary');}
async function copyStatus(){const t=entryText();if(!t.trim()){toast('Write something first.');return;}if(aiReady()){toast('Drafting status…');try{const r=await aiChat([{role:'system',content:'Turn the journal entry into a short status update: Status, Accomplishments, Risks/Blockers, Next Steps. Crisp. Only supported facts.'},{role:'user',content:t}],{max:500,temp:.3});clip(r,'Status update');return;}catch(e){toast('AI error — copied a template.');}}clip(`**Status — ${curDate}**\n\n**Accomplishments:**\n- \n\n**Risks / Blockers:**\n- \n\n**Next Steps:**\n- `,'Status update');}
/* popovers */
function placePop(anchor){const p=$('pop');if(getComputedStyle($('ribbon')).overflowX!=='visible'){const a=anchor.getBoundingClientRect();Object.assign(p.style,{position:'fixed',left:'8px',right:'8px',top:'auto',bottom:Math.max(8,innerHeight-a.top+6)+'px',maxWidth:'none',width:'auto',maxHeight:Math.max(160,a.top-16)+'px',overflowY:'auto'});return}p.style.position=p.style.top=p.style.bottom=p.style.width=p.style.maxHeight=p.style.overflowY='';const r=$('ribbon').getBoundingClientRect();const a=anchor.getBoundingClientRect();p.style.maxWidth='calc(100vw - 16px)';let right=r.right-a.right;p.style.right=right+'px';p.style.left='auto';const pr=p.getBoundingClientRect();if(pr.left<8){right-=8-pr.left;p.style.right=right+'px'}}
function openPop(anchor,kind,html){const p=$('pop');if(p.dataset.kind===kind&&!p.hidden){closePop();return;}document.querySelectorAll('.r-btn,.r-ctx').forEach(b=>b.setAttribute&&b.setAttribute('aria-expanded','false'));p.dataset.kind=kind;p.innerHTML=html;p.hidden=false;placePop(anchor);anchor.setAttribute&&anchor.setAttribute('aria-expanded','true');}
function closePop(){const p=$('pop');if(p){p.hidden=true;p.dataset.kind=''}document.querySelectorAll('.r-btn').forEach(b=>b.setAttribute('aria-expanded','false'));}
document.addEventListener('click',e=>{if(!e.target.closest('#ribbon')&&!e.target.closest('.aibar'))closePop();});
function repoPopover(e){e.stopPropagation();const gh=ghReady(),az=azReady();openPop($('rRepo'),'repo',`<h4>Repositories<small>Config is separate from publishing.</small></h4><button class="primary" onclick="closePop();pushRepos()">↑ Push current entry <span class="st ${gh||az?'ready':''}">${gh||az?'ready':'setup'}</span></button><button onclick="closePop();pullRepos()">↓ Pull entries</button><button onclick="closePop();openModal('repoModal')">Repository settings</button>`);}
function copyPopover(e){e.stopPropagation();openPop($('rCopy'),'copy',`<h4>Copy<small>Move your work anywhere.</small></h4><button onclick="closePop();copyMarkdown()">Copy Markdown</button><button onclick="closePop();copyRendered()">Copy Rendered</button><button onclick="closePop();copySelection()">Copy Selection</button><hr><button onclick="closePop();copyExecSummary()">Copy Executive Summary</button><button onclick="closePop();copyStatus()">Copy Status Update</button>`);}
function ctxPopover(e){e.stopPropagation();const p=currentProject();if(!p){toast('Add a #tag to set project context.');return;}const es=allEntries().filter(x=>(x.text||'').toLowerCase().includes('#'+p));const cs=es.flatMap(x=>candidates(x.text));const count=lab=>cs.filter(c=>c.label.includes(lab)).length;openPop($('rCtx'),'ctx',`<h4>#${esc(p)}<small>Project context</small></h4><button disabled>Entries <span class="st">${es.length}</span></button><button disabled>Decisions <span class="st">${count('decision')}</span></button><button disabled>Learnings <span class="st">${count('learning')}</span></button><button disabled>Blockers <span class="st">${count('blocker')}</span></button><hr><button onclick="closePop();openBrowse('projects')">Open in Browse</button>`);}
/* insertion */
function insertBlock(text){if(mode==='source'){const ta=$('source');const p=ta.selectionStart||ta.value.length;const before=ta.value.slice(0,p),after=ta.value.slice(p);const glue=before&&!/\n$/.test(before)?'\n':'';ta.value=before+glue+text+'\n'+after;mdBuffer=ta.value;scheduleSave();renderRibbon();return;}if(mode==='preview')setMode('write');const e=$('entry');e.focus();const html=renderMD(text)+'<p><br></p>';let done=false;try{done=document.execCommand('insertHTML',false,html);}catch{}if(!done){e.innerHTML=(e.innerHTML||'')+html;}mdBuffer=htmlToMD(e);scheduleSave();renderRibbon();pushHistory();}
/* toolbar */
function g(e){e.preventDefault();}
function ensureWrite(){if(mode!=='write')setMode('write');$('entry').focus();}
function fmtBlock(tag){ensureWrite();try{document.execCommand('formatBlock',false,tag);}catch{}sync();}
function fmt(cmd){ensureWrite();try{
    if(cmd==='bold')document.execCommand('bold');else if(cmd==='italic')document.execCommand('italic');else if(cmd==='underline')document.execCommand('underline');else if(cmd==='strike')document.execCommand('strikeThrough');
    else if(cmd==='highlight'){wrapSel('mark');}else if(cmd==='ul')document.execCommand('insertUnorderedList');else if(cmd==='ol')document.execCommand('insertOrderedList');else if(cmd==='quote')document.execCommand('formatBlock',false,'BLOCKQUOTE');
    else if(cmd==='task'){insertBlock('- [ ] ');}else if(cmd==='hr'){document.execCommand('insertHorizontalRule');}else if(cmd==='table'){insertBlock('\n| Column | Column |\n|---|---|\n| · | · |\n');}
    else if(cmd==='clear'){document.execCommand('removeFormat');document.execCommand('formatBlock',false,'P');}
    else if(cmd==='code'){const s=getSelection();const t=s&&s.toString();document.execCommand('insertHTML',false,'<code>'+esc(t||'code')+'</code>');}
    else if(cmd==='link'){const s=getSelection();const t=(s&&s.toString())||'';const url=prompt('Link URL:','https://');if(url){document.execCommand('insertHTML',false,'<a href="'+esc(url)+'">'+esc(t||url)+'</a>');}}
  }catch{}sync();}
function wrapSel(tag){const s=getSelection();if(!s||!s.rangeCount||s.isCollapsed){document.execCommand('insertHTML',false,'<'+tag+'>'+tag+'</'+tag+'>');return;}document.execCommand('insertHTML',false,'<'+tag+'>'+esc(s.toString())+'</'+tag+'>');}
function sync(){mdBuffer=htmlToMD($('entry'));scheduleSave();renderRibbon();pushHistory();}
/* undo/redo */
let hist=[],hi=-1,histT=null;
function resetHistory(){hist=[mdBuffer];hi=0;}
function pushHistory(){clearTimeout(histT);histT=setTimeout(()=>{const cur=mode==='write'?htmlToMD($('entry')):(mode==='source'?$('source').value:mdBuffer);if(hist[hi]===cur)return;hist=hist.slice(0,hi+1);hist.push(cur);if(hist.length>100)hist.shift();hi=hist.length-1;},250);}
function doUndo(){if(hi>0){hi--;mdBuffer=hist[hi];refreshPane();scheduleSave();renderRibbon();toast('Undo');}}
function doRedo(){if(hi<hist.length-1){hi++;mdBuffer=hist[hi];refreshPane();scheduleSave();renderRibbon();toast('Redo');}}
/* images */
function pickImage(){$('imgInput').click();}
function readImage(file){if(!/^image\//.test(file.type)){toast('Not an image.');return;}if(file.size>3*1024*1024)toast('Large image ('+bytesL(file.size)+') — enable “Store images as files” in Repositories to keep the .md small.');const rd=new FileReader();rd.onload=ev=>{const src=ev.target.result;ensureWrite();const html='<img src="'+src+'" alt="'+esc(file.name||'image')+'">';let ok=false;try{ok=document.execCommand('insertHTML',false,html);}catch{}if(!ok)$('entry').innerHTML+=html;sync();toast('Image inserted.');};rd.readAsDataURL(file);}
/* ============================================================ COMMAND LIBRARY ============================================================ */
const IMG='![caption — paste an image, drag it in, or use /image]()';
const SCAF={
note:['📝','Note','Quick thought','Capture',['**Note** · '+curLabel(),'',': '].join('\n')],
idea:['💡','Idea','Capture an idea with a first step','Capture',['### 💡 Idea — ','','**What if** ','**Why it matters** ','**Smallest test** ','**Effort vs. impact** low / med / high','','> Consider: who benefits? what would prove it? what could go wrong?'].join('\n')],
decision:['◆','Decision','Record a decision & its reasoning','Capture',['### ◆ Decision — ','','**Decision** ','**Context** ','**Options considered**','1. ','2. ','**Rationale** ','**Tradeoffs** ','**Revisit when** ','','> Consider: reversible or one-way door? who needs to know?'].join('\n')],
learning:['▣','Learning','What you learned + how to apply it','Capture',['### ▣ Learning — ','','**Insight** ','**Evidence** ','**So what / apply to** ','**Open question** '].join('\n')],
win:['★','Win','Celebrate & bank a win','Capture',['### ★ Win — ','','**Achievement** ','**Impact** ','**Who benefited** ','**Repeatable?** '].join('\n')],
question:['❓','Open question','Park a question to chase later','Capture',['### ❓ Open Question — ','','**Question** ','**Why it matters** ','**Where to look** ','**Owner / due** '].join('\n')],
blocker:['⛌','Blocker','Name a blocker & the unblock','Capture',['### ⛌ Blocker — ','','**Blocked on** ','**Impact if unresolved** ','**Who/what unblocks it** ','**Workaround** ','**Escalate by** '].join('\n')],
project:['🚀','Project brief','Full project scaffold with milestones & risks','Structure',['## 🚀 Project — ','','**One-liner** _what is this in a sentence?_','**Status** #status/exploring','**Owner** ','**Tags** #project/','**Updated** '+curLabel(),'','### Why now','- **Problem** ','- **Opportunity** ','- **Cost of inaction** ','','### Scope','**In scope**','- [ ] ','**Out of scope**','- ','','### Approach','1. ','2. ','3. ','','### Milestones','| Milestone | Target | Status |','|---|---|---|','| Kickoff |  | ☐ |','|  |  | ☐ |','','### Risks & considerations','- [ ] Dependencies ','- [ ] Security / privacy ','- [ ] Rollback plan ','- [ ] Success metric ','','### Architecture / sketch',IMG,'','### Open questions','- ','','### Next step','- [ ] '].join('\n')],
meeting:['👥','Meeting','Agenda, notes, decisions, actions','Structure',['## 👥 Meeting — ','','**When** '+curLabel()+'  **Attendees** ','**Purpose** ','','### Agenda','1. ','2. ','','### Notes','- ','','### Decisions','- ◆ ','','### Action items','- [ ]  — @owner — due ','','### Follow-up','- '].join('\n')],
standup:['⤴','Standup','Yesterday / today / blockers','Structure',['### Standup — '+curLabel(),'','**Yesterday** ','**Today** ','**Blockers** '].join('\n')],
oneonone:['⚄','1:1','Talking points & follow-ups','Structure',['## 1:1 — ','','**Wins since last time** ','**Challenges** ','**Support needed** ','**Feedback (both ways)** ','**Follow-ups**','- [ ] '].join('\n')],
retro:['♺','Retro','Went well / didn\'t / change','Structure',['## Retro — '+curLabel(),'','### 🟢 What went well','- ','### 🔴 What didn\'t','- ','### 🔧 What to change','- [ ] '].join('\n')],
plan:['▦','Plan / roadmap','Goal, milestones, risks','Structure',['## Plan — ','','**Goal** ','**Definition of done** ','','### Milestones','1. ','2. ','','### Risks','- ','','### Next step','- [ ] '].join('\n')],
weekly:['🗓','Weekly review','Reflect and set next week','Structure',['## Weekly Review — week of '+curLabel(),'','**Wins** ','**Lessons** ','**Metrics / progress** ','**Next week\'s focus** ','**One thing to stop** '].join('\n')],
bug:['🐞','Bug report','Repro, expected/actual, root cause','Engineering',['## 🐞 Bug — ','','**Severity** S? **Area** ','**Symptom** ','','### Repro steps','1. ','2. ','','**Expected** ','**Actual** ','**Env / version** ','','### Investigation','- ','**Root cause** ','**Fix** ','','### Verification','- [ ] Reproduced  - [ ] Fixed  - [ ] Regression test  - [ ] Released'].join('\n')],
feature:['✦','Feature note','User need, approach, acceptance','Engineering',['## ✦ Feature — ','','**User need** _as a … I want … so that …_','**Approach** ','','### Acceptance criteria','- [ ] ','- [ ] ','','### Considerations','- [ ] Edge cases  - [ ] Errors  - [ ] Telemetry  - [ ] Accessibility  - [ ] Docs','','### Open questions','- '].join('\n')],
code:['{ }','Code snippet','Fenced code block + note','Engineering',['### Snippet — ','','```','','```','**What it does** ','**Gotchas** '].join('\n')],
api:['API','API / contract','Endpoint, request/response, errors','Engineering',['## API — ','','**Purpose** ','**Method / path** `GET /`','','### Request','```json','{}','```','### Response','```json','{}','```','**Errors** ','**Auth / scopes** ','','### Non-functional','- [ ] Idempotency  - [ ] Rate limits  - [ ] Versioning  - [ ] Observability'].join('\n')],
sql:['SQL','Query analysis','Question, query, findings','Engineering',['## Query — ','','**Question** ','**Grain** _one row = _','','```sql','SELECT *','FROM table','WHERE 1=1;','```','','### Validation','- [ ] Row count reconciled  - [ ] Nulls  - [ ] Grain  - [ ] Sensitive fields','','**Findings** '].join('\n')],
review:['⎇','Code review','Scope, strengths, must-fix','Engineering',['## Review — ','','**Scope / PR** ','**Strengths** ','**Concerns** ','','### Must-fix','- [ ] ','### Nits','- '].join('\n')],
incident:['▲','Incident','Impact, timeline, root cause, follow-ups','Engineering',['## ▲ Incident — ','','**Impact** ','**Detected** '+curLabel()+'  **Resolved** ','','### Timeline','- ','','**Root cause** ','**Mitigation** ','','### Follow-ups','- [ ]  (prevent)','- [ ]  (detect)'].join('\n')],
adr:['ADR','Decision record','Architecture decision record','Engineering',['## Architecture Decision Record — ','','**Status** Proposed','','### Context','','### Decision','','### Alternatives considered','- ','','### Consequences','- ➕ ','- ➖ ','','**Revisit when** '].join('\n')],
design:['◈','Design note','Problem, approach, components, risks','Engineering',['## Design Note — ','','**Problem** ','','### Constraints','- ','### Approach','','### Components','- ','### Data flow','','### Diagram',IMG,'','### Risks','- ','### Open questions','- '].join('\n')],
research:['🔬','Research note','Question, sources, findings','Engineering',['## Research Note — ','','**Question** ','','### Sources','- ','### Observations','- ','### Interpretation','','### Application to the build','- '].join('\n')],
image:['🖼','Image','Upload / paste an image now','Insert',null,()=>pickImage()],
imageph:['▭','Image placeholder','Drop-zone you can fill later','Insert',IMG],
table:['▦','Table','Insert a Markdown table','Insert',['| Column | Column | Column |','|---|---|---|','| · | · | · |','| · | · | · |'].join('\n')],
callout:['❥','Callout','Highlighted note block','Insert',['> [!note] ','> '].join('\n')],
checklist:['☑','Checklist','A fresh task list','Insert',['- [ ] ','- [ ] ','- [ ] '].join('\n')],
codeblock:['⌗','Code block','Empty fenced block','Insert',['```','','```'].join('\n')],
divider:['—','Divider','Horizontal rule','Insert','---'],
quote:['❝','Quote','Block quote','Insert','> '],
link:['🔗','Link','Insert a link','Insert',null,()=>fmt('link')],
ai:['✦','Ask AI','Open the AI menu (context-aware)','Intelligence',null,()=>aiMenuAt()],
curate:['✧','Curate today','Polish today into structured Markdown','Intelligence',null,()=>openIntel('curate')],
extract:['◇','Find artifacts','Pull ideas/decisions/tasks out','Intelligence',null,()=>openIntel('extract')],
discover:['⌕','Discover patterns','Connections across recent entries','Intelligence',null,()=>openIntel('discover')],
memory:['◷','Builder memory','Related prior context','Intelligence',null,()=>openIntel('memory')],
autotag:['#','Auto-tag elements','Stamp #type/* tags on decisions, learnings, blockers…','Intelligence',null,()=>applyAutoTags()],
reflect:['❂','Reflect on today\'s prompt','Expand the daily prompt into a guided template','Capture',null,()=>expandPrompt()],
copymd:['⧉','Copy Markdown','Copy the whole entry','Publish',null,()=>copyMarkdown()],
execsum:['≣','Executive summary','AI or template summary → clipboard','Publish',null,()=>copyExecSummary()],
status:['⤴','Status update','AI or template status → clipboard','Publish',null,()=>copyStatus()],
push:['↑','Push to repositories','Commit current entry','Publish',null,()=>pushRepos()],
pull:['↓','Pull entries','Hydrate from your repo','Publish',null,()=>pullRepos()],
backup:['⭳','Export entire journal','Back up every entry to one file','Publish',null,()=>exportAll()],
restore:['⭱','Import backup','Restore entries from a backup file','Publish',null,()=>importAll()],
expmd:['↧','Export Markdown','Download this entry as .md','Publish',null,()=>exportMD()],
expjson:['{}','Export JSON','Download this entry as .json','Publish',null,()=>exportJSON()],
exphtml:['◫','Export HTML','Download this entry as .html','Publish',null,()=>exportHTML()],
bconst:['✧','Browse: Constellation','Graph of entries','Navigate',null,()=>openBrowse('constellation')],
btime:['≣','Browse: Timeline','Chronological strip','Navigate',null,()=>openBrowse('timeline')],
bproj:['◕','Browse: Projects','Clustered by #tag','Navigate',null,()=>openBrowse('projects')],
bart:['▣','Browse: Artifacts','Media & code gallery','Navigate',null,()=>openBrowse('artifacts')],
bsearch:['🔎','Browse: Search','Search everything','Navigate',null,()=>openBrowse('search')],
repos:['◎','Repositories','Configure GitHub / Azure DevOps','Navigate',null,()=>openModal('repoModal')],
studio:['⚙','Studio','Appearance, providers, intelligence, backup','Navigate',null,()=>openModal('studioModal')]
};
const CATS=[['all','All'],['Capture','Capture'],['Structure','Structure'],['Engineering','Engineering'],['Insert','Insert'],['Intelligence','AI'],['Publish','Publish'],['Navigate','Navigate']];
function curLabel(){return todayISO();}
/* Obsidian nested tag(s) auto-stamped when a scaffold/command is inserted */
const SCAF_TAGS={note:['type/note'],idea:['type/idea'],decision:['type/decision'],learning:['type/learning'],win:['type/win'],question:['type/question'],blocker:['type/blocker'],
project:['type/project','status/exploring'],meeting:['type/meeting'],standup:['type/standup'],oneonone:['type/1on1'],retro:['type/retro'],plan:['type/plan'],weekly:['type/weekly-review'],
bug:['type/bug'],feature:['type/feature'],code:['type/code'],api:['type/api'],sql:['type/query'],review:['type/review'],incident:['type/incident'],adr:['type/adr'],design:['type/design'],research:['type/research'],
callout:['type/note'],checklist:['type/task']};
function libItems(){return Object.entries(SCAF).map(([key,v])=>({key,ic:v[0],name:v[1],desc:v[2],cat:v[3],body:v[4]||null,run:v[5]||null,tags:SCAF_TAGS[key]||null}));}
function runLibItem(it){if(it.run){it.run();}else if(it.body!=null){const tags=(obsidianTagPref()&&it.tags&&it.tags.length)?('\n'+it.tags.map(t=>'#'+t).join(' ')):'';insertBlock('\n'+it.body+tags);toast(it.name+' inserted'+(tags?' · auto-tagged '+it.tags.map(t=>'#'+t).join(' '):'')+'.');}}
/* ============================================================ UNIFIED COMMAND MENU ============================================================ */
let cmdkSel=0, cmdkCat='all';
function openCmdk(prefill){cmdkCat='all';cmdkSel=0;$('cmdkPfx').textContent='/';$('cmdkInput').value=prefill||'';renderCmdkCats();renderCmdk();$('cmdkBack').classList.add('open');setTimeout(()=>$('cmdkInput').focus(),20);}
function closeCmdk(){$('cmdkBack').classList.remove('open');}
function renderCmdkCats(){$('cmdkCats').innerHTML=CATS.map(([k,lb])=>`<button class="cmdk-cat${k===cmdkCat?' on':''}" onclick="setCmdkCat('${k}')">${lb}</button>`).join('');}
function setCmdkCat(k){cmdkCat=k;cmdkSel=0;renderCmdkCats();renderCmdk();$('cmdkInput').focus();}
function cmdkFiltered(){const q=$('cmdkInput').value.trim().toLowerCase();let items=libItems();if(cmdkCat!=='all')items=items.filter(x=>x.cat===cmdkCat);if(q)items=items.filter(x=>(x.name+' '+x.desc+' '+x.cat+' '+x.key).toLowerCase().includes(q));return items;}
function renderCmdk(){const items=cmdkFiltered();const list=$('cmdkList');$('cmdkCount').textContent=items.length+' commands';if(!items.length){list.innerHTML='<div class="cmdk-empty">No commands match. Try a different word or category.</div>';return;}if(cmdkSel>=items.length)cmdkSel=0;let gg='',h='';items.forEach((x,i)=>{if(x.cat!==gg){gg=x.cat;h+=`<div class="cmdk-grp">${gg}</div>`;}const kind=x.run?(x.cat==='Intelligence'?'AI':(x.cat==='Publish'||x.cat==='Navigate'?'action':'insert')):'scaffold';h+=`<div class="cmdk-it${i===cmdkSel?' on':''}" data-i="${i}" onmousemove="cmdkHover(${i})" onclick="cmdkRun(${i})"><span class="ic">${x.ic}</span><span class="tx"><strong>${esc(x.name)}</strong><small>${esc(x.desc)}</small></span><span class="meta"><span class="tag">${kind}</span></span></div>`;});list.innerHTML=h;list._items=items;const on=list.querySelector('.cmdk-it.on');if(on)on.scrollIntoView({block:'nearest'});}
function cmdkHover(i){cmdkSel=i;[...$('cmdkList').querySelectorAll('.cmdk-it')].forEach((el,j)=>el.classList.toggle('on',j===i));}
function cmdkRun(i){const items=$('cmdkList')._items||cmdkFiltered();const it=items[i];if(!it)return;closeCmdk();runLibItem(it);}
/* inline slash → same menu */
function caretInfo(){const s=getSelection&&getSelection();if(!s||!s.rangeCount)return null;const n=s.anchorNode;if(!n)return null;if(n.nodeType===3){const text=n.textContent.slice(0,s.anchorOffset);const m=/(^|\s)\/([a-z]*)$/i.exec(text);if(m)return{node:n,offset:s.anchorOffset,q:m[2].toLowerCase(),len:m[2].length+1};}return null;}
function caretDeleteSlash(info){try{const n=info.node,end=info.offset,start=end-info.len;const r=document.createRange();r.setStart(n,Math.max(0,start));r.setEnd(n,end);r.deleteContents();const s=getSelection();s.removeAllRanges();const c=document.createRange();c.setStart(n,Math.max(0,start));c.collapse(true);s.addRange(c);}catch{}}
function maybeSlash(){const info=caretInfo();if(info){caretDeleteSlash(info);openCmdk(info.q);return true;}return false;}
/* ============================================================ GitHub / Azure ============================================================ */
function getGH(){try{return JSON.parse(store.get(LS.gh))||{}}catch{return{}}}
function getAZ(){try{return JSON.parse(store.get(LS.az))||{}}catch{return{}}}
function ghReady(){const c=getGH();return!!(c.owner&&c.repo&&c.token)}
function azReady(){const c=getAZ();return!!(c.org&&c.project&&c.repo&&c.token)}
function fillRepo(){const gc=getGH(),a=getAZ();if($('ghOwner'))$('ghOwner').value=gc.owner||'';if($('ghRepo'))$('ghRepo').value=gc.repo||'';if($('ghBranch'))$('ghBranch').value=gc.branch||'main';if($('ghPath'))$('ghPath').value=gc.path||'journal';if($('ghToken'))$('ghToken').value=gc.token||'';if($('azOrg'))$('azOrg').value=a.org||'';if($('azProject'))$('azProject').value=a.project||'';if($('azRepo'))$('azRepo').value=a.repo||'';if($('azBranch'))$('azBranch').value=a.branch||'main';if($('azPath'))$('azPath').value=a.path||'journal';if($('azToken'))$('azToken').value=a.token||'';if($('assetsToggle'))$('assetsToggle').checked=assetsPref();repoBadges();}
function repoBadges(){$('ghBadge').textContent=ghReady()?'— configured':'— not configured';$('azBadge').textContent=azReady()?'— configured':'— not configured';}
function normFolder(v){return (v==null?'journal':v).trim().replace(/^\/+|\/+$/g,'');}
function saveGH(){const c={owner:$('ghOwner').value.trim(),repo:$('ghRepo').value.trim(),branch:$('ghBranch').value.trim()||'main',path:normFolder($('ghPath').value),token:$('ghToken').value.trim()};store.set(LS.gh,JSON.stringify(c));setSt('ghStatus','Saved ✓ (folder: '+(c.path||'root')+')','ok');repoBadges();renderRibbon();}
function saveAZ(){const c={org:$('azOrg').value.trim(),project:$('azProject').value.trim(),repo:$('azRepo').value.trim(),branch:$('azBranch').value.trim()||'main',path:normFolder($('azPath').value),token:$('azToken').value.trim()};store.set(LS.az,JSON.stringify(c));setSt('azStatus','Saved ✓ (folder: '+(c.path||'root')+')','ok');repoBadges();renderRibbon();}
function setSt(id,m,c){const e=$(id);if(e){e.className='status '+(c||'');e.innerHTML=m;}}
const ghH=t=>({'Authorization':'Bearer '+t,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'});
const b64=s=>btoa(unescape(encodeURIComponent(s)));
async function testGH(){saveGH();const c=getGH();if(!ghReady()){setSt('ghStatus','Fill owner, repo, and token.','err');return;}setSt('ghStatus','Testing…','info');try{const r=await fetch(`https://api.github.com/repos/${c.owner}/${c.repo}`,{headers:ghH(c.token)});if(r.ok){const j=await r.json();setSt('ghStatus','Connected ✓ '+(j.full_name||''),'ok');}else setSt('ghStatus','Error '+r.status,'err');}catch(e){setSt('ghStatus','Network error: '+e.message,'err');}}
async function ghPutFile(c,path,contentB64,message){const api=`https://api.github.com/repos/${c.owner}/${c.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;let sha=null;try{const g=await fetch(api+'?ref='+encodeURIComponent(c.branch)+'&t='+Date.now(),{headers:ghH(c.token),cache:'no-store'});if(g.ok)sha=(await g.json()).sha;}catch{}const body={message:message||('assets '+path),content:contentB64,branch:c.branch};if(sha)body.sha=sha;const r=await fetch(api,{method:'PUT',headers:{...ghH(c.token),'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok){const t=await r.text();throw new Error('asset '+r.status+': '+t.slice(0,100));}return true;}
async function externalizeImagesGH(c,md){const folder=c.path?c.path.replace(/\/+$/,'')+'/':'';const rx=/!\[[^\]]*\]\((data:([^;)]+);base64,([^)]+))\)/g;const found=[];let m;while((m=rx.exec(md)))found.push({full:m[1],mime:m[2],b64:m[3]});if(!found.length)return md;let out=md,idx=0;const seen={};for(const f of found){if(seen[f.full])continue;idx++;const ext=(f.mime.split('/')[1]||'png').split('+')[0];const name=curDate+'-'+idx+'.'+ext;const path=folder+'assets/'+name;await ghPutFile(c,path,f.b64,'Journal asset '+name);seen[f.full]='assets/'+name;}Object.entries(seen).forEach(([data,rel])=>{out=out.split('('+data+')').join('('+rel+')');});return out;}
async function ghCommit(){const c=getGH();let md=buildMD();if(assetsPref()){try{md=await externalizeImagesGH(c,md);}catch(e){toast('Image upload failed ('+e.message+') — committing inline.');md=buildMD();}}const path=(c.path?c.path+'/':'')+`${curDate}.md`;const api=`https://api.github.com/repos/${c.owner}/${c.repo}/contents/${path.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`;let sha=null;try{const g=await fetch(api+'?ref='+encodeURIComponent(c.branch)+'&t='+Date.now(),{headers:ghH(c.token),cache:'no-store'});if(g.ok){sha=(await g.json()).sha;}}catch{}const known=store.get(LS.sha(curDate));if(sha&&known&&sha!==known){if(!confirm('“'+curDate+'” changed in GitHub since your last sync. Overwrite the remote copy?\n\n(Export a backup first if unsure.)'))throw new Error('Push canceled — remote changed');}const body={message:`Journal ${curDate}`,content:b64(md),branch:c.branch};if(sha)body.sha=sha;const r=await fetch(api,{method:'PUT',headers:{...ghH(c.token),'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok){const t=await r.text();throw new Error('GitHub '+r.status+': '+t.slice(0,120));}const j=await r.json();if(j.content&&j.content.sha)store.set(LS.sha(curDate),j.content.sha);return{provider:'GitHub',path,url:j.commit&&j.commit.html_url||''};}
async function testAZ(){saveAZ();const c=getAZ();if(!azReady()){setSt('azStatus','Fill org, project, repo, and token.','err');return;}setSt('azStatus','Testing…','info');try{const u=`https://dev.azure.com/${c.org}/${c.project}/_apis/git/repositories/${c.repo}?api-version=7.1`;const r=await fetch(u,{headers:{'Authorization':'Basic '+btoa(':'+c.token)}});if(r.ok){const j=await r.json();setSt('azStatus','Connected ✓ '+(j.name||''),'ok');}else setSt('azStatus','Error '+r.status,'err');}catch(e){setSt('azStatus','Network error: '+e.message,'err');}}
async function azCommit(){const c=getAZ();const base=`https://dev.azure.com/${c.org}/${c.project}/_apis/git/repositories/${c.repo}`;const H={'Authorization':'Basic '+btoa(':'+c.token),'Content-Type':'application/json'};const refs=await(await fetch(`${base}/refs?filter=heads/${c.branch}&api-version=7.1`,{headers:H})).json();const oldId=refs.value&&refs.value[0]&&refs.value[0].objectId;if(!oldId)throw new Error('Azure branch '+c.branch+' not found.');const path=(c.path?`/${c.path}`:'')+`/${curDate}.md`;let exists=false;try{const chk=await fetch(`${base}/items?path=${encodeURIComponent(path)}&versionDescriptor.version=${c.branch}&versionDescriptor.versionType=branch&api-version=7.1`,{headers:H});exists=chk.ok;}catch{}const payload={refUpdates:[{name:'refs/heads/'+c.branch,oldObjectId:oldId}],commits:[{comment:`Journal ${curDate}`,changes:[{changeType:exists?'edit':'add',item:{path},newContent:{content:buildMD(),contentType:'rawtext'}}]}]};const r=await fetch(`${base}/pushes?api-version=7.1`,{method:'POST',headers:H,body:JSON.stringify(payload)});if(!r.ok){const t=await r.text();throw new Error('Azure '+r.status+': '+t.slice(0,120));}return{provider:'Azure DevOps',path};}
async function pushRepos(){flush();const jobs=[];if(ghReady())jobs.push(ghCommit());if(azReady())jobs.push(azCommit());if(!jobs.length){toast('Configure a repository first.');openModal('repoModal');return;}setStatus('pushing');toast('Pushing…');const res=await Promise.allSettled(jobs);const ok=res.filter(x=>x.status==='fulfilled'),bad=res.filter(x=>x.status==='rejected');setStatus('saved');if(bad.length)toast((ok.length?ok.length+' pushed. ':'')+bad.map(x=>x.reason.message).join(' | '));else toast('Pushed ✓ '+ok.map(x=>x.value.provider).join(' + '));}
function parseEntryMD(md,fallbackDate){let s=String(md||'').replace(/\r\n?/g,'\n');let date=fallbackDate||todayISO(),project='',created='';
  /* ---- YAML frontmatter (new Obsidian schema) ---- */
  let prompt='',promptId='';
  const fm=/^---\n([\s\S]*?)\n---\n?/.exec(s);
  if(fm){const y=fm[1];
    const dm=/(?:^|\n)date:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/.exec(y);if(dm)date=dm[1];
    const cm=/(?:^|\n)created:\s*(\S+)/.exec(y);if(cm)created=cm[1];
    const pm=/(?:^|\n)prompt:\s*"?([^"\n]+)"?/.exec(y);if(pm)prompt=pm[1].trim().replace(/"$/,'');
    const pj=/(?:^|\n)projects:\s*\n((?:[ \t]*-[ \t]*.+\n?)+)/.exec(y);
    if(pj){const f=/-[ \t]*(.+)/.exec(pj[1]);if(f)project=f[1].trim().replace(/^["'\[]+|["'\]]+$/g,'').replace(/^project\//,'');}
    if(!project){const pt=/project\/([a-z0-9_-]+)/i.exec(y);if(pt)project=pt[1];}
    s=s.slice(fm[0].length);}
  let lines=s.split('\n');
  /* ---- legacy or new H1 date heading ---- */
  const hi2=lines.findIndex(l=>/^#\s+\d{4}-\d{2}-\d{2}/.test(l));
  if(hi2>=0){const m=/^#\s+(\d{4}-\d{2}-\d{2})(?:\s*·\s*(?:#|\[\[)?([a-z0-9\/_-]+)\]?\]?)?/i.exec(lines[hi2]);if(m){date=m[1];if(!project&&m[2])project=m[2].replace(/^project\//,'');}lines=lines.slice(hi2+1);}
  while(lines.length&&!lines[0].trim())lines.shift();
  while(lines.length&&/^>/.test(lines[0]))lines.shift();
  while(lines.length&&!lines[0].trim())lines.shift();
  /* ---- strip trailing footer (Projects / Related / _The Daily_ / hr) ---- */
  for(let i=lines.length-1;i>=0;i--){if(/^_The Daily/.test(lines[i].trim())){lines=lines.slice(0,i);
    while(lines.length){const t=lines[lines.length-1].trim();if(!t||/^\*\*(projects|related|tags)\s*:?\*\*/i.test(t)||/^-{3,}$/.test(t)){lines.pop();}else break;}break;}}
  let text=lines.join('\n').trim();if(text==='_(no entry)_')text='';
  if(prompt){const hit=PROMPTS.find(p=>p.q===prompt);if(hit)promptId=hit.id;}
  return{date,project,text,created,prompt,promptId};}
async function ghList(){const c=getGH();const seg=(c.path||'').split('/').filter(Boolean).map(encodeURIComponent).join('/');const dir=`https://api.github.com/repos/${c.owner}/${c.repo}/contents/${seg}?ref=${encodeURIComponent(c.branch)}&t=${Date.now()}`;const r=await fetch(dir,{headers:ghH(c.token),cache:'no-store'});if(r.status===404)return[];if(!r.ok)throw new Error('GitHub '+r.status);const arr=await r.json();return(Array.isArray(arr)?arr:[]).filter(f=>f.type==='file'&&/\d{4}-\d{2}-\d{2}\.md$/i.test(f.name));}
const b64decode=s=>{try{return decodeURIComponent(escape(atob((s||'').replace(/\s/g,''))))}catch{try{return atob((s||'').replace(/\s/g,''))}catch{return''}}};
async function ghFetch(f){const c=getGH();const api=`https://api.github.com/repos/${c.owner}/${c.repo}/contents/${f.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(c.branch)}&t=${Date.now()}`;const r=await fetch(api,{headers:ghH(c.token),cache:'no-store'});if(r.ok){const j=await r.json();if(j&&j.content&&/base64/i.test(j.encoding||'base64'))return b64decode(j.content);if(j&&typeof j.content==='string')return j.content;}if(f.download_url){const d=await fetch(f.download_url+((f.download_url.includes('?')?'&':'?')+'t='+Date.now()),{cache:'no-store'});if(d.ok)return await d.text();}throw new Error('GitHub content '+r.status);}
async function azList(){const c=getAZ();const base=`https://dev.azure.com/${c.org}/${c.project}/_apis/git/repositories/${c.repo}`;const H={'Authorization':'Basic '+btoa(':'+c.token)};const scope=c.path?('/'+c.path):'/';const u=`${base}/items?scopePath=${encodeURIComponent(scope)}&recursionLevel=OneLevel&versionDescriptor.version=${encodeURIComponent(c.branch)}&versionDescriptor.versionType=branch&api-version=7.1`;const r=await fetch(u,{headers:H});if(r.status===404)return[];if(!r.ok)throw new Error('Azure '+r.status);const j=await r.json();return(j.value||[]).filter(it=>!it.isFolder&&/\d{4}-\d{2}-\d{2}\.md$/i.test(it.path||''));}
async function azFetch(it){const c=getAZ();const base=`https://dev.azure.com/${c.org}/${c.project}/_apis/git/repositories/${c.repo}`;const H={'Authorization':'Basic '+btoa(':'+c.token)};const u=`${base}/items?path=${encodeURIComponent(it.path)}&versionDescriptor.version=${encodeURIComponent(c.branch)}&versionDescriptor.versionType=branch&includeContent=true&$format=json&api-version=7.1`;const r=await fetch(u,{headers:H});if(!r.ok)throw new Error('Azure '+r.status);const j=await r.json();return j.content||'';}
async function pullOne(date){const name=date+'.md';if(ghReady()){const c=getGH();try{const f={path:(c.path?c.path+'/':'')+name,name};const md=await ghFetch(f);if(md&&md.trim()){const p=parseEntryMD(md,date);store.set(LS.entry(p.date),JSON.stringify({date:p.date,savedAt:new Date().toISOString(),created:p.created||new Date().toISOString(),text:p.text,project:p.project,promptId:p.promptId||'',prompt:p.prompt||'',source:'GitHub'}));if(p.promptId)store.set(LS.prompt(p.date),p.promptId);return true;}}catch(e){}}if(azReady()){const c=getAZ();try{const it={path:(c.path?`/${c.path}`:'')+'/'+name};const md=await azFetch(it);if(md&&md.trim()){const p=parseEntryMD(md,date);store.set(LS.entry(p.date),JSON.stringify({date:p.date,savedAt:new Date().toISOString(),created:p.created||new Date().toISOString(),text:p.text,project:p.project,promptId:p.promptId||'',prompt:p.prompt||'',source:'Azure DevOps'}));if(p.promptId)store.set(LS.prompt(p.date),p.promptId);return true;}}catch(e){}}return false;}
async function diagRepos(outId,append){const out=$(outId||'repoDiag');out.style.display='block';const log=append&&out.textContent?[out.textContent]:[];const L=s=>{log.push(s);out.textContent=log.join('\n');};L('Diagnosing…');L('');const DATE=/\d{4}-\d{2}-\d{2}\.md$/i;if(ghReady()){const c=getGH();const dir=`https://api.github.com/repos/${c.owner}/${c.repo}/contents/${c.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(c.branch)}&t=${Date.now()}`;L('■ GitHub '+c.owner+'/'+c.repo+' ('+c.branch+', folder "'+c.path+'")');try{const r=await fetch(dir,{headers:ghH(c.token),cache:'no-store'});L('  status: '+r.status);if(r.ok){const arr=await r.json();if(Array.isArray(arr)){const files=arr.filter(f=>f.type==='file');L('  files: '+files.length+' · dated .md: '+files.filter(f=>DATE.test(f.name)).length);L('  names: '+(files.slice(0,12).map(f=>f.name).join(', ')||'(none)'));}else L('  → path is a FILE, not a folder.');}}catch(e){L('  network/CORS: '+e.message);}L('');}else L('■ GitHub — not configured\n');if(azReady()){const c=getAZ();L('■ Azure DevOps '+c.org+'/'+c.project+'/'+c.repo);}else L('■ Azure DevOps — not configured');}
async function syncFromBrowse(){const note=$('browseSyncNote');const diag=$('browseDiag');if(diag){diag.style.display='none';diag.textContent='';}if(!(ghReady()||azReady())){toast('Configure a repository first.');openModal('repoModal');return;}if(note)note.textContent='Syncing…';const r=await pullRepos({silent:true});if(note)note.textContent=(r.added||r.updated)?`Synced ${r.added} new`+(r.updated?`, ${r.updated} updated`:''):(r.seen?`Found ${r.seen} files`:'No files found');if(!r.added&&!r.updated){const d=$('browseDiag');d.style.display='block';await diagRepos('browseDiag',true);}}
function pullOverwriteConfirm(){if(!(ghReady()||azReady())){toast('Configure a repository first.');openModal('repoModal');return;}const localCount=allEntries().length;if(confirm('Pull & overwrite replaces local copies with the repository versions for any dates present in the repo.\n\nYou have '+localCount+' local entries. Export a backup first if unsure.\n\nProceed?')){closeModal('repoModal');pullRepos({overwrite:true});}}
async function pullRepos(opts={}){opts=opts||{};const overwrite=!!opts.overwrite;const providers=[];if(ghReady())providers.push(['GitHub',ghList,ghFetch]);if(azReady())providers.push(['Azure DevOps',azList,azFetch]);if(!providers.length){if(!opts.silent){toast('Configure a repository first.');openModal('repoModal');}return{added:0,updated:0};}setStatus('pushing');if(!opts.silent)toast('Pulling…');let added=0,updated=0,seen=0;const errors=[];for(const[name,list,fetchOne]of providers){try{const files=await list();for(const f of files){seen++;try{const md=await fetchOne(f);const nm=(f.name||f.path||'').split('/').pop();const fb=(nm.match(/(\d{4}-\d{2}-\d{2})/)||[])[1]||todayISO();const p=parseEntryMD(md,fb);if(!p.date)continue;const existing=loadEntry(p.date);if(existing&&!overwrite)continue;if(store.set(LS.entry(p.date),JSON.stringify({date:p.date,savedAt:new Date().toISOString(),created:p.created||new Date().toISOString(),text:p.text,project:p.project,promptId:p.promptId||'',prompt:p.prompt||'',source:name}))){if(name==='GitHub'&&f.sha)store.set(LS.sha(p.date),f.sha);if(p.promptId)store.set(LS.prompt(p.date),p.promptId);existing?updated++:added++;}}catch(e){errors.push(name+': '+e.message);}}}catch(e){errors.push(name+' list: '+e.message);}}setStatus('saved');const cur=loadEntry(curDate);if(cur&&document.activeElement!==$('entry')){setEntryText(cur.text);}renderRibbon();if($('browseModal').classList.contains('open')){const on=document.querySelector('#browseSeg button.on');browseTab(on?on.dataset.b:'constellation');}if(!opts.silent||added||updated){let msg=`Pulled ${added} new`+(updated?`, ${updated} updated`:'')+(seen?` · ${seen} files`:'');if(errors.length)msg+=` · ${errors.length} error(s)`;toast(msg);}return{added,updated,seen,errors};}
/* fast save */
async function quickSave(){flush();const btns=[$('navSave'),$('tbSave')];btns.forEach(b=>b&&b.classList.add('busy'));try{if(ghReady()||azReady()){await pushRepos();}else{toast('Saved locally ✓ — configure a repo to Push.');}}finally{btns.forEach(b=>b&&b.classList.remove('busy'));}}
/* ============================================================ AI (seamless, streaming, hardened) ============================================================ */
function getAI(){try{return JSON.parse(store.get(LS.ai))||{}}catch{return{}}}
/* Provider catalog. kind = wire format: openai (Chat Completions), azure (Azure OpenAI / Foundry), anthropic (Messages API).
   relayOnly = the provider doesn't accept calls straight from a web page, so it's configured in .env for the relay. */
const PROV={
  relay:{label:'This computer’s relay (.env)',group:'Recommended',kind:'openai',base:'',model:'',key:false,help:'Uses the AI provider set in .env on this computer. No key is stored in the browser.'},
  openai:{label:'OpenAI',group:'Cloud',kind:'openai',base:'https://api.openai.com/v1',model:'gpt-5-mini',ph:'e.g. gpt-5-mini',help:'OpenAI Chat Completions with an API key from platform.openai.com.',env:'openai'},
  anthropic:{label:'Anthropic Claude',group:'Cloud',kind:'anthropic',base:'https://api.anthropic.com',model:'claude-sonnet-5-5',ph:'e.g. claude-sonnet-5-5',help:'Claude Messages API with a key from the Claude Console.',env:'anthropic'},
  gemini:{label:'Google Gemini',group:'Cloud',kind:'openai',base:'https://generativelanguage.googleapis.com/v1beta/openai',model:'',ph:'a Gemini model ID',help:'Gemini through its OpenAI-compatible endpoint, with a key from Google AI Studio.',env:'gemini'},
  openrouter:{label:'OpenRouter',group:'Cloud',kind:'openai',base:'https://openrouter.ai/api/v1',model:'',ph:'e.g. anthropic/claude-sonnet-5-5',help:'One key for many providers’ models.',env:'openrouter'},
  groq:{label:'Groq',group:'Cloud',kind:'openai',base:'https://api.groq.com/openai/v1',model:'',ph:'a Groq model ID',help:'Fast hosted open-weight models.',env:'groq'},
  mistral:{label:'Mistral',group:'Cloud',kind:'openai',base:'https://api.mistral.ai/v1',model:'',ph:'e.g. mistral-small-latest',help:'Mistral’s hosted models.',env:'mistral'},
  deepseek:{label:'DeepSeek',group:'Cloud',kind:'openai',base:'https://api.deepseek.com/v1',model:'deepseek-chat',ph:'deepseek-chat',help:'DeepSeek’s hosted API.',env:'deepseek'},
  xai:{label:'xAI Grok',group:'Cloud',kind:'openai',base:'https://api.x.ai/v1',model:'',ph:'a Grok model ID',help:'xAI’s hosted API.',env:'xai'},
  azure:{label:'Azure OpenAI / Microsoft Foundry',group:'Microsoft Azure',kind:'azure',relayOnly:true,base:'https://YOUR-RESOURCE.openai.azure.com/openai/v1',model:'',ph:'your deployment name',help:'OpenAI and other Foundry models (DeepSeek, Llama, Grok, Mistral…) through the v1 endpoint. The model field is your deployment name.',env:'azure',entra:true},
  foundryclaude:{label:'Claude in Microsoft Foundry',group:'Microsoft Azure',kind:'anthropic',relayOnly:true,base:'https://YOUR-RESOURCE.services.ai.azure.com/anthropic',model:'',ph:'your Claude deployment name',help:'Claude deployed in a Foundry resource, billed through Azure.',env:'anthropic',entra:true},
  ollama:{label:'Ollama',group:'On this computer',kind:'openai',base:'http://localhost:11434/v1',model:'',ph:'e.g. llama3.1',key:false,help:'Runs models locally. Nothing leaves your machine.',env:'ollama'},
  lmstudio:{label:'LM Studio',group:'On this computer',kind:'openai',base:'http://localhost:1234/v1',model:'',ph:'the loaded model ID',key:false,help:'Runs models locally. Start its local server first.',env:'lmstudio'},
  custom:{label:'Other OpenAI-compatible server',group:'On this computer',kind:'openai',base:'',model:'',ph:'model ID',help:'Any server that speaks the OpenAI Chat Completions API.',env:'compatible'}
};
const PROV_ALIAS={foundry:'azure',local:'custom'};
function aiProvKey(c){c=c||getAI();if(c.relay||(c.base&&aiSameOrigin(c.base)))return'relay';const p=PROV_ALIAS[c.prov]||c.prov;return PROV[p]?p:'openai'}
function aiSameOrigin(u){try{return new URL(u,location.href).origin===location.origin}catch{return false}}
function aiIsRelay(c){c=c||getAI();return !!(c.relay||(c.base&&aiSameOrigin(c.base)))}
function aiKind(c){c=c||getAI();const b=(c.base||'').toLowerCase();if(/\/anthropic(\/|$)|api\.anthropic\.com/.test(b))return'anthropic';if(/\.(openai\.azure\.com|services\.ai\.azure\.com|cognitiveservices\.azure\.com)/.test(b))return'azure';if(aiIsRelay(c))return'openai';return(PROV[aiProvKey(c)]||{}).kind||'openai'}
function aiIsAzure(c){return aiKind(c)==='azure'}
function aiReady(){const c=getAI();if(aiIsRelay(c))return !!(c.base&&(c.model||window.__relayConfig?.ai?.configured));return !!(c.base&&c.model)}
function fillAI(){const c=getAI(),p=aiProvKey(c);if($('aiBase'))$('aiBase').value=c.base||'';if($('aiModel'))$('aiModel').value=c.model||'';if($('aiKey'))$('aiKey').value=c.relay?'':(c.key||'');if($('aiVer'))$('aiVer').value=c.ver||'';const sel=$('aiProvSel');if(sel)sel.value=p;provUI(p);aiBadge();}
function aiBadge(){const c=getAI();if($('aiBadge'))$('aiBadge').textContent=aiReady()?(aiIsRelay(c)?'— through the relay':'— connected'):'— optional, not connected';try{document.dispatchEvent(new CustomEvent('daily:ai'))}catch(_){}}
function pickProv(p){const d=PROV[p]||PROV.openai;$('aiBase').value=p==='relay'?location.origin+'/v1':d.base;$('aiModel').value=p==='relay'?(window.__relayConfig?.ai?.model||''):d.model;if($('aiVer'))$('aiVer').value='';const sel=$('aiProvSel');if(sel)sel.value=p;provUI(p);}
function provUI(p){const d=PROV[p]||PROV.openai,az=d.kind==='azure';if($('azVer'))$('azVer').style.display=az?'block':'none';if($('aiModelLabel'))$('aiModelLabel').textContent=az||p==='foundryclaude'?'Deployment name':'Model';if($('aiModel'))$('aiModel').placeholder=d.ph||'model';const k=$('aiKey');if(k){k.placeholder=d.key===false?'Not needed':(d.kind==='anthropic'?'sk-ant-…':az?'Azure key':'API key');k.disabled=d.key===false}if($('provHelp'))$('provHelp').textContent=(d.help||'')+(d.relayOnly?' Browsers can’t call this provider directly — set it up in .env for the relay (see above).':'');}
function saveAI(){const sel=$('aiProvSel');const prov=sel?sel.value:(document.querySelector('.provgrid button.on')?.dataset.prov||'openai');const cfg={prov,base:$('aiBase').value.trim().replace(/\/+$/,''),model:$('aiModel').value.trim(),key:$('aiKey').disabled?'':$('aiKey').value.trim(),ver:($('aiVer')?.value||'').trim()};if(prov==='relay'){cfg.base=location.origin;cfg.key='';cfg.relay=true;cfg.model=cfg.model||window.__relayConfig?.ai?.model||''}store.set(LS.ai,JSON.stringify(cfg));const need=[];if(!cfg.base)need.push('Base URL');if(!cfg.model&&prov!=='relay')need.push('Model');setSt('aiStatus',need.length?('Saved — still need: '+need.join(', ')):'Saved ✓','ok');aiBadge();}
function aiHost(u){try{return new URL(u).host}catch{return u}}
function aiResolve(cfg){const c=cfg||getAI(),kind=aiKind(c),h={'Content-Type':'application/json'};let base=(c.base||'').replace(/\/+$/,''),url,includeModel=true;
  if(kind==='anthropic'){if(c.key)h['x-api-key']=c.key;h['anthropic-version']='2023-06-01';if(/api\.anthropic\.com/i.test(base))h['anthropic-dangerous-direct-browser-access']='true';url=/\/messages$/.test(base)?base:(/\/v1$/.test(base)?base:base+'/v1')+'/messages';}
  else if(kind==='azure'){if(c.key)h['api-key']=c.key;if(/\/chat\/completions(\?|$)/i.test(base)){url=base;includeModel=!/\/openai\/deployments\//i.test(base);}else if(/\/openai\/deployments\//i.test(base)){url=base+'/chat/completions';includeModel=false;}else if(/\/openai\/v1$/i.test(base)||/\/models$/i.test(base)){url=base+'/chat/completions';}else if(c.ver){url=base+'/openai/deployments/'+encodeURIComponent(c.model)+'/chat/completions';includeModel=false;}else{url=base+'/openai/v1/chat/completions';}if(!/\/openai\/v1\//i.test(url)&&!/api-version=/i.test(url))url+=(url.includes('?')?'&':'?')+'api-version='+encodeURIComponent(c.ver||'2024-10-21');}
  else{if(c.key)h['Authorization']='Bearer '+c.key;if(/\/chat\/completions$/i.test(base))url=base;else{let path='';try{path=new URL(base,location.href).pathname}catch(_){}if(!path||path==='/')base+='/v1';url=base+'/chat/completions';}}
  return{url,h,kind,azure:kind==='azure',includeModel};}
function aiReconcile(data,msg){const low=(msg||'').toLowerCase();if(/max_completion_tokens/.test(low)&&/max_tokens/.test(low)){if('max_tokens'in data){data.max_completion_tokens=data.max_tokens;delete data.max_tokens;return true;}if('max_completion_tokens'in data){data.max_tokens=data.max_completion_tokens;delete data.max_completion_tokens;return true;}}for(const p of['temperature','top_p','reasoning_effort','presence_penalty','frequency_penalty']){if(low.includes(p)&&p in data){delete data[p];return true;}}const m=low.match(/unsupported parameter:?\s*['"`]?([a-z_]+)/);if(m&&m[1]in data){delete data[m[1]];return true;}return false;}
function aiExtractText(j){if(!j||typeof j!=='object')return'';if(j.type==='content_block_delta')return j.delta?.text||'';if(Array.isArray(j.content)&&!j.choices)return j.content.filter(b=>b&&b.type==='text').map(b=>b.text).join('');const ch=Array.isArray(j.choices)?j.choices[0]:null;if(!ch)return'';const v=ch.delta?.content??ch.message?.content??ch.text??'';if(typeof v==='string')return v;if(Array.isArray(v))return v.map(x=>typeof x==='string'?x:(x?.text??x?.content??'')).join('');return'';}
function aiSSEData(record){return String(record||'').split(/\r?\n/).filter(x=>/^data\s*:/i.test(x)).map(x=>x.replace(/^data\s*:\s?/i,'')).join('\n').trim();}
function aiParseSSE(record){const data=aiSSEData(record);if(!data||data==='[DONE]')return'';try{const j=JSON.parse(data);if(j&&j.error&&!j.choices)throw new Error(j.error.message||'stream error');return aiExtractText(j);}catch(e){if(e&&e.message&&!/JSON/.test(e.message))throw e;return'';}}
async function aiReadSSE(r,onToken){const reader=r.body.getReader(),dec=new TextDecoder();let buf='',acc='';const emit=x=>{if(x){acc+=x;if(onToken)onToken(acc);}};const consume=final=>{buf=buf.replace(/\r\n/g,'\n');let i;while((i=buf.indexOf('\n\n'))>=0){emit(aiParseSSE(buf.slice(0,i)));buf=buf.slice(i+2);}if(final&&buf.trim()){emit(aiParseSSE(buf));buf='';}};while(true){const{value,done}=await reader.read();if(value){buf+=dec.decode(value,{stream:!done});consume(false);}if(done){buf+=dec.decode();consume(true);break;}}return acc.trim();}
function aiReadBufferedSSE(raw,onToken){let acc='';String(raw||'').replace(/\r\n/g,'\n').split(/\n\n+/).forEach(rec=>{const x=aiParseSSE(rec);if(x){acc+=x;if(onToken)onToken(acc);}});return acc.trim();}
const AI_REASONING=/^(o\d|gpt-5|gpt-oss|deepseek-r1|qwq)/i;
function aiToAnthropic(data,model){const sys=[],msgs=[];for(const m of data.messages||[]){const t=typeof m.content==='string'?m.content:(Array.isArray(m.content)?m.content.map(x=>typeof x==='string'?x:(x?.text||'')).join(''):String(m.content||''));if(m.role==='system'){sys.push(t);continue}if(m.role!=='user'&&m.role!=='assistant')continue;if(msgs.length&&msgs[msgs.length-1].role===m.role)msgs[msgs.length-1].content+='\n\n'+t;else msgs.push({role:m.role,content:t});}if(!msgs.length||msgs[0].role!=='user')msgs.unshift({role:'user',content:'(continue)'});const out={model,messages:msgs,max_tokens:data.max_tokens||data.max_completion_tokens||1024};if(sys.length)out.system=sys.join('\n\n');if(typeof data.temperature==='number')out.temperature=Math.max(0,Math.min(1,data.temperature));if(data.stream)out.stream=true;return out;}
function aiNetError(R,c){const host=aiHost(R.url);if(aiIsRelay(c))return'Can’t reach the relay at '+host+'. Is `python relay.py` still running?';if(R.kind==='azure'||/services\.ai\.azure\.com/i.test(R.url))return'Azure doesn’t accept AI calls straight from a web page (CORS). Set it up in .env for the relay instead — Studio → AI model → “Set up with the relay” writes the lines for you.';let a='',b='';try{a=location.hostname;b=new URL(R.url).hostname}catch(_){}if(/^(localhost|127\.0\.0\.1)$/.test(a)&&/^(localhost|127\.0\.0\.1)$/.test(b)&&a!==b)return'The page is on '+a+' but the AI endpoint is on '+b+'. Use the same name in both, e.g. '+location.origin+'/v1.';if(/^(localhost|127\.0\.0\.1)$/.test(b))return'Nothing answered at '+host+'. Start the local model server (Ollama or LM Studio) and enable its API.';return'Couldn’t reach '+host+'. Check the URL and your network. If the provider blocks browser calls (CORS), use the relay.';}
async function aiChat(messages,opts={}){const c=getAI();if(!aiReady())throw new Error('AI not configured');const R=aiResolve(c),relay=aiIsRelay(c);const wantStream=!!opts.onToken&&streamPref();const data={messages,temperature:opts.temp??.5,max_tokens:opts.max??600};
  if(!relay&&R.kind!=='anthropic'&&AI_REASONING.test(c.model||'')){data.max_completion_tokens=Math.max(data.max_tokens,1024);delete data.max_tokens;delete data.temperature;}
  if(R.includeModel&&R.kind!=='anthropic'&&!relay)data.model=c.model;if(wantStream)data.stream=true;let attempt=0,grew=false;const t0=performance.now();
  while(true){attempt++;const body=R.kind==='anthropic'?aiToAnthropic(data,c.model):data;let r;try{r=await fetch(R.url,{method:'POST',headers:R.h,body:JSON.stringify(body)});}catch(e){throw new Error(aiNetError(R,c));}
    if(!r.ok){let raw='';try{raw=await r.text();}catch{}let em=raw;try{const j=JSON.parse(raw);em=j?.error?.message||(typeof j?.error==='string'?j.error:'')||j?.message||raw;}catch{}if(r.status===400&&attempt<7&&aiReconcile(data,em))continue;let msg=(relay?'':'HTTP '+r.status+': ')+String(em||'').slice(0,400);if(!relay){if(r.status===401||r.status===403)msg+=' — check the API key.';if(r.status===404)msg+=' — check the model'+(R.kind==='azure'?' (deployment name)':'')+' and the base URL.';}throw new Error(msg);}
    const done=(text,usage)=>{window.__aiLast={ms:Math.round(performance.now()-t0),usage:usage||null,model:c.model||window.__relayConfig?.ai?.model||'',adapted:r.headers.get('X-Daily-AI-Adapted')||'',at:Date.now()};return text;};
    const type=r.headers.get('content-type')||'';
    if(/text\/event-stream/i.test(type)&&r.body?.getReader)return done(await aiReadSSE(r,opts.onToken));
    const raw=await r.text(),trimmed=raw.trimStart();
    if(/^(event|data)\s*:/i.test(trimmed)||/(?:^|\n)data\s*:/i.test(trimmed)){const text=aiReadBufferedSSE(raw,opts.onToken);if(!text)throw new Error('The endpoint streamed a reply, but it contained no text.');return done(text);}
    let j;try{j=JSON.parse(raw);}catch{throw new Error('The AI endpoint returned something other than JSON: '+raw.replace(/\s+/g,' ').slice(0,180));}
    const text=aiExtractText(j).trim();
    if(!text){const fin=j?.choices?.[0]?.finish_reason||j?.stop_reason;if((fin==='length'||fin==='max_tokens')&&!grew&&!relay){grew=true;const cur=data.max_completion_tokens||data.max_tokens||0;data.max_completion_tokens=Math.max(cur*4,1024);delete data.max_tokens;delete data.temperature;continue;}throw new Error(j?.error?.message||j?.message||(fin==='length'?'The model used its whole token budget before answering (common with reasoning models). Raise the limit.':'No answer text was returned.'));}
    if(opts.onToken)opts.onToken(text);return done(text,j.usage);}}
async function testAILink(){saveAI();if(window.dailyAI&&dailyAI.runDoctor)return dailyAI.runDoctor();const R=aiResolve();setSt('aiStatus','Testing '+esc(aiHost(R.url))+'…','info');try{const r=await aiChat([{role:'user',content:'Reply with exactly one word: connected'}],{max:16,temp:0});setSt('aiStatus','Link OK ✓ “'+esc(r.slice(0,40))+'”','ok');}catch(e){setSt('aiStatus','Failed: '+esc(e.message),'err');}}
function aiActions(){return[['improve','Improve writing'],['shorter','Make shorter'],['longer','Expand'],['bullets','To bullet points'],['fix','Fix grammar'],['explain','Explain simply']];}
let aiSelRange=null;
function showAiBar(){const s=getSelection();if(!s||s.isCollapsed||!s.rangeCount){$('aibar').classList.remove('open');return;}const wr=$('writer');if(!wr.contains(s.anchorNode)){$('aibar').classList.remove('open');return;}aiSelRange=s.getRangeAt(0).cloneRange();const rect=aiSelRange.getBoundingClientRect();const wrRect=wr.getBoundingClientRect();const bar=$('aibar');bar.innerHTML=aiActions().map(([k,lb])=>`<button onmousedown="g(event)" onclick="aiOnSelection('${k}')">${lb}</button>`).join('');bar.style.left=Math.max(6,(rect.left-wrRect.left))+'px';bar.style.top=Math.max(2,(rect.top-wrRect.top-40))+'px';bar.classList.add('open');}
function hideAiBar(){$('aibar').classList.remove('open');}
document.addEventListener('selectionchange',()=>{if(mode==='write'){clearTimeout(window._sb);window._sb=setTimeout(showAiBar,120);}});
function aiMenu(e){if(e&&e.stopPropagation)e.stopPropagation();const hasSel=(getSelection()+'').length>0;const acts=hasSel?aiActions():[['curate','Curate today'],['extract','Find artifacts'],['discover','Discover patterns'],['memory','Builder memory']];openPop($('rSpark'),'ai',`<h4>Ask AI<small>${aiReady()?'Connected · review-first':'Not connected — configure in Studio'}</small></h4>`+acts.map(([k,lb])=>`<button onclick="closePop();${hasSel?`aiOnSelection('${k}')`:`openIntel('${k}')`}">${lb}</button>`).join('')+`<hr><button onclick="closePop();openAskJournal()">Ask your journal…</button><button onclick="closePop();openIntel('curate')">Open AI workspace</button>`);}
function aiMenuAt(){aiMenu({stopPropagation(){}});}
async function aiOnSelection(kind){hideAiBar();if(!aiReady()){toast('Connect an AI provider in Studio first.');openModal('studioModal');return;}const sel=getSelection();const text=(sel&&sel.toString())||'';if(!text.trim()){openIntel('curate');return;}
  const prompts={improve:'Improve clarity and flow. Keep meaning and voice. Return only the revised text.',shorter:'Make more concise. Return only the revised text.',longer:'Expand with a little more detail. Return only the revised text.',bullets:'Rewrite as a tight Markdown bullet list. Return only the list.',fix:'Fix grammar and spelling only. Return only the corrected text.',explain:'Explain simply and briefly. Return only the explanation.'};
  ensureWrite();if(aiSelRange){const s=getSelection();s.removeAllRanges();s.addRange(aiSelRange);}
  /* optimistic placeholder that streams live */
  const holderId='aistream_'+Date.now();let ok=false;try{ok=document.execCommand('insertHTML',false,'<span id="'+holderId+'" style="opacity:.6">…</span>');}catch{}
  const setLive=acc=>{const el=$(holderId);if(el)el.textContent=acc;};
  try{const r=await aiChat([{role:'system',content:'You are a precise writing assistant. '+prompts[kind]},{role:'user',content:text}],{max:700,temp:.4,onToken:setLive});
    const el=$(holderId);if(el){const html=renderMD(r).replace(/^<p>|<\/p>$/g,'');el.outerHTML=html||esc(r);}
    sync();toast('AI applied — undo with ⌘Z');
  }catch(e){const el=$(holderId);if(el)el.outerHTML=esc(text);sync();toast(e.message);if(/CORS|configured/i.test(e.message))openModal('studioModal');}}
function openIntel(kind){openModal('intelModal');$('jiOut').value='';setSt('jiStatus','','');if(kind)jiRun(kind);}
async function jiRun(kind){if(!aiReady()){setSt('jiStatus','Connect an AI provider in Studio first.','info');openModal('studioModal');return;}const t=entryText();if(kind!=='discover'&&kind!=='memory'&&!t.trim()){setSt('jiStatus','Write something first.','err');return;}setSt('jiStatus',{curate:'Curating…',extract:'Finding artifacts…',discover:'Connecting patterns…',memory:'Recalling…'}[kind]+' (streaming)','info');$('jiOut').value='';let sys,usr;if(kind==='curate'){sys='You are a precise journal curator. Reorganize into polished Markdown, preserving voice and every factual boundary. Sections: title, short narrative, "## Highlights", "## Details", "## Takeaways", and a "Tags" line. Never invent. Return only Markdown.';usr=t;}else if(kind==='extract'){sys='Return candidate structured knowledge as Markdown sections: Ideas, Decisions, Learnings, Wins, Tasks, Questions, Blockers. Only sections supported by explicit text. Return only Markdown.';usr=t;}else if(kind==='discover'){const recent=allEntries().slice(-14);sys='You are a pattern analyst. Identify recurring themes, blockers, progress. Distinguish repeated from one-time. Never invent counts. Return Markdown: Recurring signals, Related entries, Patterns, Open loops, Prompts.';usr=recent.map(e=>`[${e.date}] ${e.text}`).join('\n\n---\n\n')||t;}else{const p=currentProject();const rel=allEntries().filter(e=>p?(e.text||'').toLowerCase().includes('#'+p):true).slice(-14);sys='You are builder memory. Surface only genuinely related prior context. Cite entry dates. Never invent. Concise Markdown.';usr='CURRENT:\n'+t+'\n\nPRIOR:\n'+rel.map(e=>`[${e.date}] ${e.text}`).join('\n\n---\n\n');}
  try{await aiChat([{role:'system',content:sys},{role:'user',content:usr.slice(0,28000)}],{max:kind==='curate'?1600:1200,temp:kind==='curate'?.45:.2,onToken:acc=>{$('jiOut').value=acc;$('jiOut').scrollTop=$('jiOut').scrollHeight;}});setSt('jiStatus','Ready for review. Nothing inserted automatically.','ok');}catch(e){setSt('jiStatus','AI error: '+e.message,'err');}}
function jiInsert(){const x=$('jiOut').value.trim();if(!x)return;insertBlock('\n'+x);closeModal('intelModal');toast('Inserted below entry.');}
function jiReplace(){const x=$('jiOut').value.trim();if(!x||!confirm('Replace the current entry?'))return;setEntryText(x);scheduleSave();renderRibbon();closeModal('intelModal');toast('Entry replaced.');}
function jiCopy(){clip($('jiOut').value,'Output');}
/* ============================================================ BROWSE ============================================================ */
const projColor=k=>{let h=0;for(let i=0;i<k.length;i++)h=(h*31+k.charCodeAt(i))%360;return `hsl(${h} 65% 45%)`;};
function entryImages(text){return [...(text||'').matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map(m=>m[1]).filter(s=>s&&s!=='');}
function entryCode(text){const m=(text||'').match(/```([\s\S]*?)```/);return m?m[1].trim():'';}
function currentProjectOf(t){const raw=explicitTags(t).filter(x=>!isReservedTag(x)).map(x=>x.replace(/^project\//,''));if(!raw.length)return'';const f={};raw.forEach(x=>f[x]=(f[x]||0)+1);return Object.entries(f).sort((a,b)=>b[1]-a[1])[0][0];}
/* full Obsidian-style tag set for graph linking (project/* + type/* elements + reserved-ns tags), sans ubiquitous 'journal' */
function graphTags(t){return collectTags(t).filter(x=>x!=='journal');}
function artTypes(t){return [...new Set(candidates(t).map(c=>c.label.split(' ')[1]))];}
function openBrowse(tab){openModal('browseModal');browseTab(tab||'constellation');if((ghReady()||azReady())){let last=0;try{last=+(sessionStorage.getItem('daily:lastPull')||0)}catch{}const stale=Date.now()-last>60000;if(stale||allEntries().length===0){const note=$('browseSyncNote');if(note)note.textContent='Syncing…';pullRepos({silent:true}).then(r=>{try{sessionStorage.setItem('daily:lastPull',String(Date.now()))}catch{}const on=document.querySelector('#browseSeg button.on');browseTab(on?on.dataset.b:'constellation');if(note)note.textContent=(r.added||r.updated)?`Synced ${r.added} new`:(r.seen?`Up to date · ${r.seen} files`:'No files found');}).catch(()=>{});}}}
function browseTab(t){if(t!=='constellation')stopConstel();document.querySelectorAll('#browseSeg button').forEach(b=>b.classList.toggle('on',b.dataset.b===t));const b=$('browseBody');const es=allEntries();if(t==='constellation')renderConstellation(b,es);else if(t==='timeline')renderTimeline(b,es);else if(t==='projects')renderProjects(b,es);else if(t==='artifacts')renderArtifacts(b,es);else if(t==='analysis')renderBrowseAnalysis(b,es);else renderSearch(b,es);}
/* ---- live force-directed constellation (createElementNS — never innerHTML on <svg>) ---- */
let _constel=null;
function stopConstel(){if(_constel){cancelAnimationFrame(_constel.raf);_constel=null;}}
function renderConstellation(b,es){stopConstel();
  if(!es.length){b.innerHTML='<p class="muted">No entries yet. Write today, or Sync from repo.</p>';return;}
  const CAP=140;const capped=es.length>CAP;const use=capped?es.slice(-CAP):es;
  const NSU='http://www.w3.org/2000/svg';const W=880,H=460;
  function mk(t,a){const el=document.createElementNS(NSU,t);if(a)for(const k in a)el.setAttribute(k,a[k]);return el;}
  /* ---- model: project hubs + entry nodes ---- */
  const rnd=(seed=>()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff))(97);
  const rr=(a,c)=>a+rnd()*(c-a);
  const hubMap={};const nodes=[],hubs=[];
  function hubFor(p){if(!p)return null;if(hubMap[p])return hubMap[p];const h={id:'p:'+p,label:'#'+p,proj:p,hub:true,rad:15,x:W/2+rr(-90,90),y:H/2+rr(-70,70),vx:0,vy:0};hubMap[p]=h;hubs.push(h);nodes.push(h);return h;}
  const entries=use.map(e=>{const proj=e.project||currentProjectOf(e.text);const words=(e.text||'').split(/\s+/).filter(Boolean).length;const n={id:'e:'+(e.id||e.date),e,proj,hub:false,rad:5+Math.min(9,Math.round(words/60)),tags:graphTags(e.text),types:artTypes(e.text),x:W/2+rr(-140,140),y:H/2+rr(-120,120),vx:0,vy:0};nodes.push(n);return n;});
  entries.forEach(n=>{if(n.proj){const h=hubFor(n.proj);n.x=h.x+rr(-50,50);n.y=h.y+rr(-50,50);}});
  /* ---- edges: entry→hub (strong), entries sharing a #type (thin, capped) ---- */
  const edges=[];
  entries.forEach(n=>{if(n.proj)edges.push({a:hubMap[n.proj],b:n,strong:true});});
  const byType={};entries.forEach(n=>n.types.forEach(t=>{(byType[t]=byType[t]||[]).push(n);}));
  const seenPair=new Set();
  Object.values(byType).forEach(list=>{for(let i=1;i<list.length;i++){for(let k=1;k<=2&&i-k>=0;k++){const a=list[i],c=list[i-k];const key=a.id<c.id?a.id+'|'+c.id:c.id+'|'+a.id;if(!seenPair.has(key)&&edges.length<500){seenPair.add(key);edges.push({a,b:c,strong:false});}}}});
  const adj={};nodes.forEach(n=>adj[n.id]=new Set([n.id]));edges.forEach(e=>{adj[e.a.id].add(e.b.id);adj[e.b.id].add(e.a.id);});
  /* ---- DOM ---- */
  b.innerHTML=`<div class="bhead"><span class="muted">${es.length} entries${capped?` · showing latest ${CAP}`:''} · a live force layout — edges connect shared #project & #type tags</span></div>`;
  const box=document.createElement('div');box.className='constel';b.appendChild(box);
  const svg=mk('svg',{viewBox:`0 0 ${W} ${H}`,preserveAspectRatio:'xMidYMid meet'});box.appendChild(svg);
  const gEdge=mk('g'),gFlow=mk('g'),gNode=mk('g');svg.appendChild(gEdge);svg.appendChild(gFlow);svg.appendChild(gNode);
  const readout=document.createElement('div');readout.className='cn-readout';box.appendChild(readout);
  const tip=document.createElement('div');tip.className='cn-tip';tip.textContent='hover a node to trace its connections';box.appendChild(tip);
  edges.forEach(e=>{e.line=mk('line',{class:'cn-edge'+(e.strong?' strong':'')});gEdge.appendChild(e.line);if(e.strong){e.flow=mk('line',{class:'cn-flow','stroke-dashoffset':rr(0,16)});gFlow.appendChild(e.flow);}});
  nodes.forEach(n=>{const g=mk('g',{class:'cn-node'+(n.hub?' hub':'')});const col=n.proj?projColor(n.proj):'var(--accent)';n.c=mk('circle',{r:n.hub?n.rad:0.1,fill:n.hub?col:col,'fill-opacity':n.hub?1:0.85});g.appendChild(n.c);if(n.hub){n.t=mk('text',{'text-anchor':'middle'});n.t.textContent=n.label;g.appendChild(n.t);}else{n.t=mk('text',{});n.t.textContent=label(n.e.date);g.appendChild(n.t);}
    g.addEventListener('mouseenter',()=>focusN(n));g.addEventListener('mouseleave',clearN);
    if(!n.hub)g.addEventListener('click',()=>{closeModal('browseModal');openEntry(n.e.date,n.e.id);});
    gNode.appendChild(g);n.g=g;});
  function focusN(n){const near=adj[n.id];nodes.forEach(m=>{const on=near.has(m.id);m.c.setAttribute('opacity',on?1:0.12);if(m.t)m.t.setAttribute('opacity',on?1:0.12);});edges.forEach(e=>{const on=e.a.id===n.id||e.b.id===n.id;e.line.setAttribute('stroke-opacity',on?0.95:0.05);e.line.setAttribute('stroke',on?'var(--accent)':'');e.line.setAttribute('stroke-width',on?(e.strong?2.2:1.6):1);if(e.flow)e.flow.setAttribute('opacity',on?1:0.04);});tip.textContent=(n.hub?n.label:label(n.e.date))+' · '+(near.size-1)+' connections';}
  function clearN(){nodes.forEach(m=>{m.c.setAttribute('opacity',1);if(m.t)m.t.setAttribute('opacity',1);});edges.forEach(e=>{e.line.setAttribute('stroke-opacity',e.strong?0.55:'');e.line.setAttribute('stroke',e.strong?'var(--accent)':'');e.line.setAttribute('stroke-width',e.strong?1:1);if(e.flow)e.flow.setAttribute('opacity',0.85);});tip.textContent='hover a node to trace its connections';}
  /* ---- stats ---- */
  const stats=document.createElement('div');stats.className='cn-stats';const Nn=nodes.length,Ee=edges.length,Pp=hubs.length,dens=Nn>1?(2*Ee)/(Nn*(Nn-1)):0;
  stats.innerHTML=`<span><b>${Nn}</b> nodes</span><span><b>${Ee}</b> edges</span><span><b>${Pp}</b> projects</span><span><b>${dens.toFixed(2)}</b> density</span><span class="f">density = 2E / N(N−1)</span>`;box.appendChild(stats);
  readout.innerHTML=`edges = Σ shared tags · <b>${Ee}</b>`;
  const legend=document.createElement('div');legend.className='cn-legend';legend.innerHTML=`<span><i style="background:var(--accent)"></i> project hub</span><span><i style="background:#7db0f5"></i> entry node</span><span><i style="background:var(--accent);width:16px;height:3px;border-radius:2px"></i> project edge</span><span><i style="background:var(--line);width:16px;height:3px;border-radius:2px"></i> shared-type edge</span><span class="f" style="margin-left:auto;color:var(--faint)">drag not required · hover to explore · click a day to open</span>`;box.appendChild(legend);
  /* ---- force simulation ---- */
  const state={nodes,edges,hubs,W,H,raf:0,t0:0};_constel=state;
  function tick(alpha){
    for(let i=0;i<nodes.length;i++){const A=nodes[i];for(let j=i+1;j<nodes.length;j++){const B=nodes[j];let dx=A.x-B.x,dy=A.y-B.y,d2=dx*dx+dy*dy+0.01,d=Math.sqrt(d2);const rep=(A.hub||B.hub?5200:3400)/d2;const fx=dx/d*rep,fy=dy/d*rep;A.vx+=fx;A.vy+=fy;B.vx-=fx;B.vy-=fy;}}
    edges.forEach(e=>{const L=e.strong?82:150,k=e.strong?0.035:0.01;let dx=e.b.x-e.a.x,dy=e.b.y-e.a.y,d=Math.sqrt(dx*dx+dy*dy)+0.01,f=(d-L)*k,fx=dx/d*f,fy=dy/d*f;e.a.vx+=fx;e.a.vy+=fy;e.b.vx-=fx;e.b.vy-=fy;});
    nodes.forEach(n=>{n.vx+=(W/2-n.x)*(n.hub?0.004:0.0016);n.vy+=(H/2-n.y)*(n.hub?0.004:0.0016);n.vx*=0.86;n.vy*=0.86;n.x+=n.vx*alpha*0.9;n.y+=n.vy*alpha*0.9;n.x=Math.max(26,Math.min(W-26,n.x));n.y=Math.max(24,Math.min(H-24,n.y));});
  }
  function draw(ts){edges.forEach(e=>{e.line.setAttribute('x1',e.a.x.toFixed(1));e.line.setAttribute('y1',e.a.y.toFixed(1));e.line.setAttribute('x2',e.b.x.toFixed(1));e.line.setAttribute('y2',e.b.y.toFixed(1));if(e.flow){e.flow.setAttribute('x1',e.a.x.toFixed(1));e.flow.setAttribute('y1',e.a.y.toFixed(1));e.flow.setAttribute('x2',e.b.x.toFixed(1));e.flow.setAttribute('y2',e.b.y.toFixed(1));e.flow.setAttribute('stroke-dashoffset',(-(ts*0.05)%16).toFixed(1));}});
    nodes.forEach(n=>{n.c.setAttribute('cx',n.x.toFixed(1));n.c.setAttribute('cy',n.y.toFixed(1));if(!n.hub){const cur=parseFloat(n.c.getAttribute('r'))||0;if(cur<n.rad)n.c.setAttribute('r',Math.min(n.rad,cur+0.6).toFixed(2));}
      if(n.t){if(n.hub){n.t.setAttribute('x',n.x.toFixed(1));n.t.setAttribute('y',(n.y-n.rad-8).toFixed(1));}else{n.t.setAttribute('x',(n.x+n.rad+3).toFixed(1));n.t.setAttribute('y',(n.y+3).toFixed(1));}}});}
  function loop(ts){if(_constel!==state)return;if(!state.t0)state.t0=ts;const t=ts-state.t0;const alpha=Math.max(0.04,1-t/4200);tick(alpha);draw(t);state.raf=requestAnimationFrame(loop);}
  state.raf=requestAnimationFrame(loop);}
function renderTimeline(b,es){if(!es.length){b.innerHTML='<p class="muted">No entries yet.</p>';return;}const max=Math.max(...es.map(e=>(e.text||'').split(/\s+/).length),1);let lastMo='';const cols=es.map(e=>{const w=(e.text||'').split(/\s+/).length;const h=Math.max(6,Math.round(w/max*80));const d=new Date(e.date+'T12:00');const mo=d.toLocaleDateString(undefined,{month:'short'});const showMo=mo!==lastMo;lastMo=mo;return `<div class="tl-col" onclick="closeModal('browseModal');openEntry('${e.date}','${e.id||''}')" title="${e.date} · ${w}w">${showMo?`<span class="tl-mo">${mo}</span>`:''}<div class="tl-bar" style="height:${h}px"></div><div class="tl-node"></div><div class="tl-lbl">${d.getDate()}</div></div>`;}).join('');b.innerHTML=`<div class="bhead"><span class="muted">${es.length} entries · oldest → newest · bar height = length</span></div><div class="tl"><div class="tl-track"><div class="tl-axis"></div>${cols}</div></div>`;}
function renderProjects(b,es){const map={};es.forEach(e=>{projectSlugs(e.text).forEach(k=>{(map[k]=map[k]||[]).push(e)})});const keys=Object.keys(map);if(!keys.length){b.innerHTML='<p class="muted">Add a <code>#project/&lt;name&gt;</code> (or plain <code>#name</code>) tag to your entries to form project clusters.</p>';return;}const max=Math.max(...keys.map(k=>map[k].length),1);const bubbles=keys.sort((a,b2)=>map[b2].length-map[a].length).map(k=>{const n=map[k].length;const size=54+Math.round(n/max*90);const cs=map[k].flatMap(e=>candidates(e.text));return `<div class="cluster" style="width:${size}px;height:${size}px;background:${projColor(k)}" onclick="browseSearchFor('#${k}')" title="${n} entries · ${cs.length} artifacts"><b>#${esc(k)}</b><span>${n} ${n===1?'entry':'entries'}</span></div>`;}).join('');b.innerHTML=`<div class="bhead"><span class="muted">${keys.length} projects · bubble size = entries · click to search</span></div><div class="clusters">${bubbles}</div>`;}
function renderArtifacts(b,es){const cards=[];es.slice().reverse().forEach(e=>{entryImages(e.text).forEach(src=>cards.push({type:'image',src,date:e.date,t:'Image'}));const code=entryCode(e.text);if(code)cards.push({type:'code',code,date:e.date,t:'Code'});candidates(e.text).forEach(c=>cards.push({type:'note',label:c.label,text:c.text,date:e.date,t:c.label}));});if(!cards.length){b.innerHTML='<p class="muted">Artifacts appear as you add images, code blocks, decisions, learnings, and wins.</p>';return;}const html=cards.slice(0,60).map(c=>{let thumb='';if(c.type==='image')thumb=`<div class="thumb"><img src="${c.src}" alt=""></div>`;else if(c.type==='code')thumb=`<div class="thumb"><pre>${esc(c.code.slice(0,240))}</pre></div>`;else thumb=`<div class="thumb" style="font-size:22px">${(c.label||'▣').split(' ')[0]}</div>`;const sub=c.type==='note'?esc((c.text||'').slice(0,70)):'';return `<div class="card" onclick="closeModal('browseModal');openDay('${c.date}')">${thumb}<div class="meta"><div class="t">${esc(c.t)}</div><div class="d">${c.date}</div>${sub?`<div class="muted" style="margin-top:4px">${sub}</div>`:''}</div></div>`;}).join('');b.innerHTML=`<div class="bhead"><span class="muted">${cards.length} artifacts · images & code first, then decisions/learnings/wins</span></div><div class="gal">${html}</div>`;}
function browseSearchFor(q){browseTab('search');const inp=$('brQ');if(inp){inp.value=q;inp.dispatchEvent(new Event('input'));}}
function renderSearch(b,es){b.innerHTML='<input class="f" id="brQ" placeholder="Search everything — text, #project, dates, ◆ decisions, ▣ learnings, source…"><div id="brRes" style="margin-top:12px"></div>';const run=()=>{const q=$('brQ').value.trim().toLowerCase();const res=$('brRes');if(!q){res.innerHTML='<p class="muted">Type to search across your whole journal.</p>';return;}const terms=q.split(/\s+/).filter(Boolean);const scored=es.map(e=>{const hay=[e.date,e.project||'',e.source||'',e.text||'',...candidates(e.text).map(c=>c.label)].join(' ').toLowerCase();let score=0;terms.forEach(tm=>{if(hay.includes(tm))score+=(e.text||'').toLowerCase().split(tm).length-1||1;});return{e,score};}).filter(x=>x.score>0).sort((a,b2)=>b2.score-a.score||(b2.e.date).localeCompare(a.e.date));if(!scored.length){res.innerHTML='<p class="muted">No matches.</p>';return;}res.innerHTML=scored.slice(0,50).map(({e})=>{const arts=candidates(e.text).map(c=>c.label.split(' ')[0]).slice(0,4).join(' ');let snip=(e.text||'').replace(/\n+/g,' ');const idx=snip.toLowerCase().indexOf(terms[0]);if(idx>40)snip='…'+snip.slice(idx-30);snip=snip.slice(0,150);terms.forEach(tm=>{snip=snip.replace(new RegExp('('+tm.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','ig'),'<mark>$1</mark>');});return `<div class="hit" onclick="closeModal('browseModal');openEntry('${e.date}','${e.id||''}')"><div class="hit-t">${e.date}${e.project?` <span class="badge">#${esc(e.project)}</span>`:''} ${arts?`<span class="muted" style="font-size:11px">${arts}</span>`:''}</div><div class="hit-s">${snip}</div></div>`;}).join('');};$('brQ').addEventListener('input',run);run();}
/* ============================================================ events / init ============================================================ */
function openModal(id){$(id).classList.add('open');if(id==='repoModal')fillRepo();if(id==='studioModal'){applyS();fillAI();renderQuota();}}
function closeModal(id){if(id==='browseModal')stopConstel();$(id).classList.remove('open');}
/* ============================================================ ABOUT (marketing page in an isolated iframe)
   The hero graph's PRIMARY (hub) nodes are driven by your real
   projects: we compute your top #project tags from actual entries
   and inject window.__DAILY_GRAPH__ into the page before it renders.
   If you have no projects yet, it shows the page's built-in defaults.
   ============================================================ */
const ABOUT_DOC_B64="__ABOUT_DOC_B64__";
let _aboutURL=null;
function aboutDecoded(){try{return decodeURIComponent(escape(atob(ABOUT_DOC_B64)));}catch(e){try{return atob(ABOUT_DOC_B64);}catch(_){return '<!doctype html><meta charset=utf-8><body style="font-family:system-ui;padding:40px">About page failed to load.';}}}
/* rank real projects by how many entries reference them */
function aboutRealGraph(){try{const freq={};const es=allEntries();es.forEach(e=>{const ps=[];if(e.project)ps.push(e.project);projectSlugs(e.text||'').forEach(p=>ps.push(p));[...new Set(ps)].forEach(p=>{if(p)freq[p]=(freq[p]||0)+1;});});const top=Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,6).map(x=>x[0]);return top.length?{projects:top,entries:es.length}:null;}catch(e){return null;}}
function aboutHTML(){let doc=aboutDecoded();const cfg=aboutRealGraph();if(cfg){const inject='<script>window.__DAILY_GRAPH__='+JSON.stringify(cfg).replace(/</g,'\\u003c')+';<\/script>';doc=/<head\b[^>]*>/i.test(doc)?doc.replace(/<head\b[^>]*>/i,m=>m+inject):inject+doc;}return{doc,cfg};}
function aboutFreshURL(){if(_aboutURL){try{URL.revokeObjectURL(_aboutURL);}catch{}_aboutURL=null;}const{doc,cfg}=aboutHTML();_aboutURL=URL.createObjectURL(new Blob([doc],{type:'text/html'}));return{url:_aboutURL,cfg};}
function openAbout(){const{url,cfg}=aboutFreshURL();$('aboutFrame').src=url;const src=$('aboutSrc');if(src)src.textContent=cfg?('hubs: '+cfg.projects.map(p=>'#'+p).join(' ')):'hubs: demo defaults (no projects yet)';$('aboutBack').classList.add('open');document.documentElement.style.overflow='hidden';}
function closeAbout(){$('aboutBack').classList.remove('open');document.documentElement.style.overflow='';}
function openAboutTab(){const{url}=aboutFreshURL();const w=window.open(url,'_blank','noopener');if(!w)toast('Pop-up blocked — allow pop-ups to open About in a new tab.');}
function clearAll(){if(confirm('Clear ALL local journal data? Export a backup first if unsure. This cannot be undone.')){store.keys().filter(k=>k.indexOf('daily:')===0).forEach(k=>store.rm(k));location.reload();}}
function wireEditor(){const entry=$('entry');
  entry.addEventListener('input',()=>{if(mode==='write')mdBuffer=htmlToMD(entry);scheduleSave();renderRibbon();pushHistory();maybeSlash();});
  entry.addEventListener('blur',()=>{setTimeout(hideAiBar,150);flush();});
  entry.addEventListener('paste',e=>{const items=(e.clipboardData&&e.clipboardData.items)||[];for(const it of items){if(it.type&&it.type.indexOf('image')===0){const f=it.getAsFile();if(f){e.preventDefault();readImage(f);return;}}}});
  ['dragover','dragenter'].forEach(ev=>$('writer').addEventListener(ev,e=>{e.preventDefault();$('writer').classList.add('drag');}));
  ['dragleave','drop'].forEach(ev=>$('writer').addEventListener(ev,e=>{e.preventDefault();$('writer').classList.remove('drag');}));
  $('writer').addEventListener('drop',e=>{const f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];if(f&&/^image\//.test(f.type)){ensureWrite();readImage(f);}});
  $('source').addEventListener('input',()=>{mdBuffer=$('source').value;scheduleSave();renderRibbon();});
  $('imgInput').addEventListener('change',e=>{const f=e.target.files&&e.target.files[0];if(f)readImage(f);e.target.value='';});
  $('importInput').addEventListener('change',e=>{const f=e.target.files&&e.target.files[0];if(f)handleImport(f);e.target.value='';});
  $('cmdkInput').addEventListener('input',()=>{cmdkSel=0;renderCmdk();});
  $('cmdkInput').addEventListener('keydown',e=>{const items=cmdkFiltered();if(e.key==='ArrowDown'){e.preventDefault();cmdkSel=(cmdkSel+1)%Math.max(1,items.length);renderCmdk();}else if(e.key==='ArrowUp'){e.preventDefault();cmdkSel=(cmdkSel-1+items.length)%Math.max(1,items.length);renderCmdk();}else if(e.key==='Enter'){e.preventDefault();cmdkRun(cmdkSel);}else if(e.key==='Escape'){e.preventDefault();closeCmdk();}else if(e.key==='Tab'){e.preventDefault();const idx=CATS.findIndex(c=>c[0]===cmdkCat);setCmdkCat(CATS[(idx+(e.shiftKey?-1:1)+CATS.length)%CATS.length][0]);}});
  let lpTimer=null,lpX=0,lpY=0;const lpClear=()=>{clearTimeout(lpTimer);lpTimer=null;};
  $('writer').addEventListener('touchstart',e=>{if(e.touches.length!==1)return;lpX=e.touches[0].clientX;lpY=e.touches[0].clientY;lpTimer=setTimeout(()=>{if((window.getSelection()+'').length)return;if(navigator.vibrate)navigator.vibrate(8);openCmdk('');},520);},{passive:true});
  $('writer').addEventListener('touchmove',e=>{if(!lpTimer)return;const t=e.touches[0];if(Math.abs(t.clientX-lpX)>10||Math.abs(t.clientY-lpY)>10)lpClear();},{passive:true});
  $('writer').addEventListener('touchend',lpClear,{passive:true});$('writer').addEventListener('touchcancel',lpClear,{passive:true});
}
document.addEventListener('keydown',e=>{const mod=e.metaKey||e.ctrlKey;
  if(mod&&e.key.toLowerCase()==='k'){e.preventDefault();openCmdk('');}
  if(mod&&e.key.toLowerCase()==='s'){e.preventDefault();quickSave();}
  if(mod&&!e.shiftKey&&e.key.toLowerCase()==='z'){e.preventDefault();doUndo();}
  if(mod&&e.shiftKey&&e.key.toLowerCase()==='z'){e.preventDefault();doRedo();}
  if(mod&&e.key.toLowerCase()==='b'){e.preventDefault();fmt('bold');}
  if(mod&&e.key.toLowerCase()==='i'){e.preventDefault();fmt('italic');}
  if(mod&&e.key.toLowerCase()==='u'){e.preventDefault();fmt('underline');}
  if(e.key==='Escape'){document.querySelectorAll('.mback.open').forEach(m=>m.classList.remove('open'));closeCmdk();closePop();hideAiBar();if($('aboutBack')&&$('aboutBack').classList.contains('open'))closeAbout();}
  if(e.shiftKey&&!mod&&e.key==='ArrowLeft'&&document.activeElement!==$('entry')){e.preventDefault();openDay(shift(curDate,-1));}
  if(e.shiftKey&&!mod&&e.key==='ArrowRight'&&document.activeElement!==$('entry')){e.preventDefault();openDay(shift(curDate,1));}});
function boot(){applyS();syncPromptForCurrentDay();
  const e=loadEntry(curDate);setEntryText(e?e.text:'');updateDateUI();fillRepo();fillAI();setMode('write');renderRibbon();setStatus('saved');wireEditor();
  $('nameField')&&$('nameField').addEventListener('input',ev=>{const s=getS();s.name=ev.target.value.slice(0,40);saveS(s);});
  $('dPrev').onclick=()=>openDay(shift(curDate,-1));$('dNext').onclick=()=>openDay(shift(curDate,1));
  $('dCur').onclick=()=>{const x=$('dateInput');if(x.showPicker)x.showPicker();else x.click();};
  $('dateInput').onchange=ev=>ev.target.value&&openDay(ev.target.value);
  matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>{if(getS().theme==='auto')applyS();});
  window.addEventListener('beforeunload',flush);
  if(ghReady()||azReady()){setTimeout(()=>pullRepos({silent:true}).then(r=>{try{sessionStorage.setItem('daily:lastPull',String(Date.now()))}catch{}if(r&&(r.added||r.updated)){const cur=loadEntry(curDate);if(cur&&document.activeElement!==$('entry')){setEntryText(cur.text);renderRibbon();}toast('Synced '+r.added+' entries from your repository.');}}).catch(()=>{}),400);}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
