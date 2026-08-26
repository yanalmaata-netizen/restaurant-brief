/**
 * ДОБАВЛЯТЬ ОТДЕЛЬНЫМ ФАЙЛОМ. Ничего в проекте не стирать.
 *
 * Все имена в этом файле начинаются с bq / BQ_, поэтому они не могут
 * пересечься с боевым скриптом приёма предзаказов, который лежит рядом.
 *
 * DIO Grand Cafe — сборка листа «Банкеты» из журнала предзаказов.
 *
 * Ничего не ломает: лист «Лист1», куда пишет калькулятор, не трогается вообще.
 * Скрипт читает его, распаковывает ссылки и собирает рядом чистый лист «Банкеты»,
 * где одна заявка — одна строка.
 *
 * Установка: Расширения → Apps Script → вставить → Сохранить → запустить bqSetup() один раз.
 */

var BQ_SRC_SHEET = 'Лист1';        // журнал калькулятора, только чтение
var BQ_DST_SHEET = 'Банкеты';      // рабочий лист, пересобирается
var BQ_KIT_SHEET = 'Состав заказа'; // сводка блюд для кухни
var BQ_SITE_URL  = 'https://dio-banket.pages.dev';
var BQ_REBUILD_EVERY_MIN = 5;

var BQ_HALLS = { herc: 'Геркулес', gorg: 'Горгона', dion: 'Дионис', fl1: 'Первый этаж' };

var BQ_STATUSES = ['Заявка', 'КП отправлено', 'Подтверждён', 'Проведён', 'Отказ'];

var BQ_COLS = ['№', 'Статус', 'Гость', 'Телефон', 'Дата', 'Время', 'Зал', 'Гостей',
            'Повод', 'Сумма', 'На гостя', 'Скидка %', 'Предоплата', 'Остаток',
            'Оплата', 'КП до', 'Менеджер', 'Тайминг подачи', 'Заметка',
            'Правок', 'Последняя правка', 'Тест', 'Ссылка', 'Ключ'];

// колонки, которые заполняет человек и которые нельзя затирать при пересборке
var BQ_MANUAL = ['Статус', 'Заметка'];

/** Меню в самой таблице — чтобы не искать функции в редакторе скриптов. */
function bqOnOpen() {
  SpreadsheetApp.getUi().createMenu('DIO')
    .addItem('Собрать листы сейчас', 'bqRebuild')
    .addItem('Проверить настройку', 'bqSelfCheck')
    .addToUi();
}

/**
 * Показывает, что именно получилось: сколько заявок, сколько дублей схлопнулось,
 * читается ли меню с сайта. Запускать можно сколько угодно раз.
 */
function bqSelfCheck() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var out = [];

  var src = ss.getSheetByName(BQ_SRC_SHEET);
  if (!src) {
    bqSay_('Не найден лист «' + BQ_SRC_SHEET + '».\n\nПереименуйте его обратно или поправьте' +
         ' строку BQ_SRC_SHEET в начале скрипта.');
    return;
  }
  var raw = Math.max(0, src.getLastRow() - 1);
  out.push('Строк в журнале: ' + raw);

  var t0 = new Date().getTime();
  bqRebuild();
  var tRebuild = new Date().getTime() - t0;

  var dst = ss.getSheetByName(BQ_DST_SHEET);
  var kept = dst ? Math.max(0, dst.getLastRow() - 1) : 0;
  out.push('Заявок после схлопывания дублей: ' + kept);
  out.push('Лишних строк убрано: ' + Math.max(0, raw - kept));

  if (dst && kept) {
    var head = dst.getRange(1, 1, 1, BQ_COLS.length).getValues()[0];
    var testAt = head.indexOf('Тест') + 1;
    var tests = dst.getRange(2, testAt, kept, 1).getValues()
      .filter(function (r) { return r[0] === 'тест'; }).length;
    out.push('Из них помечено как обкатка: ' + tests);
  }

  var t1 = new Date().getTime();
  try {
    var menu = bqLoadMenu_();
    var n = 0;
    for (var k in menu.byCode) n++;
    out.push('Меню прочитано: ' + menu.cats.length + ' разделов, ' + n + ' блюд');
  } catch (e) {
    out.push('Меню НЕ прочиталось: ' + e.message);
    out.push('Лист «' + BQ_KIT_SHEET + '» останется пустым.');
  }
  var tMenu = new Date().getTime() - t1;

  var t2 = new Date().getTime();
  try { bqRebuildKitchen(); } catch (e) { out.push('Кухонный лист: ' + e.message); }
  var tKit = new Date().getTime() - t2;

  var kit = ss.getSheetByName(BQ_KIT_SHEET);
  out.push('Строк для кухни по предстоящим банкетам: ' + (kit ? Math.max(0, kit.getLastRow() - 1) : 0));

  out.push('');
  out.push('Время: «Банкеты» ' + Math.round(tRebuild / 1000) + ' с, меню ' +
           Math.round(tMenu / 1000) + ' с, кухня ' + Math.round(tKit / 1000) + ' с.');

  bqSay_(out.join('\n'));
}

function bqSay_(text) {
  try { SpreadsheetApp.getUi().alert(text); }
  catch (e) { Logger.log(text); }   // запуск из редактора, без открытой таблицы
}

/** Разовая установка: собирает листы, вешает автообновление и меню. */
function bqSetup() {
  bqReset();                       // снять свои триггеры, если остались с прошлой попытки
  ScriptApp.newTrigger('bqRebuild').timeBased().everyMinutes(BQ_REBUILD_EVERY_MIN).create();
  ScriptApp.newTrigger('bqRebuildKitchen').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('bqOnOpen').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onOpen().create();
  bqSelfCheck();                   // пересборку делает он, второй раз не нужно
}

/** Снимает все свои триггеры. Боевой doPost не трогает. */
function bqReset() {
  var mine = { bqRebuild: 1, bqRebuildKitchen: 1, bqOnOpen: 1 };
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (mine[t.getHandlerFunction()]) { ScriptApp.deleteTrigger(t); n++; }
  });
  return n;
}

/** Пересобирает лист «Состав заказа». Отдельно от «Банкетов» — ходит за меню в сеть. */
function bqRebuildKitchen() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dst = ss.getSheetByName(BQ_DST_SHEET);
  if (!dst || dst.getLastRow() < 2) { bqKitchenNote_(ss, 'Сначала соберите лист «' + BQ_DST_SHEET + '».'); return; }

  var vals = dst.getDataRange().getValues();
  var head = vals[0];
  var at = {};
  head.forEach(function (h, i) { at[h] = i; });

  var list = [], statusOf = {};
  for (var r = 1; r < vals.length; r++) {
    var row = vals[r], key = row[at['Ключ']];
    if (!key) continue;
    var rec = bqParseRow_(bqSyntheticRow_(row, at), bqSyntheticIdx_());
    if (!rec) continue;
    rec.isTest = row[at['Тест']] === 'тест';
    list.push(rec);
    statusOf[rec.key] = row[at['Статус']];
  }
  bqWriteKitchen_(ss, list, statusOf);
}

/* лист «Банкеты» хранит исходную ссылку — по ней состав восстанавливается точно
   так же, как при первом разборе, без повторного чтения журнала */
function bqSyntheticRow_(row, at) {
  return ['', '', '', '', '', '', '', row[at['Ссылка']], '', ''];
}
function bqSyntheticIdx_() {
  return { 'Дата создания': 0, 'Менеджер': 1, 'Гость': 2, 'Дата банкета': 3, 'Зал': 4,
           'Количество гостей': 5, 'Сумма': 6, 'Ссылка': 7, 'Повод': 8, 'Комментарий менеджера': 9 };
}

/** Пересобирает лист «Банкеты». Безопасно запускать сколько угодно раз. */
function bqRebuild() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var src = ss.getSheetByName(BQ_SRC_SHEET);
  if (!src) throw new Error('Не найден лист «' + BQ_SRC_SHEET + '»');

  var rows = src.getDataRange().getValues();
  if (rows.length < 2) return;

  var head = rows[0].map(function (h) { return String(h).trim(); });
  var idx = {};
  head.forEach(function (h, i) { if (h) idx[h] = i; });

  var manual = bqReadManual_(ss);

  // ключ -> запись; побеждает самая свежая правка
  var byKey = {};
  for (var r = 1; r < rows.length; r++) {
    var rec = bqParseRow_(rows[r], idx);
    if (!rec) continue;
    var prev = byKey[rec.key];
    if (!prev) {
      rec.edits = 1;
      byKey[rec.key] = rec;
    } else {
      rec.edits = prev.edits + 1;
      // если новая строка старее — оставляем прежнюю, но счётчик правок растёт
      if (rec.created >= prev.created) { byKey[rec.key] = rec; }
      else { prev.edits = rec.edits; }
    }
  }

  var list = Object.keys(byKey).map(function (k) { return byKey[k]; });
  list.sort(function (a, b) {
    var ad = a.date ? a.date.getTime() : 0, bd = b.date ? b.date.getTime() : 0;
    return ad - bd;
  });

  var out = list.map(function (x, i) { return bqToRow_(x, i + 1, manual[x.key] || {}); });
  bqWriteSheet_(ss, out);

  // кухонный лист собирается отдельно: он ходит в интернет за меню, и если сайт
  // отвечает медленно, лист «Банкеты» из-за этого страдать не должен

}

/* ------------------------------------------------------------------ разбор */

function bqParseRow_(row, idx) {
  var link = bqPickLink_(row, idx);
  var created = bqToDate_(row[idx['Дата создания']]);
  var p = link ? bqDecodeLink_(link) : null;

  // без ссылки строка бесполезна — в ней нет ни телефона, ни срока КП
  if (!p) return null;

  var name = String(p.n || bqCell_(row, idx, 'Гость') || '').trim();
  var phone = bqNormPhone_(p.p || bqExtractPhone_(bqCell_(row, idx, 'Гость')));

  // имя в журнале часто слеплено с телефоном — отрезаем хвост
  name = name.replace(/[+\d][\d\s().-]{6,}$/, '').trim();

  var date = p.d ? bqToDate_(p.d) : bqToDate_(bqCell_(row, idx, 'Дата банкета'));
  var hall = BQ_HALLS[p.h] || String(bqCell_(row, idx, 'Зал') || '').split('·')[0].trim();
  var guests = bqNum_(p.g) || bqNum_(bqCell_(row, idx, 'Количество гостей'));
  var total = bqNum_(bqCell_(row, idx, 'Сумма'));
  var prepay = bqNum_(p.r);

  return {
    key: p.oid ? 'oid:' + p.oid : bqMakeKey_(phone, name, date, hall),
    created: created || new Date(0),
    name: name,
    phone: phone,
    date: date,
    time: String(p.et || '').trim(),
    hall: hall,
    guests: guests,
    occasion: String(p.e || bqCell_(row, idx, 'Повод') || '').trim(),
    total: total,
    discount: bqNum_(p.dc),
    prepay: prepay,
    pay: String(p.pm || '').trim(),
    validUntil: p.vu ? bqToDate_(p.vu) : null,
    manager: String(p.mg || bqCell_(row, idx, 'Менеджер') || '').trim(),
    timing: String(p.bn || bqCell_(row, idx, 'Комментарий менеджера') || '').replace(/\\n/g, '\n').trim(),
    items: p.i || [],
    ver: +p.v || 1,
    isTest: bqLooksLikeTest_(phone, name),
    link: link,
    edits: 1
  };
}

/** Запасной ключ для ссылок без oid: телефон важнее имени, дальше дата и зал.
    Ссылки, выданные калькулятором с v68, несут собственный ключ заявки — он
    точнее, потому что переживает смену телефона, даты или зала в смете. */
function bqMakeKey_(phone, name, date, hall) {
  var who = phone || (name ? name.toLowerCase() : '?');
  var d = date ? Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '?';
  return who + '|' + d + '|' + (hall || '?');
}

function bqPickLink_(row, idx) {
  if (idx['Ссылка'] != null) {
    var v = String(row[idx['Ссылка']] || '');
    if (v.indexOf('#') > -1) return v;
  }
  for (var i = 0; i < row.length; i++) {
    var s = String(row[i] || '');
    if (/#[om]=/.test(s)) return s;
  }
  return '';
}

function bqDecodeLink_(link) {
  var m = String(link).match(/#[om]=([A-Za-z0-9+/=_-]+)/);
  if (!m) return null;
  var b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  try {
    var json = Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString('UTF-8');
    return JSON.parse(json);
  } catch (err) {
    return null;
  }
}

/* -------------------------------------------------------------- нормализация */

function bqNormPhone_(raw) {
  var d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 11 && (d[0] === '8' || d[0] === '7')) d = '7' + d.slice(1);
  else if (d.length === 10) d = '7' + d;
  else if (d.length !== 11) return '';       // мусор вроде 5555555 отбрасываем
  return '+' + d[0] + ' ' + d.slice(1, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7, 9) + ' ' + d.slice(9);
}

function bqExtractPhone_(s) {
  var m = String(s == null ? '' : s).match(/[+\d][\d\s().-]{6,}/);
  return m ? m[0] : '';
}

/** Обкатка и тестовые заявки: повторяющиеся цифры или номер не той длины. */
function bqLooksLikeTest_(phone, name) {
  var digits = String(phone).replace(/\D/g, '');
  if (digits) {
    // у живого номера цифры разнообразные; 5555555555 и 8800000000 — нет
    var uniq = {}, body = digits.slice(1);
    for (var i = 0; i < body.length; i++) uniq[body[i]] = 1;
    if (Object.keys(uniq).length <= 2) return true;
  }
  if (!digits) {
    var n = String(name || '').toLowerCase();
    if (!n || n.length < 3) return true;
    if (/^(ян|yan|ya|ss+|sss|hv?|тест|test|ррр|ииро|ан|м)$/.test(n)) return true;
  }
  return false;
}

function bqNum_(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  var s = String(v).replace(/[\s  ]/g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function bqToDate_(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function bqCell_(row, idx, name) {
  return idx[name] == null ? '' : row[idx[name]];
}

/* ------------------------------------------------------------------ запись */

function bqToRow_(x, no, keep) {
  var perGuest = x.guests ? Math.round(x.total / x.guests) : '';
  var left = x.total - x.prepay;
  return [
    'B-' + ('0000' + no).slice(-4),
    keep['Статус'] || 'Заявка',
    x.name,
    x.phone,
    x.date,
    x.time,
    x.hall,
    x.guests || '',
    x.occasion,
    x.total || '',
    perGuest,
    x.discount || '',
    x.prepay || '',
    left > 0 ? left : '',
    x.pay,
    x.validUntil,
    x.manager,
    x.timing,
    keep['Заметка'] || '',
    x.edits,
    x.created,
    x.isTest ? 'тест' : '',
    x.link,
    x.key
  ];
}

/** Сохраняем то, что менеджеры вписали руками, чтобы пересборка это не стёрла. */
function bqReadManual_(ss) {
  var sh = ss.getSheetByName(BQ_DST_SHEET);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var vals = sh.getDataRange().getValues();
  var head = vals[0];
  var kAt = head.indexOf('Ключ');
  if (kAt < 0) return out;
  for (var r = 1; r < vals.length; r++) {
    var key = vals[r][kAt];
    if (!key) continue;
    var keep = {};
    BQ_MANUAL.forEach(function (name) {
      var at = head.indexOf(name);
      if (at > -1 && vals[r][at] !== '') keep[name] = vals[r][at];
    });
    out[key] = keep;
  }
  return out;
}

function bqWriteSheet_(ss, rows) {
  var sh = ss.getSheetByName(BQ_DST_SHEET) || ss.insertSheet(BQ_DST_SHEET);
  sh.clear();

  sh.getRange(1, 1, 1, BQ_COLS.length).setValues([BQ_COLS])
    .setFontWeight('bold').setBackground('#F1ECE1');
  sh.setFrozenRows(1);

  if (!rows.length) return;
  sh.getRange(2, 1, rows.length, BQ_COLS.length).setValues(rows);

  var c = function (name) { return BQ_COLS.indexOf(name) + 1; };

  sh.getRange(2, c('Дата'), rows.length, 1).setNumberFormat('dd.MM.yyyy');
  sh.getRange(2, c('КП до'), rows.length, 1).setNumberFormat('dd.MM.yyyy');
  sh.getRange(2, c('Последняя правка'), rows.length, 1).setNumberFormat('dd.MM.yyyy HH:mm');
  ['Сумма', 'На гостя', 'Предоплата', 'Остаток'].forEach(function (n) {
    sh.getRange(2, c(n), rows.length, 1).setNumberFormat('# ##0 ₸');
  });

  sh.getRange(2, c('Статус'), rows.length, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(BQ_STATUSES, true).build());

  bqPaint_(sh, rows.length, c);

  sh.hideColumns(c('Ссылка'));
  sh.hideColumns(c('Ключ'));
}

/** Подсветка: истекающее КП, отказы, тестовые строки. */
function bqPaint_(sh, n, c) {
  var body = sh.getRange(2, 1, n, BQ_COLS.length);
  var a1 = function (name) { return '$' + bqColLetter_(c(name)) + '2'; };

  var rules = [
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(
      '=' + a1('Тест') + '="тест"').setFontColor('#9A9284').setRanges([body]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(
      '=' + a1('Статус') + '="Отказ"').setFontColor('#9A9284').setRanges([body]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(
      '=AND(' + a1('КП до') + '<>"",' + a1('КП до') + '<TODAY()+3,' +
      a1('Статус') + '="КП отправлено")').setBackground('#F6E6E2').setRanges([body]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(
      '=' + a1('Статус') + '="Подтверждён"').setBackground('#E6EEE6').setRanges([body]).build()
  ];
  sh.setConditionalFormatRules(rules);
}

function bqColLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}

/* ══════════════════════════ лист для кухни ══════════════════════════ */

var BQ_KIT_COLS = ['Дата', 'Время', 'Зал', 'Гость', 'Гостей', 'Раздел', 'Блюдо',
                'Кол-во', 'Ед.', 'Примечание', 'Точность', 'Ключ'];

/** Тот же код блюда, что считает калькулятор (v67+). Совпадать обязан посимвольно. */
function bqDishCode_(name) {
  var h = 0x811c9dc5;
  var t = String(name).toLowerCase().replace(/\s+/g, ' ').trim();
  for (var i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    // Math.imul в Apps Script есть, но пишем через явное умножение для надёжности
    h = ((h & 0xffff) * 0x01000193 + ((((h >>> 16) * 0x01000193) & 0xffff) << 16)) >>> 0;
  }
  return ('0000000' + h.toString(36)).slice(-5);
}

/**
 * Меню тянем с самого сайта и кешируем на 6 часов: так лист для кухни всегда
 * сверяется с тем меню, которое реально стоит в калькуляторе, и его не надо
 * править руками после каждого изменения блюд.
 */
function bqLoadMenu_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('bq_menu_v2');
  if (hit) { try { return bqExpandMenu_(JSON.parse(hit)); } catch (e) {} }

  var html = UrlFetchApp.fetch(BQ_SITE_URL, { muteHttpExceptions: true }).getContentText();
  var m = html.match(/const MENU\s*=\s*\{([\s\S]*?)\n\};/);
  if (!m) throw new Error('Не удалось прочитать меню с ' + BQ_SITE_URL);

  var cats = [], byCode = {}, byIndex = {};
  var catRe = /\n {2}'([^']+)'\s*:\s*\[([\s\S]*?)\n {2}\]/g, cm;
  while ((cm = catRe.exec(m[1])) !== null) {
    var cat = cm[1], list = [];
    var dishRe = /\[\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*'([^']*)'/g, dm;
    while ((dm = dishRe.exec(cm[2])) !== null) {
      var dish = { name: dm[1].replace(/\\'/g, "'"), price: +dm[2], unit: dm[3], cat: cat };
      list.push(dish);
      var code = bqDishCode_(dish.name);
      if (!byCode[code]) byCode[code] = dish;
    }
    byIndex[cats.length] = list;
    cats.push(cat);
  }
  /* в кеш кладём плоский список: полная структура дублирует каждое блюдо дважды
     и перестаёт влезать в лимит кеша — тогда меню тянулось бы с сайта заново
     при каждом запуске */
  var flat = { cats: cats, dishes: [] };
  cats.forEach(function (cat, ci) {
    byIndex[ci].forEach(function (d) { flat.dishes.push([d.name, d.price, d.unit, ci]); });
  });
  try { cache.put('bq_menu_v2', JSON.stringify(flat), 21600); } catch (e) {}
  return { cats: cats, byCode: byCode, byIndex: byIndex };
}

/** Разворачивает плоский список из кеша обратно в рабочую структуру. */
function bqExpandMenu_(flat) {
  var byCode = {}, byIndex = {};
  flat.cats.forEach(function (c, i) { byIndex[i] = []; });
  flat.dishes.forEach(function (d) {
    var dish = { name: d[0], price: d[1], unit: d[2], cat: flat.cats[d[3]] };
    byIndex[d[3]].push(dish);
    var code = bqDishCode_(dish.name);
    if (!byCode[code]) byCode[code] = dish;
  });
  return { cats: flat.cats, byCode: byCode, byIndex: byIndex };
}

/** Собирает лист «Состав заказа»: строка на блюдо, по датам банкетов. */
function bqWriteKitchen_(ss, list, statusOf) {
  var menu;
  try { menu = bqLoadMenu_(); }
  catch (e) { bqKitchenNote_(ss, 'Меню не загрузилось: ' + e.message); return; }

  var today = new Date(); today.setHours(0, 0, 0, 0);
  var rows = [];

  list.forEach(function (x) {
    var status = statusOf[x.key] || '';
    // кухне нужны предстоящие живые банкеты, не архив и не обкатка
    if (x.isTest || status === 'Отказ') return;
    if (!x.date || x.date < today) return;

    x.items.forEach(function (it) {
      var dish = null, exact = '';
      if (x.ver >= 2) {
        dish = menu.byCode[it[0]] || null;
      } else {
        // старый формат: позиции по номерам, а номера с тех пор могли съехать
        var cat = menu.byIndex[it[0]];
        dish = cat ? (cat[it[1]] || null) : null;
        exact = 'сверить со сметой';
      }
      var qty  = x.ver >= 2 ? it[1] : it[2];
      var note = (x.ver >= 2 ? it[2] : it[3]) || '';
      if (!dish) {
        rows.push([x.date, x.time, x.hall, x.name, x.guests, '—',
                   'позиции нет в меню', qty, '', note, 'проверить', x.key]);
        return;
      }
      rows.push([x.date, x.time, x.hall, x.name, x.guests, dish.cat,
                 dish.name, qty, dish.unit, note, exact, x.key]);
    });
  });

  rows.sort(function (a, b) {
    var d = (a[0] ? a[0].getTime() : 0) - (b[0] ? b[0].getTime() : 0);
    if (d) return d;
    if (a[2] !== b[2]) return String(a[2]) < String(b[2]) ? -1 : 1;
    if (a[5] !== b[5]) return String(a[5]) < String(b[5]) ? -1 : 1;
    return String(a[6]) < String(b[6]) ? -1 : 1;
  });

  var sh = ss.getSheetByName(BQ_KIT_SHEET) || ss.insertSheet(BQ_KIT_SHEET);
  sh.clear();
  sh.getRange(1, 1, 1, BQ_KIT_COLS.length).setValues([BQ_KIT_COLS])
    .setFontWeight('bold').setBackground('#F1ECE1');
  sh.setFrozenRows(1);
  if (!rows.length) { bqKitchenNote_(ss, 'Предстоящих банкетов нет.'); return; }

  sh.getRange(2, 1, rows.length, BQ_KIT_COLS.length).setValues(rows);
  sh.getRange(2, 1, rows.length, 1).setNumberFormat('dd.MM.yyyy');

  var c = BQ_KIT_COLS.indexOf('Точность') + 1;
  var body = sh.getRange(2, 1, rows.length, BQ_KIT_COLS.length);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + bqColLetter_(c) + '2<>""')
      .setBackground('#F7EDD8').setRanges([body]).build()
  ]);
  sh.hideColumns(BQ_KIT_COLS.indexOf('Ключ') + 1);
}

function bqKitchenNote_(ss, text) {
  var sh = ss.getSheetByName(BQ_KIT_SHEET) || ss.insertSheet(BQ_KIT_SHEET);
  sh.clear();
  sh.getRange(1, 1).setValue(text).setFontColor('#9A9284');
}
