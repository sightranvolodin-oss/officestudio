#!/usr/bin/env python3
"""Russian interface dictionary for the translated DeckCraft build: OfficeStudio's own rows
(crafts-patches/deckcraft/ru-*.txt, «English ⇒ Russian») first, then the ArtCraft Russian
catalogs (craft-i18n, MIT OR Apache-2.0). Usage: build-dict.py <craft-i18n dir> <out.tsv>"""
import glob, os, sys

i18n, out = sys.argv[1:3]
here = os.path.dirname(os.path.abspath(__file__))
d = {}
for f in sorted(glob.glob(os.path.join(here, 'deckcraft', 'ru-*.txt'))):
    for line in open(f, encoding='utf-8'):
        if ' ⇒ ' not in line:
            continue
        en, ru = line.rstrip('\n').split(' ⇒ ', 1)
        if en and ru:
            d.setdefault(en, ru)
order = ['common', 'wordcraft', 'pdfcraft', 'photocraft', 'vectorcraft', 'cadcraft', 'filmcraft', 'craft-launcher']
rows = []
for n in order:
    p = os.path.join(i18n, 'locales', 'ru', n + '.tsv')
    if not os.path.exists(p):
        continue
    for line in open(p, encoding='utf-8'):
        if line.startswith('#') or not line.strip():
            continue
        c = line.rstrip('\n').split('\t')
        if len(c) < 3 or not c[1] or not c[2] or c[0].startswith('@'):
            continue
        if '\\' in c[1] or '\\' in c[2]:
            continue
        rows.append((c[0], c[1], c[2]))
for ctx, en, ru in rows:      # rows without a context first: the plain meaning
    if not ctx:
        d.setdefault(en, ru)
for ctx, en, ru in rows:
    d.setdefault(en, ru)
with open(out, 'w', encoding='utf-8') as f:
    for en, ru in d.items():
        if '\t' in en or '\t' in ru or '\n' in en or '\n' in ru:
            continue
        f.write(f'{en}\t{ru}\n')
print('dictionary', out, len(d), 'rows')
