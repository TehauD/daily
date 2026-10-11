(function(){'use strict';
const KEY='daily:appearance:v1';
const BASE={accent:'#0969da',font:'system',fontSize:16,lineHeight:'1.7',paragraph:'balanced',density:'balanced',corners:'subtle',motion:'system',contrast:false,spellcheck:true};
const ACCENTS=[['#0969da','Blue'],['#0f766e','Teal'],['#7c3aed','Violet'],['#b45309','Amber'],['#be185d','Rose'],['#57606a','Graphite']];
const FONTS=[['system','System'],['serif','Serif'],['mono','Mono']];
const SIZES=[14,16,18,20];
const LHEIGHTS=[['1.5','Compact'],['1.7','Balanced'],['1.9','Open']];
const PARAS=[['tight','Tight'],['balanced','Balanced'],['generous','Generous']];
const DENSITIES=[['compact','Compact'],['balanced','Balanced'],['comfortable','Comfortable']];
const CORNERS=[['sharp','Sharp'],['subtle','Subtle'],['soft','Soft']];
const MOTIONS=[['system','Follow system'],['reduced','Reduced'],['none','None']];
function id(x){return document.getElementById(x)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function load(){try{return Object.assign({},BASE,JSON.parse(localStorage.getItem(KEY)||'{}'))}catch(_){return Object.assign({},BASE)}}
let S=load();
function save(){try{localStorage.setItem(KEY,JSON.stringify(S))}catch(_){}}
function apply(){
  let d=document.documentElement;
  d.style.setProperty('--accent',S.accent);
  d.style.setProperty('--editor-font-family',S.font==='serif'?'Georgia,Cambria,"Times New Roman",serif':S.font==='mono'?'var(--mono)':'var(--font)');
  d.style.setProperty('--editor-font-size',S.fontSize+'px');
  d.style.setProperty('--editor-line-height',S.lineHeight);
  d.style.setProperty('--para-space',S.paragraph==='tight'?'.35em':S.paragraph==='generous'?'1.1em':'.6em');
  d.style.setProperty('--radius',S.corners==='sharp'?'2px':S.corners==='soft'?'12px':'6px');
  d.dataset.density=S.density;
  d.dataset.motion=S.motion;
  d.dataset.contrast=S.contrast?'high':'normal';
  let e=id('entry');if(e)e.setAttribute('spellcheck',S.spellcheck?'true':'false');
}
function seg(field,items,val){return '<div class="aw-seg" data-field="'+field+'">'+items.map(function(it){let v=Array.isArray(it)?it[0]:it,lb=Array.isArray(it)?it[1]:it;return '<button data-v="'+v+'" class="'+(String(val)===String(v)?'on':'')+'">'+esc(lb)+'</button>'}).join('')+'</div>'}
function renderAppearance(){
  let host=document.querySelector('.studio-section[data-s="appearance"]');if(!host)return;
  if(!host.querySelector('.aw-legacy')){
    let kids=[].slice.call(host.children).filter(function(c){return c.tagName!=='H4'&&!c.classList.contains('intro')});
    if(kids.length){let card=document.createElement('div');card.className='studio-card aw-legacy';kids.forEach(function(k){card.appendChild(k)});host.appendChild(card)}
  }
  if(host.querySelector('.aw-built')){sync();return}
  host.insertAdjacentHTML('beforeend',
    '<div class="studio-card aw-built"><h5>Color</h5><div class="aw-field"><label>Accent</label><div class="aw-swatches">'+ACCENTS.map(function(a){return '<button class="aw-swatch'+(S.accent===a[0]?' on':'')+'" data-accent="'+a[0]+'" style="background:'+a[0]+'" title="'+esc(a[1])+'"></button>'}).join('')+'</div></div></div>'+
    '<div class="studio-card aw-built"><h5>Typography</h5><div class="aw-grid">'+
      '<div class="aw-field"><label>Font</label>'+seg('font',FONTS,S.font)+'</div>'+
      '<div class="aw-field"><label>Size</label>'+seg('fontSize',SIZES.map(function(s){return [s,s+' px']}),S.fontSize)+'</div>'+
      '<div class="aw-field"><label>Line height</label>'+seg('lineHeight',LHEIGHTS,S.lineHeight)+'</div>'+
      '<div class="aw-field"><label>Paragraph spacing</label>'+seg('paragraph',PARAS,S.paragraph)+'</div>'+
    '</div></div>'+
    '<div class="studio-card aw-built"><h5>Layout &amp; motion</h5><div class="aw-grid">'+
      '<div class="aw-field"><label>Density</label>'+seg('density',DENSITIES,S.density)+'</div>'+
      '<div class="aw-field"><label>Corner style</label>'+seg('corners',CORNERS,S.corners)+'</div>'+
      '<div class="aw-field"><label>Motion</label>'+seg('motion',MOTIONS,S.motion)+'</div>'+
    '</div>'+
    '<div class="aw-row"><div><h5>High contrast</h5><small class="muted">Strengthen borders and text against the background.</small></div><button class="ws-switch'+(S.contrast?' on':'')+'" data-toggle="contrast"><i></i></button></div>'+
    '<div class="aw-row"><div><h5>Spellcheck</h5><small class="muted">Underline possible spelling mistakes while writing.</small></div><button class="ws-switch'+(S.spellcheck?' on':'')+'" data-toggle="spellcheck"><i></i></button></div>'+
    '</div>');
  wire(host);
}
function wire(host){
  host.querySelectorAll('.aw-swatch').forEach(function(b){b.onclick=function(){S.accent=b.dataset.accent;save();apply();host.querySelectorAll('.aw-swatch').forEach(function(x){x.classList.toggle('on',x===b)})}});
  host.querySelectorAll('[data-field]').forEach(function(g){let f=g.dataset.field;g.querySelectorAll('button').forEach(function(b){b.onclick=function(){S[f]=f==='fontSize'?+b.dataset.v:b.dataset.v;save();apply();g.querySelectorAll('button').forEach(function(x){x.classList.toggle('on',x===b)})}})});
  host.querySelectorAll('[data-toggle]').forEach(function(b){b.onclick=function(){let k=b.dataset.toggle;S[k]=!S[k];save();apply();b.classList.toggle('on',S[k])}});
}
function sync(){
  let host=document.querySelector('.studio-section[data-s="appearance"]');if(!host)return;
  host.querySelectorAll('.aw-swatch').forEach(function(b){b.classList.toggle('on',b.dataset.accent===S.accent)});
  host.querySelectorAll('[data-field]').forEach(function(g){let f=g.dataset.field;g.querySelectorAll('button').forEach(function(b){b.classList.toggle('on',String(S[f])===b.dataset.v)})});
  host.querySelectorAll('[data-toggle]').forEach(function(b){b.classList.toggle('on',!!S[b.dataset.toggle])});
}
window.renderAppearance=renderAppearance;
apply();
})();
