const {chromium}=require('/opt/node22/lib/node_modules/playwright');
const ok=(c,m)=>{console.log(c?'ok':'FAIL',m);if(!c)process.exitCode=1};
(async()=>{const b=await chromium.launch();const out=process.argv[2]||require('os').tmpdir();
const seed=()=>{const iso=o=>{const d=new Date(Date.now()+o*864e5);return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2)};
 const ev=[['早會頒獎',0,'甲同學','乙同學'],['科技及科學教育頒獎',1,'丙同學'],['中一家長晚會',9,'丁同學','戊同學'],['Opening Ceremony',null,'Tai Man Chan'],['',null,'己同學'],['開學禮',-27,'甲同學'],['暑期銜接課程',-44,'乙同學'],['早會',-14,'丙同學'],['早會',-7,'丁同學'],['畢業禮',-90,'戊同學']];
 const scripts=ev.map((e,i)=>({id:'s'+i,updated:Date.now()-i*6e5,state:{event:e[0],date:e[1]===null?'':iso(e[1]),mcs:e.slice(2).map((n,k)=>({id:'m'+i+k,cls:'3C',name:n})),blocks:[{id:'b'+i,type:'line',mc:'m'+i+'0',text:'各位早晨'}]}}));
 localStorage.setItem('ca-script-builder-v3',JSON.stringify({scripts,open:null}));};
for (const [w,h,scheme] of [[1440,900,'dark'],[820,1180,'light']]){
 const p=await b.newPage({viewport:{width:w,height:h},colorScheme:scheme});
 await p.goto('file://'+process.cwd()+'/build/MC Scripts.html');await p.evaluate(seed);await p.reload();await p.waitForTimeout(300);
 const heads=await p.$$eval('.sh',x=>x.map(e=>e.textContent));console.log(w,JSON.stringify(heads));
 ok(heads[0]==='即將舉行'&&heads[1]==='未有日期'&&/^已舉行（5）/.test(heads[2]),'three sections in order, past counted');
 ok(await p.$eval('.section ul',u=>u.children[0].textContent.includes('早會頒獎')&&u.children[0].textContent.includes('今日')),'nearest event first, labelled 今日');
 ok(!(await p.isVisible('text=畢業禮')),'held events folded away');
 await p.screenshot({path:`${out}/list-${w}.png`});
 await p.click('button.sh');ok(await p.isVisible('text=畢業禮'),'tap 已舉行 opens it');await p.click('button.sh');
 // each row has its own ⋯
 ok(!(await p.isVisible('.edge')),'no page-wide ⋯ on the list');
 ok((await p.$$('li .rowmore')).length===10,'every row has a ⋯');
 await p.click('li >> nth=0 >> .rowmore');
 ok(JSON.stringify(await p.$$eval('.menu button',x=>x.map(e=>e.textContent)))==='["分享","複製成新講稿","刪除"]','row ⋯ offers share, copy, delete');
 await p.waitForTimeout(400);
 const [dl]=await Promise.all([p.waitForEvent('download',{timeout:5000}).catch(()=>null),p.click('.menu >> text=分享')]);
 ok(!!dl,'share from the list hands over the Word file');
 await p.click('li >> nth=1 >> .rowmore');await p.click('.menu >> text=刪除');
 ok((await p.$$('.item')).length===9,'row ⋯ delete removes one');
 await p.click('.toast >> text=復原');ok((await p.$$('.item')).length===10,'undo restores');
 const lv=await p.evaluate(()=>{const f=s=>{const c=getComputedStyle(document.querySelector(s));return c.fontSize+'/'+c.fontWeight};return [f('.lib h1'),f('#libcount'),f('.sh'),f('.item .t'),f('.item .s')]});
 console.log(w,'text levels',JSON.stringify(lv));
 // right click row
 await p.click('.item >> nth=0',{button:'right'});ok(await p.isVisible('.menu >> text=複製成新講稿'),'right-click shows row actions');
 await p.click('.menu >> text=複製成新講稿');ok(await p.evaluate(()=>document.body.dataset.view==='doc'&&document.getElementById('date-text').textContent==='YY/MM/DD'),'copy opens without a date');
 await p.click('#more');ok(await p.isVisible('.menu >> text=複製成新講稿'),'doc menu has copy');await p.keyboard.press('Escape');
 await p.click('#back');ok(await p.$eval('#liblist',x=>x.textContent.includes('未有日期')),'copy listed under 未有日期');
 const t=await p.evaluate(()=>{const h=document.querySelector('.lib h1').getBoundingClientRect(),e=document.querySelector('.edge .glass').getBoundingClientRect();return [Math.round(h.top),Math.round(e.bottom)]});console.log(w,'h1 top vs toolbar bottom',t);
}
await b.close();})();
