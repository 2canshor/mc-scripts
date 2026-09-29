// Shared Word file carries its fonts. Run against `wrangler dev` with PASSCODE and FONT_KEY in .dev.vars:
//   PASSCODE=... node build/test-fonts.js http://127.0.0.1:8787/
const {chromium}=require('/opt/node22/lib/node_modules/playwright');
const JSZip=require(process.env.JSZIP||'jszip');
const ok=(c,m)=>{console.log(c?'ok':'FAIL',m);if(!c)process.exitCode=1};
const BASE=process.argv[2]||'http://127.0.0.1:8787/scripts', CODE=process.env.PASSCODE;
(async()=>{const b=await chromium.launch();const p=await (await b.newContext({viewport:{width:820,height:1180},acceptDownloads:true})).newPage();
await p.goto(BASE);await p.waitForTimeout(600);await p.fill('#code',CODE);await p.click('.join button');await p.waitForTimeout(800);
await p.click('#insert');await p.fill('#date',new Date(Date.now()+8*36e5).toISOString().slice(0,10));await p.dispatchEvent('#date','input');
await p.click('#event');await p.keyboard.type('字型測試');
const f=await p.$$('#mcline input');await f[1].click();await p.keyboard.type('甲同學');
await p.click('#insert');await p.click('.menu >> text=司儀對白');await p.keyboard.type('我哋喺度，佢哋頒咗獎。On-us AI Challenge');
await p.waitForTimeout(6000);
const [dl]=await Promise.all([p.waitForEvent('download',{timeout:60000}),p.click('#share')]);
const zip=await JSZip.loadAsync(require('fs').readFileSync(await dl.path()));
const table=await zip.file('word/fontTable.xml').async('string');
const faces=(table.match(/<w:embed\w+ r:id=/g)||[]).length;
ok(faces===7,'Word file carries 7 font faces (got '+faces+')');
const keyOf=(fam,face)=>{const m=new RegExp('<w:font w:name="'+fam+'">[^]*?<w:embed'+face+' r:id="([^"]+)" w:fontKey="([^"]+)"').exec(table);return m&&{id:m[1],key:m[2]}};
const rels=await zip.file('word/_rels/fontTable.xml.rels').async('string');
const k=keyOf('Noto Serif TC','Regular');const target=new RegExp('Id="'+k.id+'"[^>]*Target="([^"]+)"').exec(rels)[1];
const data=new Uint8Array(await zip.file('word/'+target).async('uint8array'));
const hex=k.key.replace(/[{}-]/g,'');for(let j=0;j<32;j++)data[j]^=parseInt(hex.substr(30-2*(j%16),2),16);
ok(data[0]===0&&data[1]===1&&data[2]===0&&data[3]===0,'embedded Noto Serif TC reads back as a TrueType font');
ok(zip.file('word/settings.xml')&&(await zip.file('word/settings.xml').async('string')).includes('<w:embedTrueTypeFonts/>'),'settings ask Word to use embedded fonts');
await b.close();})();
