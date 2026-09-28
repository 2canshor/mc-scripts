// Paragraph actions sit on each paragraph's own ⋯; the toolbar ⋯ only has whole-script actions.
const {chromium}=require('/opt/node22/lib/node_modules/playwright');
const ok=(c,m)=>{console.log(c?'ok':'FAIL',m);if(!c)process.exitCode=1};
(async()=>{const b=await chromium.launch();const out=process.argv[2]||require('os').tmpdir();
for (const [w,h,scheme] of [[820,1180,'light'],[1440,900,'dark']]){
 const p=await b.newPage({viewport:{width:w,height:h},colorScheme:scheme});
 await p.goto('file://'+__dirname+'/MC Scripts.html');await p.waitForTimeout(200);
 await p.click('#insert');await p.click('#event');await p.keyboard.type('早會頒獎');
 const f=await p.$$('#mcline input');await f[1].click();await p.keyboard.type('甲同學');
 await p.click('#insert');await p.click('.menu >> text=司儀對白');await p.keyboard.type('各位早晨');
 await p.click('#insert');await p.click('.menu >> text=流程提示');await p.keyboard.type('校長上台');
 const vis=await p.$$eval('.bmore',x=>x.map(e=>getComputedStyle(e).opacity));
 ok(JSON.stringify(vis)==='["0","1"]','⋯ shows only on the paragraph being edited');
 await p.click('#more');
 ok(JSON.stringify(await p.$$eval('.menu button',x=>x.map(e=>e.textContent)))==='["複製成新講稿","刪除成份講稿"]','toolbar ⋯ has whole-script actions only');
 await p.keyboard.press('Escape');
 await p.click('.row.cue .bmore');
 ok(JSON.stringify(await p.$$eval('.menu button',x=>x.map(e=>e.textContent)))==='["司儀對白","流程提示","得獎名單","上移","刪除呢段"]','paragraph ⋯: type choice, only possible moves, delete');
 ok(await p.$eval('.menu [aria-checked="true"]',e=>e.textContent)==='流程提示','current type is ticked');
 await p.screenshot({path:`${out}/blocks-${w}.png`});
 await p.click('.menu >> text=上移');
 ok(await p.$$eval('#rows .row',x=>x.map(r=>r.className.split(' ')[1]).join())==='cue,line','move up works');
 await p.hover('.row.line');await p.click('.row.line .bmore');await p.click('.menu >> text=刪除呢段');
 ok((await p.$$('#rows .row')).length===1,'delete from the paragraph ⋯');
}
await b.close();})();
