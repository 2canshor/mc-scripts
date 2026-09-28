const {chromium}=require('/opt/node22/lib/node_modules/playwright');
const ok=(c,m)=>{console.log(c?'ok':'FAIL',m);if(!c)process.exitCode=1};
(async()=>{const b=await chromium.launch();const out=process.argv[2]||require('os').tmpdir();
for (const [w,h,scheme] of [[1440,900,'dark'],[820,1180,'light']]){
 const p=await b.newPage({viewport:{width:w,height:h},colorScheme:scheme});
 await p.goto('file://'+process.cwd()+'/build/MC Scripts.html');await p.waitForTimeout(200);
 ok(!(await p.isVisible('#q')),w+' no search while the list is empty');
 await p.evaluate(()=>{const mk=(id,ev,d,mc,txt)=>({id,updated:Date.now(),state:{event:ev,date:d,mcs:[{id:'m'+id,cls:'3C',name:mc}],blocks:[{id:'b'+id,type:'line',mc:'m'+id,text:txt}]}});
  localStorage.setItem('ca-script-builder-v3',JSON.stringify({scripts:[mk('a','早會頒獎','2026-09-28','甲同學','各位早晨'),mk('b','Opening Ceremony','2026-09-01','乙同學','Good morning everyone')],open:null}));});
 await p.reload();await p.waitForTimeout(300);
 ok(await p.isVisible('#q'),w+' search shows with scripts');
 await p.fill('#q','乙');ok((await p.$$('#liblist li')).length===1,w+' MC name matches');
 await p.fill('#q','good morning');ok((await p.$$('#liblist li')).length===1,w+' words inside the script match, spaces and case ignored');
 await p.fill('#q','26/09/28');ok((await p.$$('#liblist li')).length===1,w+' date matches');
 await p.fill('#q','zzz');ok((await p.$$('#liblist li')).length===0&&await p.isVisible('#nomatch'),w+' no match message');
 await p.fill('#q','');ok((await p.$$('#liblist li')).length===2,w+' cleared shows all');
 const r=await p.evaluate(()=>{const a=document.getElementById('searchbar').getBoundingClientRect(),f=document.getElementById('insert').getBoundingClientRect(),t=document.querySelector('.lib h1').getBoundingClientRect();return {sLeft:Math.round(a.left),sRight:Math.round(a.right),fLeft:Math.round(f.left),sTop:Math.round(a.top),fTop:Math.round(f.top),h1:Math.round(t.left)}});
 console.log(w,JSON.stringify(r));
 await p.fill('#q','早');await p.screenshot({path:`${out}/search-${w}.png`});
}
await b.close();})();
