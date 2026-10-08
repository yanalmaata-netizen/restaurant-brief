/* Дымовой тест приложения: проходит путь менеджера от первого входа
   до принятой смены и отчёта. Запуск:

     python3 smena/build-live.py /tmp/live.html
     cd /tmp && npx http-server -p 8791 -s . &
     NODE_PATH=$(npm root -g) node smena/test-smoke.js http://127.0.0.1:8791/live.html
*/
const {chromium} = require('playwright');
const URL = process.argv[2] || 'http://127.0.0.1:8791/live.html';
let bad = 0;
const A = (c, m) => { if (!c) { console.log('❌ ' + m); bad++; } else console.log('✓ ' + m); };

const goBlock = async (p, title) => {
  if (await p.locator('.row').count() === 0) {
    const ov = p.locator('[data-a="overview"]');
    if (await ov.count()) { await ov.click(); await p.waitForTimeout(320); }
  }
  const rows = p.locator('.row'), n = await rows.count();
  for (let i = 0; i < n; i++) {
    if ((await rows.nth(i).textContent()).includes(title)) {
      await rows.nth(i).click(); await p.waitForTimeout(400); return;
    }
  }
  throw new Error('нет блока в обзоре: ' + title);
};
const toOverview = async (p) => {
  const ov = p.locator('[data-a="overview"]');
  if (await ov.count()) { await ov.click(); await p.waitForTimeout(320); }
};
const acceptAll = async (p) => {
  for (let guard = 0; guard < 40; guard++) {
    await toOverview(p);
    const need = p.locator('.row-s.need');
    if (await need.count() === 0) break;
    await need.first().locator('xpath=..').click(); await p.waitForTimeout(260);
    const ack = p.locator('[data-a^="ack:"]');
    if (await ack.count()) { await ack.first().click(); await p.waitForTimeout(220); }
  }
};

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({viewport: {width: 390, height: 900}});
  p.on('pageerror', e => { console.log('❌ JS ERROR: ' + e.message); bad++; });
  p.on('dialog', d => d.accept());
  await p.goto(URL); await p.waitForTimeout(700);

  // первый вход и код восстановления
  await p.fill('#lg-name', 'Диас'); await p.fill('#lg-pin', '1111'); await p.fill('#lg-pin2', '1111');
  await p.click('[data-a="first"]'); await p.waitForTimeout(500);
  const code = (await p.locator('.pin').first().textContent()).trim();
  A(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code), 'первый вход выдал код восстановления: ' + code);
  await p.click('[data-a="codeok"]'); await p.waitForTimeout(400);
  A(await p.locator('.tabs').isVisible(), 'приложение открылось');

  // второй менеджер
  await p.click('.tab[data-v="more"]'); await p.waitForTimeout(300);
  await p.click('[data-a="goto:rep"]'); await p.waitForTimeout(450);
  await p.fill('#sa-name', 'Данияр'); await p.fill('#sa-pin', '2222');
  await p.click('[data-a="staffadd"]'); await p.waitForTimeout(400);
  A((await p.locator('#view').textContent()).includes('Данияр'), 'второй менеджер заведён');

  // смена передачи
  await p.click('.tab[data-v="home"]'); await p.waitForTimeout(350);
  await p.selectOption('#ns-part', 'pass');
  await p.click('[data-a="new"]'); await p.waitForTimeout(500);
  A(await p.locator('.row').count() === 15, 'в смене передачи 14 блоков плюс задачи');

  await toOverview(p);
  await p.selectOption('[data-h="to"]', 'Данияр'); await p.waitForTimeout(250);
  await p.click('[data-a="send"]'); await p.waitForTimeout(400);
  const err = await p.locator('.err').textContent();
  A(err.includes('Касса') && err.includes('Учёт времени'), 'пустую смену передать не даёт');

  await goBlock(p, 'Касса');
  await p.fill('[data-b="money"][data-k="cash"]', '214000');
  await p.check('[data-b="money"][data-k="__confirm"]');
  await goBlock(p, 'Кухня');
  await p.fill('[data-b="kitchen"][data-k="stop"]', 'Дорада, устрицы');
  await p.check('[data-b="kitchen"][data-k="__confirm"]');
  await goBlock(p, 'Резервы и банкеты');
  await p.check('[data-b="banquets"][data-k="__confirm"]');
  await goBlock(p, 'Workly');
  await p.check('[data-b="workly"][data-k="__confirm"]');
  await goBlock(p, 'Журнал смены');
  await p.fill('#log-new', '21:10 инкассацию забрали');
  await p.click('[data-a="logadd"]'); await p.waitForTimeout(350);
  A(await p.locator('.le').count() === 1, 'запись легла в журнал смены');

  await toOverview(p);
  await p.click('[data-a="send"]'); await p.waitForTimeout(450);
  A(await p.locator('.err').count() === 0, 'заполненная смена передана');

  // приём вторым менеджером
  await p.click('#cloud'); await p.waitForTimeout(450);
  await p.click('[data-a^="pick:"] >> nth=1'); await p.waitForTimeout(300);
  await p.fill('#lg-pin', '2222'); await p.click('[data-a="login"]'); await p.waitForTimeout(450);
  A((await p.locator('#cloud').textContent()).includes('Данияр'), 'вошёл принимающий');
  await p.click('[data-a^="open:"]'); await p.waitForTimeout(450);
  A(await p.locator('.row-s.need').count() === 14, 'все блоки ждут подтверждения');
  await acceptAll(p);
  A(await p.locator('.row-s.need').count() === 0, 'все блоки приняты');
  await p.click('[data-a="accept"]'); await p.waitForTimeout(500);
  A((await p.locator('#view').textContent()).includes('Начать передачу'), 'смена принята');

  // отчёт
  await p.click('.tab[data-v="more"]'); await p.waitForTimeout(300);
  await p.click('[data-a="goto:rep"]'); await p.waitForTimeout(500);
  const rep = await p.locator('#view').textContent();
  A(rep.includes('из них принято 1'), 'отчёт увидел принятую смену');
  A(rep.includes('чек-лист закрытия'), 'показатели на месте');

  // восстановление доступа по коду
  await p.click('#cloud'); await p.waitForTimeout(450);
  await p.click('[data-a="recon"]'); await p.waitForTimeout(350);
  await p.fill('#rc-code', code); await p.fill('#rc-pin', '9999'); await p.fill('#rc-pin2', '9999');
  await p.click('[data-a="dorecover"]'); await p.waitForTimeout(500);
  A(await p.locator('.tabs').isVisible(), 'забытый PIN сброшен по коду восстановления');

  await b.close();
  console.log(bad ? ('\n' + bad + ' проверок не прошло') : '\nвсе проверки зелёные');
  process.exit(bad ? 1 : 0);
})();
