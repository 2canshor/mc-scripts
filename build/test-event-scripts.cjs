// Isolated fixture tests; never contact production or use real accounts.
// npm install --prefix /tmp/ca-event-centre-deps playwright@1.58.2 jszip@3.10.1
// NODE_PATH=/tmp/ca-event-centre-deps/node_modules node build/test-event-scripts.cjs
// Requires python3, pdftotext, Chrome on macOS (bundled Chromium elsewhere).
// Protected production fonts are never read: a local Latin serif font is used only by this fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const {execFileSync} = require('node:child_process');
const {chromium} = require('playwright');
const JSZip = require('jszip');
const latinFont = process.env.TEST_LATIN_FONT || ['/System/Library/Fonts/Supplemental/Georgia.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'].find(fs.existsSync);
assert.ok(latinFont, 'Set TEST_LATIN_FONT to a local Latin serif font for isolated export fixtures');
const root = path.resolve(__dirname, '..'), out = process.env.TEST_OUTPUT || '/tmp/ca-event-centre-tests';
fs.mkdirSync(out, {recursive:true});
execFileSync('python3', ['build/build.py'], {cwd:root});
const apiCode = fs.readFileSync(path.join(root, 'src/events-api.js'), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const apiCtx = vm.createContext({console, Response, TextEncoder, Uint8Array, crypto:require('node:crypto').webcrypto, atob, btoa, SEED:{}, PAGE_VERSION:'test'});
vm.runInContext(apiCode + '\nglobalThis.spec = {checkWrite, validScripts, stamp, upgrade};', apiCtx);
const api = apiCtx.spec, copy = x => JSON.parse(JSON.stringify(x));
async function until(check) { for(let i=0;i<300;i++){if(check())return;await new Promise(r=>setTimeout(r,20));}assert.ok(check(),'fixture server received the saved change'); }
const fixture = () => ({id:'fixture',v:4,date:'30/12/31',name:'Test Assembly',asmTime:'08:00',venue:'Hall',leading:['TEST'],support:[],lead:'測試主席',groups:[{name:'MC Group A'}],mcs:[['5A','甲同學']],rows:[{id:'opening',time:'08:00',title:'Opening',place:'Hall',say:[{id:'original',type:'line',sp:'甲同學',text:'ORIGINAL SCRIPT'}]}],tasks:[],awards:{},guests:null,att:{},leave:{},roll:{},log:[],upd:{}});
const extra = () => ({id:'second',name:'Afternoon',mcs:[['4B','乙同學']],rows:[{id:'opening',say:[{id:'second-line',type:'line',sp:'乙同學',text:'SECOND SCRIPT'}]}]});
const old = fixture(), added = {...copy(old),scripts:[extra()]};
assert.equal(api.validScripts(added), true);
assert.equal(api.checkWrite({type:'lead'}, old, added), null);
assert.equal(api.checkWrite({type:'group',group:'MC Group A'}, old, added), null);
assert.notEqual(api.checkWrite({type:'teacher'}, old, added), null);
assert.notEqual(api.checkWrite({type:'group',group:'MC Group B'}, old, added), null);
assert.notEqual(api.checkWrite({type:'group',group:'Backstage Group A'}, {...old,groups:[{name:'Backstage Group A'}]}, added), null);
const rename = copy(old); rename.scriptName='Morning';
assert.equal(api.checkWrite({type:'group',group:'MC Group A'},old,rename), null);
const bad = copy(added);bad.tasks=[{id:'x',text:'Wrong permission',to:['MC Group A'],names:[]}];
assert.notEqual(api.checkWrite({type:'group',group:'MC Group A'},old,bad), null);
assert.equal(api.validScripts({...copy(added),scripts:[extra(),extra()]}),false);
assert.equal(api.validScripts({...copy(added),scripts:[{...extra(),name:'Script'}]}),false);
assert.equal(api.validScripts({...copy(added),scripts:[{...extra(),rows:[{id:'r',say:[null]}]}]}),false);
assert.equal(api.validScripts({...copy(added),scripts:[null]}),false);
const upgraded=api.upgrade({...copy(added),scripts:[{...extra(),rows:[{id:'opening',say:[{id:'p',type:'cue',text:'one\ntwo'}]}]}]});
assert.equal(upgraded.scripts[0].rows[0].say.length,2);
assert.equal(upgraded.rows[0].say[0].text,'ORIGINAL SCRIPT');
assert.ok(api.stamp(old,added,'測試主席')['fixture:d:script:second']);
console.log('PASS API: legacy compatibility, Script permissions, malformed/duplicate names, paragraph splitting, update markers');
let current=fixture(), revision=1;
const account={id:'Event Lead',type:'lead'};
const rosters={'MC Group A':{lead:{cls:'5A01',name:'甲同學'},people:[]}};
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 const json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 if(url.pathname.startsWith('/api/')){
  if(url.pathname==='/api/state')return json({rows:[{id:'fixture',data:JSON.stringify(current),rev:revision}],chairs:['測試主席'],admins:[],rosters,account,photos:{},standins:[]});
  if(url.pathname==='/api/feedback')return json({due:[],answers:[]});
  if(url.pathname==='/api/version')return json({version:fs.readFileSync(path.join(root,'src/page-version.js'),'utf8').match(/"(.*?)"/)[1]});
  if(url.pathname==='/api/events/fixture'&&req.method==='PUT'){
   let body='';for await(const chunk of req)body+=chunk;
   const data=JSON.parse(body), next=JSON.parse(data.data);
   if(data.rev!==revision)return json({rev:revision,data:JSON.stringify(current)},409);
   if(!api.validScripts(next))return json({error:'script names'},400);
   const denied=api.checkWrite(account,current,next);if(denied)return json({error:'forbidden',unit:denied},403);
   current=copy(next);revision++;return json({rev:revision,data:JSON.stringify(current)});
  }
  if(url.pathname.startsWith('/api/fonts/')){res.setHeader('content-type','font/ttf');return fs.createReadStream(latinFont).pipe(res);}
  return json({});
 }
 let file=url.pathname==='/'?path.join(root,'src/events.html'):path.join(root,'public',url.pathname);
 if(!fs.existsSync(file)){res.writeHead(404);return res.end('Not found');}
 const ext=path.extname(file);res.setHeader('content-type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.wasm':'application/wasm','.ttf':'font/ttf','.png':'image/png'})[ext]||'application/octet-stream');
 fs.createReadStream(file).pipe(res);
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});
 try{
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  current=fixture();revision=1;
  const context=await browser.newContext({viewport,colorScheme:'light',acceptDownloads:true});
  // Use bundled public fonts/CDN library locally: no production secrets or outbound calls.
  await context.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:'@font-face{font-family:"Noto Serif TC";src:url('+url+'/fonts/NotoSerifTC-Regular.ttf)}'}));
  await context.route('https://cdnjs.cloudflare.com/ajax/libs/jszip/**',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync(require.resolve('jszip/dist/jszip.min.js'))}));
  await context.addInitScript(()=>{localStorage.setItem('ev4:token',JSON.stringify('isolated-test-token'));localStorage.setItem('ev4:acct',JSON.stringify('Event Lead'));localStorage.setItem('ev4:who',JSON.stringify('測試主席'));});
  const p=await context.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  p.on('console',m=>{if(m.type()==='error')console.error('BROWSER',m.text());});
  p.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
  await p.goto(url);await p.getByRole('button',{name:/Test Assembly/}).click();
  await p.screenshot({path:path.join(out,'documents-before-'+viewport.width+'.png'),fullPage:true});
  await p.getByRole('button',{name:'Script',exact:true}).click();
  await p.getByText('ORIGINAL SCRIPT',{exact:true}).waitFor();
  await p.screenshot({path:path.join(out,'before-'+viewport.width+'.png'),fullPage:true});
  await p.getByRole('button',{name:'Back',exact:true}).click();
  await p.getByRole('button',{name:'Edit',exact:true}).click();
  await p.getByRole('button',{name:'Add Document',exact:true}).click();
  await p.getByRole('menuitem',{name:'Script',exact:true}).click();
  await p.getByRole('textbox',{name:'Script Name',exact:true}).fill('Afternoon');
  await p.getByRole('textbox',{name:'Class',exact:true}).first().fill('4B');
  await p.getByRole('textbox',{name:'MC',exact:true}).first().fill('乙同學');
  await p.getByRole('heading').first().click();
  await p.getByRole('button',{name:'Add',exact:true}).click();
  await p.getByRole('menuitem',{name:'MC Line',exact:true}).click();
  await p.getByRole('textbox',{name:'Paragraph',exact:true}).fill('SECOND SCRIPT');
  await p.getByRole('heading').first().click();
  await p.getByRole('button',{name:'Done',exact:true}).click();
  await p.getByText('SECOND SCRIPT',{exact:true}).waitFor();
  await p.waitForFunction(()=>!S.edit&&SYNC.busy.size===0&&EVENTS[0].scripts?.[0]?.rows[0].say[0].text==='SECOND SCRIPT');
  await until(()=>current.scripts?.[0]?.rows[0].say[0].text==='SECOND SCRIPT');
  assert.equal(current.rows[0].say[0].text,'ORIGINAL SCRIPT');
  assert.equal(current.mcs[0][1],'甲同學');
  assert.equal(current.scripts[0].mcs[0][1],'乙同學');
  const scriptId=current.scripts[0].id;let expectedRoot='ORIGINAL SCRIPT';
  // A fresh page reads the named Script from the fixture server, not just a local cache.
  await p.reload();await p.getByRole('button',{name:/Test Assembly/}).click();
  await p.screenshot({path:path.join(out,'documents-after-'+viewport.width+'.png'),fullPage:true});
  await p.getByRole('button',{name:'Afternoon',exact:true}).click();
  await p.getByText('SECOND SCRIPT',{exact:true}).waitFor();
  await p.screenshot({path:path.join(out,'after-'+viewport.width+'.png'),fullPage:true});
  // Selected Script only, both Word/PDF state and complete event ZIP.
  const exported=await p.evaluate(async()=>{const f=await wordFile(EV(),'script:'+cur().script);return{name:f.name,bytes:Array.from(new Uint8Array(await f.arrayBuffer()))};});
  assert.match(exported.name,/Afternoon Script\.docx$/);
  const doc=await JSZip.loadAsync(Buffer.from(exported.bytes));
  const xml=await doc.file('word/document.xml').async('string');
  assert.ok(xml.includes('SECOND SCRIPT')&&!xml.includes('ORIGINAL SCRIPT'));
  const pdf=await Promise.all([p.waitForEvent('download',{timeout:10000}),(async()=>{await p.getByRole('button',{name:'Export',exact:true}).click();await p.getByRole('menuitem',{name:'A4',exact:true}).click();})()]);
  assert.match(pdf[0].suggestedFilename(),/Afternoon Script\.pdf$/);
  const pdfPath=path.join(out,viewport.width+'-afternoon.pdf');await pdf[0].saveAs(pdfPath);
  const pdfText=execFileSync('pdftotext',[pdfPath,'-'],{encoding:'utf8'});assert.ok(pdfText.includes('SECOND SCRIPT')&&!pdfText.includes('ORIGINAL SCRIPT')&&pdfText.toUpperCase().includes('AFTERNOON'));
  const files=await p.evaluate(async()=>{const Zip=await loadZip(),z=new Zip();await eventFolder(EV(),z);return Object.keys(z.files);});
  assert.ok(files.some(n=>/Afternoon Script\.docx$/.test(n))&&files.some(n=>/\d{6} Script\.docx$/.test(n)));
  await p.getByRole('button',{name:'Back',exact:true}).click();await p.getByRole('button',{name:'Script',exact:true}).click();await p.getByRole('button',{name:'Edit',exact:true}).click();
  await p.getByRole('textbox',{name:'Script Name',exact:true}).fill('Morning');await p.getByRole('textbox',{name:'Paragraph',exact:true}).fill('REVISED ORIGINAL');await p.getByRole('heading').first().click();await p.getByRole('button',{name:'Done',exact:true}).click();
  await until(()=>current.rows[0].say[0].text==='REVISED ORIGINAL');expectedRoot='REVISED ORIGINAL';assert.equal(current.scripts[0].rows[0].say[0].text,'SECOND SCRIPT');
  await p.getByRole('button',{name:'Back',exact:true}).click();await p.getByRole('button',{name:'Afternoon',exact:true}).click();
  const merged=await p.evaluate(()=>{const b=JSON.parse(JSON.stringify(EVENTS[0])),m=JSON.parse(JSON.stringify(b)),t=JSON.parse(JSON.stringify(b));m.scripts[0].rows[0].say[0].text='LOCAL SECOND';t.rows[0].say[0].text='REMOTE FIRST';return merge3(b,m,t);});
  assert.equal(merged.rows[0].say[0].text,'REMOTE FIRST');assert.equal(merged.scripts[0].rows[0].say[0].text,'LOCAL SECOND');
  await p.getByRole('button',{name:'Edit',exact:true}).click();
  await p.getByRole('textbox',{name:'Paragraph',exact:true}).fill('REVISED SECOND');
  await p.getByRole('heading').first().click();await p.getByRole('button',{name:'Done',exact:true}).click();
  await p.getByText('REVISED SECOND',{exact:true}).waitFor();
  await p.waitForFunction(()=>SYNC.busy.size===0&&!S.edit);
  await until(()=>current.scripts[0].rows[0].say[0].text==='REVISED SECOND');assert.equal(current.rows[0].say[0].text,expectedRoot);
  assert.equal(current.scripts[0].rows[0].say[0].text,'REVISED SECOND');
  await p.getByRole('button',{name:'Edit',exact:true}).click();await p.getByRole('button',{name:'Delete',exact:true}).click();
  await p.getByRole('button',{name:'Delete',exact:true}).last().click();
  await p.getByRole('button',{name:'Morning',exact:true}).waitFor();
  await p.waitForFunction(()=>SYNC.busy.size===0&&!S.edit&&!EVENTS[0].scripts.some(d=>d.id===cur().script));
  await until(()=>current.scripts.length===0);assert.equal(current.scripts.length,0);assert.equal(current.rows[0].say[0].text,expectedRoot);
  assert.deepEqual(errors,[]);
  console.log('PASS UI '+viewport.width+': old Script; create/save/reopen second; Word/PDF/ZIP; separate edits, merge and deletion ('+scriptId+')');
  await context.close();
 }
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
