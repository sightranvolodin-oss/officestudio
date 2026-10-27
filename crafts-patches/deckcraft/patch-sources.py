#!/usr/bin/env python3
"""OfficeStudio: DeckCraft's own content drawn through egui keeps its exact text (notes, section
names, handout master text). Usage: patch-sources.py <deckcraft dir>"""
import os, sys
root = sys.argv[1]
def patch(rel, old, new):
    p = os.path.join(root, rel)
    s = open(p, encoding='utf-8').read()
    if new in s:
        return
    if s.count(old) != 1:
        sys.exit(f'{rel}: expected one {old!r}, found {s.count(old)}')
    open(p, 'w', encoding='utf-8').write(s.replace(old, new))
W = 'egui::epaint::text::translate::without'
patch('crates/ui-egui/src/notes.rs',
      'fn galley(ui: &Ui, body: &TextBody, size: f32, color: Color32, wrap: f32) -> Arc<Galley> {\n',
      f'fn galley(ui: &Ui, body: &TextBody, size: f32, color: Color32, wrap: f32) -> Arc<Galley> {{\n    {W}(|| galley_inner(ui, body, size, color, wrap))\n}}\n\nfn galley_inner(ui: &Ui, body: &TextBody, size: f32, color: Color32, wrap: f32) -> Arc<Galley> {{\n')
patch('crates/ui-egui/src/sorter.rs',
      '        painter.text(pos2(name_rect.min.x, r.center().y), Align2::LEFT_CENTER, h.name, theme::bold(13.0), t.text);\n',
      f'        {W}(|| {{\n            painter.text(pos2(name_rect.min.x, r.center().y), Align2::LEFT_CENTER, h.name, theme::bold(13.0), t.text);\n        }});\n')
patch('crates/ui-egui/src/sorter.rs',
      '            ui.painter().text(at, egui::Align2::LEFT_TOP, &piece.text, theme::font(size), c);\n',
      f'            {W}(|| {{\n                ui.painter().text(at, egui::Align2::LEFT_TOP, &piece.text, theme::font(size), c);\n            }});\n')
# two-line ribbon labels are split before layout: translate the whole label first
patch('crates/ui-egui/src/widgets.rs',
      '    let font = theme::font(11.0);\n    let lines: Vec<&str> = wrap_label(label);\n',
      '    let font = theme::font(11.0);\n    let translated = egui::epaint::text::translate::label(&label.replace(\'\\n\', " "));\n    let label: &str = translated.as_deref().unwrap_or(label);\n    let lines: Vec<&str> = wrap_label(label);\n')
print('patched deckcraft sources')
