# -*- coding: utf-8 -*-
"""Собирает демо-версию: приложение плюс наполнение из smena/demo-seed.js.

    python3 smena/build-demo.py [куда_положить.html]
"""
import re, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT  = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'smena', 'demo.html')
src  = open(os.path.join(ROOT, 'smena', 'index.html'), encoding='utf-8').read()
SEED = open(os.path.join(ROOT, 'smena', 'demo-seed.js'), encoding='utf-8').read()

link  = re.search(r'<link href="https://fonts[^>]*>', src).group(0)
style = re.search(r'<style>.*?</style>', src, re.S).group(0)
body  = re.search(r'<body>\n(.*)\n</body>', src, re.S).group(1)

def rep(s, old, new):
    assert old in s, 'НЕ НАЙДЕНО: ' + old[:80]
    return s.replace(old, new, 1)

# в артефакте нет своего sw.js и нет облака
body = re.sub(r"if\('serviceWorker' in navigator\)\{.*?\n\}\n", "", body, count=1, flags=re.S)
body = rep(body, """loadLocal();
opened={__tasks:true};
cloudStatus();
render();
loadCloud();
window.addEventListener('focus',function(){if(cloudOK&&view!=='shift')loadCloud()});""",
"""loadLocal();
if(!S.shifts.length)seedDemo();
opened={__tasks:true};
cloudStatus();
render();""")
body = rep(body, """  e.innerHTML=who+(cloudOK?(savedAt?'сохранено '+savedAt:'облако'):'только этот телефон');""",
"""  e.innerHTML=who+'демо · данные в браузере';""")

body = body.replace('prompt(', 'ask1(').replace('confirm(', 'ask2(')

# скачивание в песочнице запрещено — показываем CSV текстом
body = rep(body, """  if(a==='excsv'){return download('smena-'+today()+'.csv',toCSV(tableRows(S.shifts.filter(inPeriod))))}""",
"""  if(a==='excsv'){return showExport(toCSV(tableRows(S.shifts.filter(inPeriod))))}""")
body = rep(body, '>Скачать CSV</button>', '>Показать CSV</button>')
body = re.sub(r"function download\(name,text\)\{.*?\n\}\n", "", body, count=1, flags=re.S)

# пояснение и сброс
body = rep(body, """  var done=S.shifts.filter(function(s){return s.status==='accepted'}).slice(0,3);
  var h='';""",
"""  var done=S.shifts.filter(function(s){return s.status==='accepted'}).slice(0,3);
  var h='<div class="card"><div class="card-h">Это демо</div><div class="card-s">Две смены, журнал, задачи и книга гостей заполнены как пример вечера в ресторане. Нажимайте что угодно: данные лежат только в вашем браузере, никуда не уходят и никому не видны.</div><button class="btn ghost sm" data-a="reset">Вернуть исходный пример</button></div>';""")
body = rep(body, """  if(a==='open'){""",
"""  if(a==='reset'){
    if(ask2('Вернуть демо в исходное состояние? Ваши правки в примере пропадут.')){
      localStorage.removeItem(LSKEY);S={rev:0,place:'',shifts:[],tasks:[]};seedDemo();
      view='home';cur=null;step=null;opened={__tasks:true};openC={};render();toast('Пример восстановлен');
    }
    return;
  }
  if(a==='open'){""")

# подсказки с кодами на экране входа демо
body = rep(body, """       '<div class="card-s">Выберите себя и введите PIN. Под вашим именем будет стоять подпись под приёмом смены.</div><div class="who">';""",
"""       '<div class="card-s">Выберите себя и введите PIN. Под вашим именем будет стоять подпись под приёмом смены.<br><b style="color:var(--gold)">В демо PIN у обоих — 1234</b>, код восстановления — <b style="color:var(--gold)">DEMO-CODE</b>. Смену передал Диас, принимает Данияр.</div><div class="who">';""")

body = rep(body, "/* ---------- СОБЫТИЯ ---------- */", SEED + "\n/* ---------- СОБЫТИЯ ---------- */")

out = ('<title>Передача смены</title>\n'
       '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">\n'
       + link + '\n' + style + '\n' + body + '\n')
open(OUT, 'w', encoding='utf-8').write(out)
print('собран', OUT, '—', len(out), 'символов')
