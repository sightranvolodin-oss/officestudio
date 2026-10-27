#!/usr/bin/env python3
"""OfficeStudio: adds interface translation to epaint (text layout) and keeps egui text edits
untranslated. Usage: apply.py <epaint dir> <egui dir> <ru.tsv>"""
import os, shutil, sys

here = os.path.dirname(os.path.abspath(__file__))
epaint, egui, tsv = sys.argv[1:4]

def patch(path, old, new, count=1):
    s = open(path, encoding='utf-8').read()
    if new in s:
        return
    if s.count(old) != count:
        sys.exit(f'{path}: expected {count} × {old!r}, found {s.count(old)}')
    open(path, 'w', encoding='utf-8').write(s.replace(old, new))

t = os.path.join(epaint, 'src', 'text')
shutil.copy(os.path.join(here, 'translate.rs'), os.path.join(t, 'translate.rs'))
shutil.copy(tsv, os.path.join(t, 'ru.tsv'))
patch(os.path.join(t, 'mod.rs'), 'pub mod cursor;\n', 'pub mod cursor;\npub mod translate;\n')
patch(os.path.join(t, 'fonts.rs'),
      '    pub fn layout_job(&mut self, job: LayoutJob) -> Arc<Galley> {\n',
      '    pub fn layout_job(&mut self, mut job: LayoutJob) -> Arc<Galley> {\n        super::translate::apply(&mut job);\n')
patch(os.path.join(egui, 'src', 'widgets', 'text_edit', 'builder.rs'),
      '        let layouter = layouter.unwrap_or(&mut default_layouter);\n',
      '        let layouter = layouter.unwrap_or(&mut default_layouter);\n'
      '        // OfficeStudio: what the user types is laid out exactly as typed (never translated)\n'
      '        let mut untranslated = move |ui: &Ui, text: &dyn TextBuffer, wrap_width: f32| {\n'
      '            epaint::text::translate::without(|| layouter(ui, text, wrap_width))\n'
      '        };\n'
      '        let layouter: &mut dyn FnMut(&Ui, &dyn TextBuffer, f32) -> Arc<Galley> = &mut untranslated;\n')
print('patched', epaint, egui)
