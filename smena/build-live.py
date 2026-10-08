# -*- coding: utf-8 -*-
"""Собирает чистый рабочий экземпляр из smena/index.html для публикации артефактом.

Отличия от боевого файла: нет service worker (артефакт отдаётся с чужого пути),
нет облака (состояние только в localStorage), prompt/confirm завёрнуты на случай
выключенных модальных окон в песочнице, скачивание CSV заменено показом текста.

    python3 smena/build-live.py [куда_положить.html]
"""
import re, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT  = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'smena', 'live.html')
src  = open(os.path.join(ROOT, 'smena', 'index.html'), encoding='utf-8').read()

link  = re.search(r'<link href="https://fonts[^>]*>', src).group(0)
style = re.search(r'<style>.*?</style>', src, re.S).group(0)
body  = re.search(r'<body>\n(.*)\n</body>', src, re.S).group(1)

def rep(s, old, new):
    assert old in s, 'НЕ НАЙДЕНО: ' + old[:80]
    return s.replace(old, new, 1)

body = re.sub(r"if\('serviceWorker' in navigator\)\{.*?\n\}\n", "", body, count=1, flags=re.S)
assert "serviceWorker" not in body

body = rep(body, """loadLocal();
opened={__tasks:true};
cloudStatus();
render();
loadCloud();
window.addEventListener('focus',function(){if(cloudOK&&view!=='shift')loadCloud()});""",
"""loadLocal();
opened={__tasks:true};
cloudStatus();
render();""")

body = rep(body, """  e.innerHTML=who+(cloudOK?(savedAt?'сохранено '+savedAt:'облако'):'только этот телефон');""",
"""  e.innerHTML=who+'этот браузер';""")

body = body.replace('prompt(', 'ask1(').replace('confirm(', 'ask2(')

body = rep(body, """  if(a==='excsv'){return download('smena-'+today()+'.csv',toCSV(tableRows(S.shifts.filter(inPeriod))))}""",
"""  if(a==='excsv'){return showExport(toCSV(tableRows(S.shifts.filter(inPeriod))))}""")
body = rep(body, '>Скачать CSV</button>', '>Показать CSV</button>')
body = re.sub(r"function download\(name,text\)\{.*?\n\}\n", "", body, count=1, flags=re.S)
assert 'function download(' not in body

body = rep(body, "var S={rev:0,place:'Ресторан',sheet:''", "var S={rev:0,place:'DIO Grand Cafe',sheet:''")

HELP = r"""
function ask1(m,d){var r=null;try{r=window.prompt(m,d)}catch(e){r=null}return (r===null||r===undefined)?(d||''):r}
function ask2(m){try{return window.confirm(m)}catch(e){return true}}
"""
body = rep(body, "/* ---------- СОБЫТИЯ ---------- */", HELP + "\n/* ---------- СОБЫТИЯ ---------- */")

body = rep(body, """'<div class="card-s">Создайте себя как управляющего. Дальше добавите остальных менеджеров во вкладке «Отчёт».</div>'+""",
"""'<div class="card-s">Это ваш чистый экземпляр — пустой, без чужих данных. Заведите себя как управляющего, потом добавьте второго менеджера в «Ещё» → «Отчёт и KPI» → «Команда и доступы».<br><br>Всё, что вы здесь заполните, хранится только в этом браузере и никому не видно.</div>'+""")

out = ('<title>Смена DIO Grand Cafe</title>\n'
       '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">\n'
       + link + '\n' + style + '\n' + body + '\n')
open(OUT, 'w', encoding='utf-8').write(out)
print('собран', OUT, '—', len(out), 'символов')
