"""Build Scripts from page.src.html and gen.js, and the Event Centre from events.src.html.

  python3 build/build.py    writes src/index.html and src/events.html (the pages the worker serves)
                            and build/Scripts.html (local-only copy for claude.ai)
"""
import base64, os
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
p = open(os.path.join(here, 'page.src.html'), encoding='utf-8').read()
g = open(os.path.join(here, 'gen.js'), encoding='utf-8').read()
tpl = base64.b64encode(open(os.path.join(here, 'tpl', 'clean.docx'), 'rb').read()).decode()
page = p.replace('%%GEN%%', g).replace('%%TPL%%', tpl)
# The claude.ai copy cannot reach the network, so it keeps scripts on the device only.
# It starts with its own charset: opened straight from disk, Chromium otherwise guesses the
# encoding and sometimes shows Chinese as Latin-1 (the cause of the flaky ＋ menu test).
open(os.path.join(here, 'Scripts.html'), 'w', encoding='utf-8').write('<meta charset="utf-8">\n' + page.replace('%%CLOUD%%', 'null'))
page = page.replace('%%CLOUD%%', '{"api":"/api"}')
i = page.index('</style>') + len('</style>')
head = ('<!doctype html>\n<html lang="zh-Hant-HK">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">\n'
        '<meta name="apple-mobile-web-app-capable" content="yes">\n'
        '<meta name="apple-mobile-web-app-title" content="Scripts">\n<meta name="robots" content="noindex">\n')
std = head + page[:i] + '\n</head>\n<body>' + page[i:] + '\n</body>\n</html>\n'
open(os.path.join(root, 'src', 'index.html'), 'w', encoding='utf-8').write(std)
names = ['陳加森', '梁穎晞', '何秉諾', '曾崧茵', '鄭校長', '黃詩琦', '王姿曼', 'Carson', '王希澄', '胡尊', '劉桓瑜', '蔡杏兒']
bad = [w for w in names if w in std]
print('built', len(std), 'real names found:', bad)
# The events page: build/events.src.html with the same Word generator and template, written to src/events.html.
# Its data comes from the server, never from this repository.
ev = open(os.path.join(here, 'events.src.html'), encoding='utf-8').read().replace('%%GEN%%', g).replace('%%TPL%%', tpl)
# The help videos' list (使用教學), from the published manifest; the videos and posters are served as they are from public/help
import json
helps = [{k: v[k] for k in ('id', 'title', 'sec', 'search', 'video', 'poster', 'bytes')} for v in json.load(open(os.path.join(root, 'public', 'help', 'manifest.json'), encoding='utf-8'))['videos']]
ev = ev.replace('%%HELP%%', json.dumps(helps, ensure_ascii=False))
# A version taken from the page itself: the server reports it, and a page left open on an older one reloads itself
import hashlib
ver = hashlib.sha256(ev.encode('utf-8')).hexdigest()[:12]
ev = ev.replace('%%VER%%', ver)
open(os.path.join(root, 'src', 'events.html'), 'w', encoding='utf-8').write(ev)
open(os.path.join(root, 'src', 'page-version.js'), 'w', encoding='utf-8').write('// Written by build/build.py: the version of src/events.html\nexport const PAGE_VERSION = "' + ver + '";\n')
print('events page built', len(ev), 'real names found:', [w for w in names if w in ev])
