// Events, Rundown and Tasks against a local worker: node build/test-events.js [base] [screenshot folder]
// PASSCODE must match the worker's. Uses made-up names only (the repository is public).
const {chromium}=require('/opt/node22/lib/node_modules/playwright');
const ok=(c,m)=>{console.log(c?'ok':'FAIL',m);if(!c)process.exitCode=1};
const BASE=process.argv[2]||'http://127.0.0.1:8787/', OUT=process.argv[3]||require('os').tmpdir(), CODE=process.env.PASSCODE;
const iso=o=>{const d=new Date(Date.now()+o*864e5);return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2)};
const ROSTER=['No\tName\tRole\tGroup','5A01\t甲主席\t主席\t/','3C01\t司儀組長\t組長\t司儀B組','3C02\t乙同學\t組員\t司儀B組','3C03\t丙同學\t組員\t司儀B組',
 '3C04\t丁同學\t組員\t司儀B組','3C05\t戊同學\t組員\t司儀B組','3C06\t己同學\t組員\t司儀B組','4B01\t後台組長\t組長\t後台B組','4B02\t庚同學\t組員\t後台B組','4B03\t辛同學\t組員\t後台B組',
 '6A01\t設計同學\t組員\t設計組'].join('\n');
(async()=>{
const b=await chromium.launch(); const errs=[];
async function dev(n,w,h){const c=await b.newContext({viewport:{width:w,height:h},hasTouch:true});const p=await c.newPage();
 p.on('pageerror',e=>errs.push(n+': '+e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load|net::/.test(m.text()))errs.push(n+': '+m.text())});
 await p.goto(BASE+'#k='+CODE);await p.waitForTimeout(1000);p.ctx=c;return p;}
const tag='測試活動'+Date.now()%10000;
const A=await dev('lead',820,1180), sh=A.locator('.sheet');
const fill=async(label,v)=>sh.locator('label.f',{hasText:label}).locator('input,select,textarea').first().fill(v);
const pickText=async(label,t)=>sh.locator('label.f',{hasText:label}).locator('select').first().evaluate((s,t)=>{const o=[...s.options].find(o=>o.text.includes(t));s.value=o.value;s.dispatchEvent(new Event('change'))},t);
ok(await A.textContent('.lib h1')==='活動','the list is a list of events');
await A.click('#insert');
ok(JSON.stringify(await A.$$eval('.menu button',x=>x.map(e=>e.textContent)))==='["活動","講稿"]','＋ offers an event or a script');
await A.click('.menu >> text=活動');
await A.click('.sheet .done');ok(await A.isVisible('.sheet')&&/請填寫活動名稱/.test(await A.textContent('.toast')),'an event needs a name');
await fill('活動名稱',tag);await fill('日期',iso(1));await fill('集合時間','07:45');await fill('集合地點','下禮堂');await fill('開始','08:00');await fill('結束','08:20');
await A.click('.sheet .done');await A.waitForTimeout(200);
ok(await A.evaluate(()=>document.body.dataset.view)==='event'&&(await A.textContent('#ev-title'))===tag,'saving opens the new event');
ok(/集合 07:45 下禮堂/.test(await A.textContent('#ev-facts')),'the facts line shows assembly');
ok(await A.isVisible('text=未選擇當值小組'),'no duty groups yet: says what to do');
await A.click('#evmore');await A.click('.menu >> text=更新名單');await A.fill('.sheet textarea',ROSTER);
ok(/讀到 9 位組員及 1 位主席/.test(await A.textContent('.sheet')),'roster paste reads members and chairs, skips other groups');
await A.click('.sheet .done');
await A.click('.ask .go');await A.click('.people button >> text=甲主席');await A.click('.sheet .done');
await A.click('#evmore');await A.click('.menu >> text=活動資料');
ok(await sh.locator('label.f',{hasText:'Event Lead'}).locator('select').inputValue()==='','existing event keeps its own Event Lead');
await pickText('司儀 當值小組','司儀B');await pickText('後台 當值小組','後台B');
ok(/Group Lead 司儀組長 3C01/.test(await A.textContent('.sheet')),'choosing a group shows its Group Lead');
await A.click('.sheet .done');await A.waitForTimeout(200);
ok(/0／5 人已有 Task/.test(await A.textContent('#ev-body')),'group count starts at 0 of 5 (Group Lead not counted)');
// Rundown
await A.click('#seg-run');ok(await A.isVisible('text=未有 Rundown'),'empty Rundown invites the first line');
for(const r of [['07:45','07:55','準備','練習講稿','排列獎狀'],['08:00','08:15','正式宣佈','宣佈','遞獎狀']]){
 await A.click('#insert');await fill('開始',r[0]);await fill('結束',r[1]);await fill('環節',r[2]);await fill('司儀要做',r[3]);await fill('後台要做',r[4]);await A.click('.sheet .done');}
ok(JSON.stringify(await A.$$eval('#ev-body .it .tm',x=>x.map(e=>e.textContent)))==='["07:45–07:55","08:00–08:15"]','Rundown in time order');
await A.click('#ev-body li >> nth=0 >> .rowmore');ok(JSON.stringify(await A.$$eval('.menu button',x=>x.map(e=>e.textContent)))==='["複製","刪除"]','each Rundown line has its own ⋯ with copy and delete');
await A.click('.menu >> text=複製');ok(await sh.locator('label.f',{hasText:'環節'}).locator('input').inputValue()==='準備','copy opens a new line filled from the old one');await A.click('.sheet .bar >> text=取消');
const sizes=await A.evaluate(()=>[...new Set([...document.querySelectorAll('.ev *')].filter(e=>e.offsetParent&&!e.closest('.seg')&&e.tagName!=='H1'&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>getComputedStyle(e).fontSize+'/'+getComputedStyle(e).fontWeight))]);
ok(sizes.length===1,'one text style below the title: '+sizes.join(','));
// Tasks with the six 司儀 roles
await A.click('#seg-task');
const roles=['主持 1','主持 2','撰稿','讀音','台側提示','後備司儀'], ppl=['乙同學','丙同學','丁同學','戊同學','己同學'];
for(let i=0;i<5;i++){
 await A.click('#insert');await pickText('小組','司儀B');await pickText('組員',ppl[i]);
 if(i===0)ok(JSON.stringify(await A.$$eval('.chips button',x=>x.map(e=>e.textContent)))===JSON.stringify(roles),'司儀 Tasks offer the six roles');
 await A.click('.chips >> text='+roles[i]);if(i<2)await pickText('環節','正式宣佈');else await fill('位置','台側');
 if(i===1)ok(await A.$eval('.chips >> text=主持 1',x=>x.classList.contains('taken')),'a role already given is shown as taken');
 await A.click('.sheet .done');await A.waitForTimeout(80);}
ok(/全部組員已有 Task/.test(await A.textContent('#ev-body')),'all five have a Task: the group says so');
await A.click('.missing .it >> text=庚同學');
ok(await sh.locator('label.f',{hasText:'組員'}).locator('select').evaluate(s=>s.options[s.selectedIndex].text.startsWith('庚同學')),'tapping a member without a Task starts one for them');
ok((await A.$$('.chips button')).length===0,'後台 Tasks have no 司儀 roles');
await fill('Task','遞獎狀');await pickText('環節','正式宣佈');await A.click('.sheet .done');
await A.screenshot({path:OUT+'/events-ipad.png',fullPage:true});
// Script inside the event
await A.click('#seg-script');await A.click('#insert');await A.waitForTimeout(200);
ok(await A.evaluate(()=>document.body.dataset.view)==='doc'&&await A.inputValue('#event')===tag,'a new script takes the event name and date');
let f=await A.$$('#mcline input');await f[1].click();await A.keyboard.type('乙同學');await A.waitForTimeout(400);
await A.click('#back');await A.waitForTimeout(200);
ok(await A.evaluate(()=>document.body.dataset.view)==='event'&&(await A.$$('#ev-body .it')).length===1,'back from the script returns to the event');
await A.click('#back');await A.waitForTimeout(200);
ok((await A.$$eval('#liblist .item .t',x=>x.map(e=>e.textContent))).filter(t=>t===tag).length===1,'the script sits inside its event, not beside it');
await A.waitForTimeout(2500);
// A member on a phone
const B=await dev('member',390,844);await B.waitForTimeout(800);
await B.click('#liblist .item >> text='+tag);
await B.click('.ask .go');await B.click('.people button >> text=乙同學');await B.click('.sheet .done');
ok((await B.textContent('.mine')).includes('主持 1')&&(await B.textContent('.mine .tm')).startsWith('08:00'),'the member sees their own Task first, with the Rundown time');
await B.click('#back');
// The lead moves the Rundown line; the member's Task moves with it and is marked
await A.click('#liblist .item >> text='+tag);await A.click('#seg-run');await A.click('.it >> text=正式宣佈');await fill('開始','08:05');await A.click('.sheet .done');await A.waitForTimeout(2500);
await B.evaluate(()=>window.dispatchEvent(new Event('online')));await B.waitForTimeout(1500);await B.click('#liblist .item >> text='+tag);await B.waitForTimeout(300);
ok((await B.textContent('.mine .tm')).startsWith('08:05')&&/已更改/.test(await B.textContent('.mine')),'moved Rundown line moves the Task and marks it changed');
await B.screenshot({path:OUT+'/events-phone.png',fullPage:true});
// Delete and undo
await A.click('#back');await A.click('#liblist li:has-text("'+tag+'") .rowmore');await A.click('.menu >> text=刪除');
ok(await A.$eval('#liblist li:has-text("'+tag+'") .mcs',x=>x.textContent)==='乙同學','row ⋯ deletes the event; its script stays in the list');
await A.click('.toast >> text=復原');ok(await A.$eval('#liblist li:has-text("'+tag+'") .mcs',x=>x.textContent)==='司儀B、後台B','undo brings the event back');
// clean up
await A.click('#liblist .item >> text='+tag);await A.click('#seg-script');await A.click('#ev-body .it');await A.click('#more');await A.click('.menu >> text=刪除');
await A.waitForTimeout(300);await A.click('#evmore');await A.click('.menu >> text=刪除活動');await A.waitForTimeout(2500);
console.log('errors:',JSON.stringify(errs));ok(!errs.length,'no page errors');await b.close();})();
