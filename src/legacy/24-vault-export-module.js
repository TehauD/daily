/* ============================================================
   VAULT EXPORT
   Turns the browser-held journal into something Obsidian can open
   directly: one .md per entry at YYYY/MM/DD/slug--id.md, with the
   same frontmatter, nested tags and [[wikilinks]] that Git push
   writes. Two outputs:
     · .zip    — real folder tree, drop straight into a vault
     · .md     — single concatenated file, dated sections, no zip
   Zero dependencies: the ZIP is written with a ~40-line STORE-method
   writer, so it works offline and adds nothing to page weight.
   ============================================================ */
(function(){
'use strict';

/* ---- minimal ZIP (STORE, no compression) ---- */
var CRC=(function(){var t=new Uint32Array(256);for(var n=0;n<256;n++){var c=n;for(var k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}return t;})();
function crc32(buf){var c=0xFFFFFFFF;for(var i=0;i<buf.length;i++)c=CRC[(c^buf[i])&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
function utf8(s){return new TextEncoder().encode(s);}
function dosTime(d){return ((d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()/2))&0xFFFF;}
function dosDate(d){return (((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate())&0xFFFF;}
function zipStore(files){
  var now=new Date(), tm=dosTime(now), dt=dosDate(now);
  var parts=[], central=[], offset=0;
  files.forEach(function(f){
    var name=utf8(f.path), data=utf8(f.body), crc=crc32(data);
    var lh=new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true); lh.setUint16(4,20,true); lh.setUint16(6,0x0800,true);
    lh.setUint16(8,0,true); lh.setUint16(10,tm,true); lh.setUint16(12,dt,true);
    lh.setUint32(14,crc,true); lh.setUint32(18,data.length,true); lh.setUint32(22,data.length,true);
    lh.setUint16(26,name.length,true); lh.setUint16(28,0,true);
    parts.push(new Uint8Array(lh.buffer),name,data);
    var ch=new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true); ch.setUint16(4,20,true); ch.setUint16(6,20,true);
    ch.setUint16(8,0x0800,true); ch.setUint16(10,0,true); ch.setUint16(12,tm,true); ch.setUint16(14,dt,true);
    ch.setUint32(16,crc,true); ch.setUint32(20,data.length,true); ch.setUint32(24,data.length,true);
    ch.setUint16(28,name.length,true); ch.setUint32(42,offset,true);
    central.push(new Uint8Array(ch.buffer),name);
    offset+=30+name.length+data.length;
  });
  var cs=central.reduce(function(a,b){return a+b.length;},0);
  var end=new DataView(new ArrayBuffer(22));
  end.setUint32(0,0x06054b50,true);
  end.setUint16(8,files.length,true); end.setUint16(10,files.length,true);
  end.setUint32(12,cs,true); end.setUint32(16,offset,true);
  return new Blob(parts.concat(central,[new Uint8Array(end.buffer)]),{type:'application/zip'});
}

/* ---- helpers ---- */
function entriesAll(){try{return (typeof allEntries==='function')?(allEntries()||[]):[];}catch(e){return[];}}
function today(){try{return (typeof todayISO==='function')?todayISO():new Date().toISOString().slice(0,10);}catch(e){return new Date().toISOString().slice(0,10);}}
function say(m){try{toast(m);}catch(e){}}
function slug(e){
  var s=e.slug||e.title||'note';
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||'note';
}
function relPath(e){
  var p=String(e.date||today()).split('-');
  return [p[0],p[1],p[2],slug(e)+'--'+(e.id||'entry')+'.md'].join('/');
}
function body(e){
  var text=e.text||'';
  try{ if(typeof autoTagInline==='function') text=autoTagInline(text); }catch(_){}
  var fm='';
  try{ if(typeof buildFrontmatter==='function') fm=buildFrontmatter(Object.assign({},e,{text:text}))+'\n\n'; }catch(_){}
  var head='# '+(e.title||e.date||'Entry')+'\n\n';
  var foot='';
  try{
    if(typeof projectSlugs==='function'){
      var ps=projectSlugs(text)||[];
      if(ps.length) foot='\n\n**Projects:** '+ps.map(function(p){return '[['+p+']]';}).join(' ');
    }
  }catch(_){}
  return fm+head+text+foot+'\n';
}
function saveBlob(name,blob){
  var u=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=u; a.download=name; a.click();
  setTimeout(function(){URL.revokeObjectURL(u);},4000);
}
function readme(n){
  return ['# The Daily \u2014 vault export','',
    'Exported '+new Date().toLocaleString()+' \u00b7 '+n+' entries.','',
    '## Open in Obsidian','',
    '1. Unzip this folder.',
    '2. Obsidian \u2192 **Open folder as vault** \u2192 choose the unzipped folder.',
    '3. Open the graph view. Entries link by `[[project]]` and nested `#type/*` tags.','',
    '## Layout','',
    '```','YYYY/MM/DD/slug--id.md','```','',
    'Each file carries YAML frontmatter (`date`, `tags`, `projects`, `aliases`, `cssclasses`),',
    'so Obsidian Properties, Dataview queries, and tag search all work with no conversion.','',
    '## Also a Git repo','',
    'This is the same layout The Daily pushes to GitHub or Azure Repos.',
    '`git init` inside the folder and you have version history for free.',''].join('\n');
}

/* ---- exports ---- */
window.exportVault=function(){
  try{ if(typeof flush==='function') flush(); }catch(_){}
  var list=entriesAll();
  if(!list.length){ say('Nothing to export yet \u2014 write an entry first.'); return; }
  var files=list.map(function(e){ return {path:relPath(e), body:body(e)}; });
  files.unshift({path:'README.md', body:readme(list.length)});
  try{
    saveBlob('the-daily-vault-'+today()+'.zip', zipStore(files));
    say('Vault exported \u2014 '+list.length+' entries. Open the folder as an Obsidian vault.');
  }catch(err){
    say('Zip failed, exporting single Markdown file instead.');
    window.exportVaultMD();
  }
};

window.exportVaultMD=function(){
  try{ if(typeof flush==='function') flush(); }catch(_){}
  var list=entriesAll();
  if(!list.length){ say('Nothing to export yet \u2014 write an entry first.'); return; }
  var out=['---','title: The Daily \u2014 journal export','exported: '+new Date().toISOString(),
           'entries: '+list.length,'cssclasses:','  - the-daily','---','',
           '# The Daily','','_'+list.length+' entries \u00b7 '+(list[0].date||'')+' \u2192 '+(list[list.length-1].date||'')+'_','',
           '> [!info] Single-file export','> One note per day is available via the .zip vault export.','','---',''];
  var lastDate='';
  list.forEach(function(e){
    if(e.date!==lastDate){ out.push('','## '+e.date,''); lastDate=e.date; }
    out.push('### '+(e.title||'Entry'),'');
    var text=e.text||'';
    try{ if(typeof autoTagInline==='function') text=autoTagInline(text); }catch(_){}
    out.push(text,'');
  });
  saveBlob('the-daily-journal-'+today()+'.md', new Blob([out.join('\n')],{type:'text/markdown'}));
  say('Exported '+list.length+' entries as one Markdown file.');
};

/* ---- surface it: command menu + Studio backup bar ---- */
try{
  if(typeof SCAF==='object'&&SCAF){
    SCAF.vault=['\u25c8','Export vault (.zip)','Obsidian-ready folder \u2014 one .md per entry','Publish',null,function(){window.exportVault();}];
    SCAF.vaultmd=['\u2261','Export journal (single .md)','Every entry concatenated into dated sections','Publish',null,function(){window.exportVaultMD();}];
  }
}catch(e){}

function mount(){
  var host=document.querySelector('button[onclick="exportAll()"]');
  if(!host||document.getElementById('vaultZipBtn'))return;
  var z=document.createElement('button');
  z.id='vaultZipBtn'; z.className='btn'; z.innerHTML='\u25c8 Export vault (.zip)';
  z.title='Obsidian-ready folder: one Markdown file per entry';
  z.onclick=function(){window.exportVault();};
  var m=document.createElement('button');
  m.id='vaultMdBtn'; m.className='btn'; m.innerHTML='\u2261 Export as one .md';
  m.title='Every entry concatenated into dated sections';
  m.onclick=function(){window.exportVaultMD();};
  host.parentNode.insertBefore(z,host.nextSibling);
  z.parentNode.insertBefore(m,z.nextSibling);
  var p=host.parentNode.previousElementSibling;
  if(p&&p.classList&&p.classList.contains('muted')&&p.textContent.indexOf('vault')<0){
    p.textContent='Local-first. Back up the whole journal to one file, take it to Obsidian as a vault, or restore it on another device.';
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
setTimeout(mount,1200);
})();
