/* Проверка собранной демо-версии. Запуск:

     python3 smena/build-demo.py /tmp/demo.html
     cd /tmp && npx http-server -p 8791 -s . &
     NODE_PATH=$(npm root -g) node smena/test-demo.js http://127.0.0.1:8791/demo.html
*/
const {chromium}=require('playwright');
const URL=process.argv[2]||'http://127.0.0.1:8791/demo.html';
let bad=0; const A=(c,m)=>{if(!c){console.log('❌ '+m);bad++}else console.log('✓ '+m)};
const goBlock=async(p,t)=>{if(await p.locator('.row').count()===0){const ov=p.locator('[data-a="overview"]');if(await ov.count()){await ov.click();await p.waitForTimeout(320)}}
 const r=p.locator('.row'),n=await r.count();for(let i=0;i<n;i++){if((await r.nth(i).textContent()).includes(t)){await r.nth(i).click();await p.waitForTimeout(400);return}}throw new Error('нет блока: '+t)};
(async()=>{
const b=await chromium.launch();const p=await b.newPage({viewport:{width:390,height:900}});
p.on('pageerror',e=>{console.log('❌ JS ERROR: '+e.message);bad++});
p.on('dialog',d=>d.accept());
await p.goto(URL); await p.waitForTimeout(800);
const names=await p.locator('.who button').allTextContents();
A(names.join()==='Диас,Данияр','на входе Диас и Данияр');
A((await p.locator('#view').textContent()).includes('PIN у обоих — 1234'),'подсказка с PIN и кодом видна');
await p.click('[data-a^="pick:"] >> nth=1'); await p.waitForTimeout(300);
await p.fill('#lg-pin','1234'); await p.click('[data-a="login"]'); await p.waitForTimeout(450);
A((await p.locator('#cloud').textContent()).includes('Данияр'),'вошли Данияром');
A((await p.locator('#view').textContent()).includes('Это демо'),'карточка демо на месте');
A((await p.locator('#view').textContent()).includes('висит 4 смен'),'горящая задача на месте');
await p.click('[data-a^="open:"]'); await p.waitForTimeout(500);
A(await p.locator('.row').count()===15,'в смене передачи 14 блоков плюс задачи');
await goBlock(p,'Workly');
A((await p.locator('#b-workly').textContent()).includes('Динара'),'табель заполнен');
await goBlock(p,'Команда');
A((await p.locator('#b-staff').textContent()).includes('На грани, устал'),'заметки по людям на месте');
await p.click('.tab[data-v="guests"]'); await p.waitForTimeout(450);
A(await p.locator('.blk').count()===6,'шесть гостей в книге');
A((await p.locator('#view').textContent()).includes('Таблица предпочтений'),'таблица предпочтений есть');
await p.click('.tab[data-v="more"]'); await p.waitForTimeout(300);
await p.click('[data-a="goto:rep"]'); await p.waitForTimeout(500);
const rep=await p.locator('#view').textContent();
A(rep.includes('готовность зала до открытия'),'отчёт считает показатели');
A(!rep.includes('Новый код восстановления'),'менеджер не может перевыпускать код — это право управляющего');
// восстановление по коду
await p.click('#cloud'); await p.waitForTimeout(450);
await p.click('[data-a="recon"]'); await p.waitForTimeout(350);
await p.fill('#rc-code','DEMO-CODE'); await p.fill('#rc-pin','4321'); await p.fill('#rc-pin2','4321');
await p.click('[data-a="dorecover"]'); await p.waitForTimeout(500);
A(await p.locator('.tabs').isVisible(),'код восстановления демо работает');
await b.close();
console.log(bad?('\n'+bad+' не прошло'):'\nвсе проверки зелёные');process.exit(bad?1:0);})();
