(function(){'use strict';
var $=function(x){return document.getElementById(x)};
function h(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function cfg(){return window.__relayConfig||null}
function relayAI(){var c=cfg();return c&&c.ai?c.ai:null}

/* ================================================================= retrieval */
var STOP=new Set('the a an and or of to in on for with at by from is are was were be been being it its this that these those i me my mine we our you your what which who whom how when where why do did does done have has had not no can could would should will shall may might about into over after before than then so as if just also very more most some any all there their they them he she his her up out off again once here only own same such too s t don now get got make made use used using want like one two'.split(' '));
function stem(w){return w.length>4?w.replace(/(ies|ing|ed|es|s)$/,''):w}
function toks(s){return (String(s||'').toLowerCase().match(/[a-z0-9][a-z0-9_\-]+/g)||[]).filter(function(w){return w.length>1&&!STOP.has(w)}).map(stem)}
function entries(){try{return (typeof allEntries==='function'?allEntries():[]).filter(function(e){return String(e.text||'').trim()})}catch(_){return[]}}
function titleOf(e){if(e.title)return e.title;var m=String(e.text||'').match(/^#{1,3}\s+(.+)$/m);return m?m[1].trim():(String(e.text||'').trim().split('\n')[0]||'Untitled').slice(0,80)}
function chunksOf(e){var paras=String(e.text||'').replace(/!\[[^\]]*\]\([^)]*\)/g,'[image]').split(/\n{2,}/),out=[],cur='';paras.forEach(function(p){if((cur+'\n\n'+p).length>1100&&cur){out.push(cur);cur=p}else cur=cur?cur+'\n\n'+p:p});if(cur)out.push(cur);return out.map(function(t){return {date:e.date,id:e.id,title:titleOf(e),text:t}})}
function daysAgo(d){var t=Date.parse(d);return isNaN(t)?9999:(Date.now()-t)/864e5}
function retrieve(query,k){
  k=k||6;var es=entries();if(!es.length)return[];
  var q=String(query||'').toLowerCase(),win=null;
  if(/\b(today)\b/.test(q))win=1;else if(/\b(this|last|past)\s+week\b|\b7 days\b|\brecent(ly)?\b|\blately\b/.test(q))win=7.5;else if(/\b(this|last|past)\s+month\b|\b30 days\b/.test(q))win=31;
  var chunks=[];es.forEach(function(e){chunksOf(e).forEach(function(c){chunks.push(c)})});
  var docs=chunks.map(function(c){return toks(c.title+' '+c.text)}),N=docs.length,avg=docs.reduce(function(n,d){return n+d.length},0)/Math.max(1,N),df={};
  docs.forEach(function(d){new Set(d).forEach(function(w){df[w]=(df[w]||0)+1})});
  var qt=Array.from(new Set(toks(query)));
  var scored=chunks.map(function(c,i){var d=docs[i],tf={};d.forEach(function(w){tf[w]=(tf[w]||0)+1});var s=0;qt.forEach(function(w){if(!tf[w])return;var idf=Math.log(1+(N-df[w]+.5)/(df[w]+.5));s+=idf*(tf[w]*2.2)/(tf[w]+1.2*(.25+.75*d.length/avg))});var age=daysAgo(c.date);if(win&&age<=win)s+=3;s*=1+.12*Math.max(0,1-age/365);return {c:c,s:s}});
  scored.sort(function(a,b){return b.s-a.s});
  var pick=[],per={};
  scored.forEach(function(x){if(pick.length>=k||x.s<=0)return;var key=x.c.id||x.c.date;if((per[key]||0)>=2)return;per[key]=(per[key]||0)+1;pick.push(x.c)});
  if(!pick.length)pick=es.slice().sort(function(a,b){return String(b.date).localeCompare(String(a.date))}).slice(0,4).map(function(e){return chunksOf(e)[0]});
  return pick.sort(function(a,b){return String(a.date).localeCompare(String(b.date))});
}
function contextBlock(hits){var out='Journal excerpts (oldest first):\n',left=14000;hits.forEach(function(c){var t='\n['+c.date+'] '+c.title+'\n'+c.text.slice(0,Math.min(2200,left))+'\n';if(left>200){out+=t;left-=t.length}});return out}

/* ================================================================= answer rendering */
function inline(s,src){
  s=h(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g,'$1<i>$2</i>');
  return s.replace(/\[(\d{4}-\d{2}-\d{2})((?:\s*[,;]\s*\d{4}-\d{2}-\d{2})*)\]/g,function(_,a,rest){var ds=[a].concat((rest.match(/\d{4}-\d{2}-\d{2}/g)||[]));return ds.map(function(d){var m=(src||[]).find(function(x){return x.date===d});return '<a href="#" class="ai-cite" data-cite="'+d+'" data-id="'+h(m?m.id:'')+'" title="Open '+d+(m?' · '+h(m.title):'')+'">'+d+'</a>'}).join('')});
}
function renderAnswer(md,src){
  var lines=String(md||'').replace(/\r/g,'').split('\n'),html='',list=null,code=null,para=[];
  function flush(){if(para.length){html+='<p>'+inline(para.join(' '),src)+'</p>';para=[]}}
  function close(){if(list){html+='</'+list+'>';list=null}}
  lines.forEach(function(l){
    if(code!==null){if(/^```/.test(l)){html+='<pre><code>'+h(code)+'</code></pre>';code=null}else code+=(code?'\n':'')+l;return}
    if(/^```/.test(l)){flush();close();code='';return}
    var m;
    if((m=l.match(/^\s*[-*•]\s+(.*)/))){flush();if(list!=='ul'){close();html+='<ul>';list='ul'}html+='<li>'+inline(m[1],src)+'</li>';return}
    if((m=l.match(/^\s*\d+[.)]\s+(.*)/))){flush();if(list!=='ol'){close();html+='<ol>';list='ol'}html+='<li>'+inline(m[1],src)+'</li>';return}
    if((m=l.match(/^#{1,4}\s+(.*)/))){flush();close();html+='<h4>'+inline(m[1],src)+'</h4>';return}
    if(!l.trim()){flush();close();return}
    close();para.push(l.trim());
  });
  if(code!==null)html+='<pre><code>'+h(code)+'</code></pre>';flush();close();
  if(src&&src.length){var seen={};html+='<div class="ai-src"><span>Sources</span>'+src.filter(function(x){var k=x.id||x.date;if(seen[k])return false;return seen[k]=true}).map(function(x){return '<a href="#" data-cite="'+h(x.date)+'" data-id="'+h(x.id||'')+'" title="'+h(x.title)+'">'+h(x.date)+' · '+h(x.title)+'</a>'}).join('')+'</div>'}
  return html;
}
function openEntryAt(date,id){try{if(typeof openEntry==='function')openEntry(date,id||undefined)}catch(_){}}
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('.ws-ai-log [data-cite]');if(a){e.preventDefault();openEntryAt(a.dataset.cite,a.dataset.id)}});

/* ================================================================= Studio: connection, diagnostics, setup */
var ENVMAP={openai:'openai',azure:'azure',anthropic:'anthropic',gemini:'gemini',openrouter:'openrouter',groq:'groq',mistral:'mistral',deepseek:'deepseek',xai:'xai',together:'custom',ollama:'ollama',lmstudio:'lmstudio',compatible:'custom'};
function provFromRelay(a){if(!a)return'azure';if(a.kind==='anthropic'&&/azure\.com$/.test(a.host||''))return'foundryclaude';return ENVMAP[a.provider]||'custom'}
function label(p){return (PROV[p]||{}).label||p}
function renderState(){
  var el=$('aiState');if(!el)return;var c=getAI(),ra=relayAI(),r=cfg(),dot='',text='',sub='';
  if(r&&ra&&ra.configured&&aiIsRelay(c)){dot='ok';text='Connected through the relay — '+ra.label+' · '+ra.model;sub=(ra.auth==='entra'?'Microsoft Entra ID':'key in .env')+' · '+ra.host+(ra.reasoning?' · reasoning model':'')}
  else if(aiReady()){dot=r?'warn':'ok';text=(r?'Using settings stored in this browser':'Connected from this browser')+' — '+label(aiProvKey(c))+' · '+(c.model||'');sub=aiHost(aiResolve(c).url)+(r&&ra&&!ra.configured?' · the relay has no AI set up in .env':'')}
  else{text='Not connected';sub=r?'Set it up with the relay below — the recommended way.':'Choose a provider under “Browser connection”.'}
  var L=window.__aiLast,last=L&&L.ms?'<div class="ai-last">Last answer · '+(L.ms/1000).toFixed(1)+' s'+(L.usage&&L.usage.total_tokens?' · '+L.usage.total_tokens+' tokens':'')+(L.model?' · '+h(L.model):'')+(L.adapted?' · adjusted: '+h(L.adapted):'')+'</div>':'';
  el.innerHTML='<i class="'+dot+'"></i><div>'+h(text)+'<small>'+h(sub)+'</small>'+last+'</div>';
}
function step(s){return '<div class="ai-step '+(s.ok===null?'run':s.ok?'ok':'fail')+'"><span class="ic">'+(s.ok===null?'…':s.ok?'✓':'✕')+'</span><b>'+h(s.label)+'</b><span class="dt">'+h(s.detail||'')+'</span>'+(s.fix?'<div class="fx">'+h(s.fix)+'</div>':'')+'</div>'}
async function runDoctor(){
  var out=$('aiDoctor');if(!out)return;var c=getAI(),r=cfg();
  out.innerHTML=step({label:'Checking',ok:null,detail:'Running connection checks…'});
  setSt('aiStatus','','');
  if(r&&(aiIsRelay(c)||!aiReady())){
    try{var res=await fetch('/api/ai/doctor',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});var j=await res.json();
      if(!res.ok)throw new Error((j.error&&j.error.message)||('HTTP '+res.status));
      out.innerHTML=j.steps.map(step).join('');if(j.ok)window.__aiLast={ms:j.latencyMs,usage:j.usage,model:j.ai&&j.ai.model,adapted:'',at:Date.now()};
      if(!j.ai.configured&&!aiReady())out.innerHTML+=step({label:'Next',ok:false,detail:'',fix:'Fill in “Set up with the relay” below, paste the lines into .env, restart the relay, and run diagnostics again.'});}
    catch(e){out.innerHTML=step({label:'Relay',ok:false,detail:location.origin,fix:'The relay didn’t answer: '+e.message+'. Is python relay.py running?'})}
    renderState();return;
  }
  var p=aiProvKey(c),d=PROV[p]||{},R=aiResolve(c),steps=[];
  var missing=[];if(!c.base)missing.push('Base URL');if(!c.model)missing.push('Model');
  steps.push({label:'Configuration',ok:!missing.length,detail:label(p)+' · '+(c.model||'no model'),fix:missing.length?'Add: '+missing.join(', ')+', then Save.':''});
  if(missing.length){out.innerHTML=steps.map(step).join('');return}
  if(d.relayOnly||R.kind==='azure'){steps.push({label:'Browser access',ok:false,detail:aiHost(R.url),fix:label(p)+' doesn’t accept calls straight from a web page. '+(r?'Use “Set up with the relay” below — it writes the .env lines from these settings.':'Run the relay (python relay.py) and set this provider up in .env.')});out.innerHTML=steps.map(step).join('');prefillSetupFromBrowser();return}
  steps.push({label:'Endpoint',ok:true,detail:R.url.replace(/\?.*$/,'')});
  out.innerHTML=steps.map(step).join('')+step({label:'Test request',ok:null,detail:'Sending a one-word test…'});
  var t0=performance.now();
  try{var reply=await aiChat([{role:'user',content:'Reply with exactly one word: connected'}],{max:16,temp:0});var ms=Math.round(performance.now()-t0);steps.push({label:'Test request',ok:true,detail:ms+' ms · replied “'+reply.slice(0,40)+'”'})}
  catch(e){steps.push({label:'Test request',ok:false,detail:aiHost(R.url),fix:e.message})}
  out.innerHTML=steps.map(step).join('');renderState();
}
async function listModels(){
  var box=$('aiModels');if(!box)return;var c=getAI(),r=cfg();box.innerHTML='<p class="note">Loading models…</p>';
  var ids=[],note='',cur='';
  try{
    if(r&&(aiIsRelay(c)||!aiReady())){var j=await (await fetch('/api/ai/models')).json();ids=j.models||[];note=j.note||'';cur=j.current||''}
    else{var R=aiResolve(c),u;if(R.kind==='anthropic')u=R.url.replace(/\/messages$/,'/models');else u=R.url.replace(/\/chat\/completions(\?.*)?$/,'/models');var hd=Object.assign({},R.h);delete hd['Content-Type'];var res=await fetch(u,{headers:hd});if(!res.ok)throw new Error('HTTP '+res.status);var jj=await res.json();ids=(jj.data||jj.models||[]).map(function(m){return m.id||m.name}).filter(Boolean).sort();cur=c.model}
  }catch(e){note='Couldn’t list models: '+e.message}
  box.innerHTML=(note?'<p class="note">'+h(note)+'</p>':'')+(ids.length?'<div class="chips">'+ids.slice(0,300).map(function(m){return '<button type="button" data-model="'+h(m)+'" class="'+(m===cur?'cur':'')+'">'+h(m)+'</button>'}).join('')+'</div>':(note?'':'<p class="note">The provider returned no models.</p>'));
  box.querySelectorAll('[data-model]').forEach(function(b){b.onclick=function(){var m=b.dataset.model;if($('evModel')&&$('aiSetup')&&!$('aiSetup').hidden){$('evModel').value=m;renderEnv()}if($('aiModel')&&!aiIsRelay(getAI())){$('aiModel').value=m}toast('Model: '+m+(r?' — copy the updated .env lines':' — Save to keep it'))}});
}
/* .env assistant */
function normBase(p,v,model){
  v=String(v||'').trim().replace(/\/+$/,'');var d=PROV[p]||{};
  if(p==='azure'){
    if(/^[a-z0-9][a-z0-9-]{1,62}$/i.test(v))return {base:'https://'+v.toLowerCase()+'.openai.azure.com/openai/v1'};
    var m=v.match(/^(https?:\/\/[^/]+)(\/.*)?$/i);if(!m)return {base:v};var root=m[1],path=(m[2]||'');
    var dep=(path.match(/\/openai\/deployments\/([^/?]+)/)||[])[1];
    if(/\/anthropic/.test(path))return {base:v};
    if(/\/models(\/|$)/.test(path))return {base:root+'/models'};
    return {base:root+'/openai/v1',model:dep?decodeURIComponent(dep):''};
  }
  if(p==='foundryclaude'){
    if(/^[a-z0-9][a-z0-9-]{1,62}$/i.test(v))return {base:'https://'+v.toLowerCase()+'.services.ai.azure.com/anthropic'};
    return {base:v.replace(/\/v1(\/messages)?$/,'')};
  }
  return {base:v||d.base||''};
}
function envLines(){
  var p=$('evProv').value,d=PROV[p]||{},nb=normBase(p,$('evBase').value),model=$('evModel').value.trim()||nb.model||'',auth=($('evAuth')&&$('evAuth').querySelector('.on'))?$('evAuth').querySelector('.on').dataset.v:'key';
  if(nb.model&&!$('evModel').value.trim())$('evModel').value=nb.model;
  var env=d.env||'compatible',L=['# AI — paste into .env (next to relay.py), then restart the relay','DAILY_AI_PROVIDER='+env];
  var base=nb.base;if(base&&(base!==d.base||env==='compatible'||d.relayOnly))L.push('DAILY_AI_BASE_URL='+base);else if(!base&&(env==='compatible'||d.relayOnly))L.push('DAILY_AI_BASE_URL=<endpoint URL>');
  L.push('DAILY_AI_MODEL='+(model||(d.kind==='azure'||p==='foundryclaude'?'<your deployment name>':'<model id>')));
  if(d.entra&&auth==='entra'){L.push('DAILY_AI_AUTH=entra');L.push('# keyless: sign in once with  az login  (role: Cognitive Services OpenAI User or Foundry User)')}
  else if(d.key!==false)L.push('DAILY_AI_API_KEY=<paste your key here>');
  if(/^(o\d|gpt-5)/i.test(model)===false&&d.kind!=='anthropic'&&/reason|think|r1/i.test(model))L.push('DAILY_AI_REASONING=on');
  return L;
}
function renderEnv(){var out=$('evOut');if(!out)return;var L=envLines();out.innerHTML=L.map(function(l){return l.charAt(0)==='#'?'<span class="c">'+h(l)+'</span>':h(l)}).join('\n');var p=$('evProv').value,d=PROV[p]||{};var a=$('evAuthRow');if(a)a.hidden=!d.entra;var bh=$('evBaseHint');if(bh)bh.textContent=d.kind==='azure'?'Paste the endpoint or Target URI from Foundry, or just the resource name.':p==='foundryclaude'?'The resource name, or https://<resource>.services.ai.azure.com/anthropic':(d.base?'Default: '+d.base:'The server’s base URL, e.g. http://localhost:8080/v1');var mh=$('evModel');if(mh)mh.placeholder=d.ph||'model'}
function prefillSetupFromBrowser(){var c=getAI(),p=aiProvKey(c);if(!$('evProv')||p==='relay')return;$('evProv').value=PROV[p]?p:'custom';$('evBase').value=c.base||'';$('evModel').value=c.model||'';renderEnv();var det=$('aiSetupDetails');if(det)det.open=true;var s=$('aiSetup');if(s)s.scrollIntoView({behavior:'smooth',block:'nearest'})}
function renderSetup(){
  var box=$('aiSetup');if(!box)return;var r=cfg();box.hidden=!r;if(!r)return;var ra=relayAI()||{};
  var opts=Object.keys(PROV).filter(function(k){return k!=='relay'}),groups={};opts.forEach(function(k){(groups[PROV[k].group]=groups[PROV[k].group]||[]).push(k)});
  var sel='<select class="f" id="evProv" aria-label="Provider">'+Object.keys(groups).map(function(g){return '<optgroup label="'+h(g)+'">'+groups[g].map(function(k){return '<option value="'+k+'">'+h(PROV[k].label)+'</option>'}).join('')+'</optgroup>'}).join('')+'</select>';
  box.innerHTML='<details class="ai-details" id="aiSetupDetails"'+(ra.configured?'':' open')+'><summary>'+(ra.configured?'Change the AI provider in .env':'Set up with the relay')+' <small>'+(ra.configured?'currently '+h(ra.label):'recommended · keys stay in .env')+'</small></summary>'+
    '<p class="muted">Fill in your provider’s details. Copy the lines into <code>.env</code> next to <code>relay.py</code>, add your key there, restart the relay, then choose <b>Run diagnostics</b>. The key never reaches this page.</p>'+
    '<div class="st-row"><div class="lb"><b>Provider</b></div><div class="ct">'+sel+'</div></div>'+
    '<div class="st-row"><div class="lb"><b>Endpoint</b><small id="evBaseHint"></small></div><div class="ct"><input class="f" id="evBase" autocomplete="off" spellcheck="false" placeholder="https://…"></div></div>'+
    '<div class="st-row"><div class="lb"><b>Model or deployment</b><small>For Azure and Foundry this is the deployment name.</small></div><div class="ct"><input class="f" id="evModel" autocomplete="off" spellcheck="false"></div></div>'+
    '<div class="st-row" id="evAuthRow"><div class="lb"><b>Sign-in</b><small>Use Entra ID when the resource has keys turned off.</small></div><div class="ct"><div class="seg" id="evAuth"><button type="button" data-v="key" class="on">API key</button><button type="button" data-v="entra">Entra ID (keyless)</button></div></div></div>'+
    '<div class="ai-env"><pre id="evOut"></pre><button class="btn" type="button" id="evCopy">Copy</button></div></details>';
  var p0=ra.configured?provFromRelay(ra):(function(){var c=getAI(),p=aiProvKey(c);return p!=='relay'&&PROV[p]?p:'azure'})();
  $('evProv').value=p0;
  if(ra.configured){$('evBase').value=ra.endpoint?ra.endpoint.replace(/\/chat\/completions$/,'').replace(/\/v1\/messages$/,''):'';$('evModel').value=ra.model||'';if(ra.auth==='entra')$('evAuth').querySelectorAll('button').forEach(function(b){b.classList.toggle('on',b.dataset.v==='entra')})}
  else{var c=getAI();if(aiProvKey(c)===p0){$('evBase').value=c.base||'';$('evModel').value=c.model||''}}
  $('evProv').onchange=function(){$('evBase').value='';$('evModel').value='';renderEnv()};
  $('evBase').oninput=$('evModel').oninput=renderEnv;
  $('evAuth').querySelectorAll('button').forEach(function(b){b.onclick=function(){$('evAuth').querySelectorAll('button').forEach(function(x){x.classList.toggle('on',x===b)});renderEnv()}});
  $('evCopy').onclick=function(){var t=envLines().join('\n')+'\n';(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){toast('Copied — paste into .env and restart the relay')},function(){var r2=document.createRange();r2.selectNodeContents($('evOut'));var s=getSelection();s.removeAllRanges();s.addRange(r2);toast('Selected — press Ctrl+C to copy')})};
  renderEnv();
}
var built=false;
function buildAIStudio(){
  if(built)return true;var sec=document.querySelector('#studioModal .studio-section[data-s="models"]'),base=$('aiBase');if(!sec||!base)return false;
  var old=base.closest('.studio-card');if(!old)return false;built=true;
  var conn=document.createElement('div');conn.className='studio-card ai-conn';
  conn.innerHTML='<h5>Connection</h5><div class="ai-state" id="aiState"></div>'+
    '<div class="st-row"><div class="lb"><b>Stream answers</b><small>Show text as it’s written.</small></div><div class="ct" id="aiStreamSlot"></div></div>'+
    '<div class="bar"><button class="btn primary" type="button" data-ai="doctor">Run diagnostics</button><button class="btn" type="button" data-ai="models">List models</button></div>'+
    '<div class="ai-doctor" id="aiDoctor" aria-live="polite"></div><div class="ai-models" id="aiModels"></div>';
  var setup=document.createElement('div');setup.className='studio-card ai-setup';setup.id='aiSetup';
  sec.insertBefore(conn,old);sec.insertBefore(setup,old);
  var st=$('streamToggle');if(st){var lab=st.closest('label');if(lab){lab.textContent='';lab.appendChild(st);lab.appendChild(document.createTextNode(' On'));$('aiStreamSlot').appendChild(lab)}}
  /* old form → "Browser connection", collapsible when the relay is present */
  var head=old.querySelector('h5');var det=document.createElement('details');det.className='ai-details';det.id='aiBrowserDetails';
  det.innerHTML='<summary>Browser connection <small id="aiBrowserSum"></small></summary>';
  [].slice.call(old.childNodes).forEach(function(n){if(n!==head)det.appendChild(n)});if(head)head.remove();old.appendChild(det);
  var diag=$('aiDiag');if(diag)diag.remove();
  var warn=old.querySelector('.warn');if(warn)warn.textContent='Keys entered here are stored in this browser. For Azure, Foundry and anything sensitive, prefer the relay — keys then stay in .env. AI is review-first: it never rewrites your journal on its own.';
  conn.addEventListener('click',function(e){var b=e.target.closest('[data-ai]');if(!b)return;if(b.dataset.ai==='doctor')runDoctor();else listModels()});
  refresh();return true;
}
function refresh(){
  if(!built)return;renderState();renderSetup();
  var det=$('aiBrowserDetails'),r=cfg();if(det){det.open=!r||(!aiIsRelay(getAI())&&aiReady()&&!(relayAI()||{}).configured);var s=$('aiBrowserSum');if(s)s.textContent=r?'use a key stored in this browser instead':'keys are stored in this browser'}
  try{fillAI()}catch(_){}
}
window.dailyAI={retrieve:retrieve,contextBlock:contextBlock,renderAnswer:renderAnswer,openEntry:openEntryAt,runDoctor:function(){var d=$('aiDoctor');if(d)return runDoctor();},listModels:listModels,refresh:refresh};

/* Ask-your-journal entry points */
window.openAskJournal=function(q){try{dailyWorkspace.open('bottom',true);setTimeout(function(){var t=document.querySelector('#wsBottomTabs [data-t="ai"]');if(t)t.click();var i=$('wsAiInput');if(i){if(q)i.value=q;i.focus()}},60)}catch(_){}};

var tries=0;(function wait(){if(!buildAIStudio()&&tries++<80)setTimeout(wait,120)})();
document.addEventListener('daily:relay',function(){setTimeout(refresh,30)});
document.addEventListener('daily:ai',function(){if(built)renderState()});
})();
