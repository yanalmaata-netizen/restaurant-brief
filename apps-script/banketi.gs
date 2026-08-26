/**
 * DIO Grand Cafe — сборка листа «Банкеты» из журнала предзаказов.
 *
 * Ничего не ломает: лист «Лист1», куда пишет калькулятор, не трогается вообще.
 * Скрипт читает его, распаковывает ссылки и собирает рядом чистый лист «Банкеты»,
 * где одна заявка — одна строка.
 *
 * Установка: Расширения → Apps Script → вставить → Сохранить → запустить setup() один раз.
 */

var SRC_SHEET = 'Лист1';        // журнал калькулятора, только чтение
var DST_SHEET = 'Банкеты';      // рабочий лист, пересобирается
var KIT_SHEET = 'Состав заказа'; // сводка блюд для кухни
var SITE_URL  = 'https://dio-banket.pages.dev';
var REBUILD_EVERY_MIN = 5;

var HALLS = { herc: 'Геркулес', gorg: 'Горгона', dion: 'Дионис', fl1: 'Первый этаж' };

var STATUSES = ['Заявка', 'КП отправлено', 'Подтверждён', 'Проведён', 'Отказ'];

var COLS = ['№', 'Статус', 'Гость', 'Телефон', 'Дата', 'Время', 'Зал', 'Гостей',
            'Повод', 'Сумма', 'На гостя', 'Скидка %', 'Предоплата', 'Остаток',
            'Оплата', 'КП до', 'Менеджер', 'Тайминг подачи', 'Заметка',
            'Правок', 'Последняя правка', 'Тест', 'Ссылка', 'Ключ'];

// колонки, которые заполняет человек и которые нельзя затирать при пересборке
var MANUAL = ['Статус', 'Заметка'];

/** Разовая установка: создаёт лист и вешает автообновление. */
function setup() {
  rebuild();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'rebuild') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('rebuild').timeBased().everyMinutes(REBUILD_EVERY_MIN).create();
}

/** Пересобирает лист «Банкеты». Безопасно запускать сколько угодно раз. */
function rebuild() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var src = ss.getSheetByName(SRC_SHEET);
  if (!src) throw new Error('Не найден лист «' + SRC_SHEET + '»');

  var rows = src.getDataRange().getValues();
  if (rows.length < 2) return;

  var head = rows[0].map(function (h) { return String(h).trim(); });
  var idx = {};
  head.forEach(function (h, i) { if (h) idx[h] = i; });

  var manual = readManual_(ss);

  // ключ -> запись; побеждает самая свежая правка
  var byKey = {};
  for (var r = 1; r < rows.length; r++) {
    var rec = parseRow_(rows[r], idx);
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

  var out = list.map(function (x, i) { return toRow_(x, i + 1, manual[x.key] || {}); });
  writeSheet_(ss, out);

  var statusOf = {};
  out.forEach(function (r) { statusOf[r[COLS.indexOf('Ключ')]] = r[COLS.indexOf('Статус')]; });
  writeKitchen_(ss, list, statusOf);
}

/* ------------------------------------------------------------------ разбор */

function parseRow_(row, idx) {
  var link = pickLink_(row, idx);
  var created = toDate_(row[idx['Дата создания']]);
  var p = link ? decodeLink_(link) : null;

  // без ссылки строка бесполезна — в ней нет ни телефона, ни срока КП
  if (!p) return null;

  var name = String(p.n || cell_(row, idx, 'Гость') || '').trim();
  var phone = normPhone_(p.p || extractPhone_(cell_(row, idx, 'Гость')));

  // имя в журнале часто слеплено с телефоном — отрезаем хвост
  name = name.replace(/[+\d][\d\s().-]{6,}$/, '').trim();

  var date = p.d ? toDate_(p.d) : toDate_(cell_(row, idx, 'Дата банкета'));
  var hall = HALLS[p.h] || String(cell_(row, idx, 'Зал') || '').split('·')[0].trim();
  var guests = num_(p.g) || num_(cell_(row, idx, 'Количество гостей'));
  var total = num_(cell_(row, idx, 'Сумма'));
  var prepay = num_(p.r);

  return {
    key: p.oid ? 'oid:' + p.oid : makeKey_(phone, name, date, hall),
    created: created || new Date(0),
    name: name,
    phone: phone,
    date: date,
    time: String(p.et || '').trim(),
    hall: hall,
    guests: guests,
    occasion: String(p.e || cell_(row, idx, 'Повод') || '').trim(),
    total: total,
    discount: num_(p.dc),
    prepay: prepay,
    pay: String(p.pm || '').trim(),
    validUntil: p.vu ? toDate_(p.vu) : null,
    manager: String(p.mg || cell_(row, idx, 'Менеджер') || '').trim(),
    timing: String(p.bn || cell_(row, idx, 'Комментарий менеджера') || '').replace(/\\n/g, '\n').trim(),
    items: p.i || [],
    ver: +p.v || 1,
    isTest: looksLikeTest_(phone, name),
    link: link,
    edits: 1
  };
}

/** Запасной ключ для ссылок без oid: телефон важнее имени, дальше дата и зал.
    Ссылки, выданные калькулятором с v68, несут собственный ключ заявки — он
    точнее, потому что переживает смену телефона, даты или зала в смете. */
function makeKey_(phone, name, date, hall) {
  var who = phone || (name ? name.toLowerCase() : '?');
  var d = date ? Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '?';
  return who + '|' + d + '|' + (hall || '?');
}

function pickLink_(row, idx) {
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

function decodeLink_(link) {
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

function normPhone_(raw) {
  var d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 11 && (d[0] === '8' || d[0] === '7')) d = '7' + d.slice(1);
  else if (d.length === 10) d = '7' + d;
  else if (d.length !== 11) return '';       // мусор вроде 5555555 отбрасываем
  return '+' + d[0] + ' ' + d.slice(1, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7, 9) + ' ' + d.slice(9);
}

function extractPhone_(s) {
  var m = String(s == null ? '' : s).match(/[+\d][\d\s().-]{6,}/);
  return m ? m[0] : '';
}

/** Обкатка и тестовые заявки: повторяющиеся цифры или номер не той длины. */
function looksLikeTest_(phone, name) {
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

function num_(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  var s = String(v).replace(/[\s  ]/g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function toDate_(v) {
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

function cell_(row, idx, name) {
  return idx[name] == null ? '' : row[idx[name]];
}

/* ------------------------------------------------------------------ запись */

function toRow_(x, no, keep) {
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
function readManual_(ss) {
  var sh = ss.getSheetByName(DST_SHEET);
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
    MANUAL.forEach(function (name) {
      var at = head.indexOf(name);
      if (at > -1 && vals[r][at] !== '') keep[name] = vals[r][at];
    });
    out[key] = keep;
  }
  return out;
}

function writeSheet_(ss, rows) {
  var sh = ss.getSheetByName(DST_SHEET) || ss.insertSheet(DST_SHEET);
  sh.clear();

  sh.getRange(1, 1, 1, COLS.length).setValues([COLS])
    .setFontWeight('bold').setBackground('#F1ECE1');
  sh.setFrozenRows(1);

  if (!rows.length) return;
  sh.getRange(2, 1, rows.length, COLS.length).setValues(rows);

  var c = function (name) { return COLS.indexOf(name) + 1; };

  sh.getRange(2, c('Дата'), rows.length, 1).setNumberFormat('dd.MM.yyyy');
  sh.getRange(2, c('КП до'), rows.length, 1).setNumberFormat('dd.MM.yyyy');
  sh.getRange(2, c('Последняя правка'), rows.length, 1).setNumberFormat('dd.MM.yyyy HH:mm');
  ['Сумма', 'На гостя', 'Предоплата', 'Остаток'].forEach(function (n) {
    sh.getRange(2, c(n), rows.length, 1).setNumberFormat('# ##0 ₸');
  });

  sh.getRange(2, c('Статус'), rows.length, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build());

  paint_(sh, rows.length, c);

  sh.hideColumns(c('Ссылка'));
  sh.hideColumns(c('Ключ'));
  sh.autoResizeColumns(1, COLS.length);
}

/** Подсветка: истекающее КП, отказы, тестовые строки. */
function paint_(sh, n, c) {
  var body = sh.getRange(2, 1, n, COLS.length);
  var a1 = function (name) { return '$' + colLetter_(c(name)) + '2'; };

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

function colLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}

/* ══════════════════════════ лист для кухни ══════════════════════════ */

var KIT_COLS = ['Дата', 'Время', 'Зал', 'Гость', 'Гостей', 'Раздел', 'Блюдо',
                'Кол-во', 'Ед.', 'Примечание', 'Точность', 'Ключ'];

/** Тот же код блюда, что считает калькулятор (v67+). Совпадать обязан посимвольно. */
function dishCode_(name) {
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
function loadMenu_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('menu_v1');
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }

  var html = UrlFetchApp.fetch(SITE_URL, { muteHttpExceptions: true }).getContentText();
  var m = html.match(/const MENU\s*=\s*\{([\s\S]*?)\n\};/);
  if (!m) throw new Error('Не удалось прочитать меню с ' + SITE_URL);

  var cats = [], byCode = {}, byIndex = {};
  var catRe = /\n {2}'([^']+)'\s*:\s*\[([\s\S]*?)\n {2}\]/g, cm;
  while ((cm = catRe.exec(m[1])) !== null) {
    var cat = cm[1], list = [];
    var dishRe = /\[\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*'([^']*)'/g, dm;
    while ((dm = dishRe.exec(cm[2])) !== null) {
      var dish = { name: dm[1].replace(/\\'/g, "'"), price: +dm[2], unit: dm[3], cat: cat };
      list.push(dish);
      var code = dishCode_(dish.name);
      if (!byCode[code]) byCode[code] = dish;
    }
    byIndex[cats.length] = list;
    cats.push(cat);
  }
  var menu = { cats: cats, byCode: byCode, byIndex: byIndex };
  try { cache.put('menu_v1', JSON.stringify(menu), 21600); } catch (e) {}
  return menu;
}

/** Собирает лист «Состав заказа»: строка на блюдо, по датам банкетов. */
function writeKitchen_(ss, list, statusOf) {
  var menu;
  try { menu = loadMenu_(); }
  catch (e) { kitchenNote_(ss, 'Меню не загрузилось: ' + e.message); return; }

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

  var sh = ss.getSheetByName(KIT_SHEET) || ss.insertSheet(KIT_SHEET);
  sh.clear();
  sh.getRange(1, 1, 1, KIT_COLS.length).setValues([KIT_COLS])
    .setFontWeight('bold').setBackground('#F1ECE1');
  sh.setFrozenRows(1);
  if (!rows.length) { kitchenNote_(ss, 'Предстоящих банкетов нет.'); return; }

  sh.getRange(2, 1, rows.length, KIT_COLS.length).setValues(rows);
  sh.getRange(2, 1, rows.length, 1).setNumberFormat('dd.MM.yyyy');

  var c = KIT_COLS.indexOf('Точность') + 1;
  var body = sh.getRange(2, 1, rows.length, KIT_COLS.length);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + colLetter_(c) + '2<>""')
      .setBackground('#F7EDD8').setRanges([body]).build()
  ]);
  sh.hideColumns(KIT_COLS.indexOf('Ключ') + 1);
  sh.autoResizeColumns(1, KIT_COLS.length);
}

function kitchenNote_(ss, text) {
  var sh = ss.getSheetByName(KIT_SHEET) || ss.insertSheet(KIT_SHEET);
  sh.clear();
  sh.getRange(1, 1).setValue(text).setFontColor('#9A9284');
}
