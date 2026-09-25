#!/usr/bin/env python3
"""Build the sample customer packet from editable content and brand artwork."""
from __future__ import annotations

import argparse
import json
import re
import statistics
from pathlib import Path
from xml.etree import ElementTree

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph

ROOT = Path(__file__).resolve().parent
W, H = 612, 792
LEFT, RIGHT, WIDTH = 54, 558, 504
INK = colors.HexColor('#171717')
COPY = colors.HexColor('#525252')
RULE = colors.HexColor('#d4d4d4')
PALE = colors.HexColor('#f5f5f5')
BLUE = colors.HexColor('#1d4ed8')
PAGE_TITLES = [
    'Review at a glance', 'Case and review scope', 'Insurer valuation review',
    'Comparable market evidence', 'Conclusion and dispute strategy',
    'Customer reconsideration request', 'Example insurer response review',
    'Next steps and service scope',
]


def register_fonts(folder: Path | None):
    if folder:
        for name, filename in [('Body', 'regular.ttf'), ('Bold', 'bold.ttf'),
                               ('Italic', 'italic.ttf'), ('Wordmark', 'wordmark.ttf')]:
            pdfmetrics.registerFont(TTFont(name, str(folder / filename)))
    else:
        for name, index in [('Body', 0), ('Bold', 1), ('Italic', 2)]:
            pdfmetrics.registerFont(TTFont(name, '/System/Library/Fonts/HelveticaNeue.ttc', subfontIndex=index))
        pdfmetrics.registerFont(TTFont('Wordmark', '/System/Library/Fonts/Avenir Next.ttc', subfontIndex=2))
    pdfmetrics.registerFontFamily('Body', normal='Body', bold='Bold', italic='Italic', boldItalic='Bold')


def cash(value):
    return f'${value:,.0f}'


def signed_cash(value):
    return ('+' if value > 0 else '-' if value < 0 else '') + cash(abs(value))


def escaped(text):
    return str(text).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def draw_brand_mark(canvas, x, top, size=25):
    """Render the unchanged repository SVG geometry as vector paths."""
    root = ElementTree.parse(ROOT / 'venfour-mark.svg').getroot()
    canvas.saveState()
    canvas.translate(x, H - top)
    canvas.scale(size / 375, -size / 375)
    canvas.setFillColor(INK)

    def visit(node):
        canvas.saveState()
        transform = node.attrib.get('transform', '')
        if transform:
            match = re.fullmatch(r'translate\(([-.\d]+),\s*([-.\d]+)\)', transform)
            if not match:
                raise ValueError(f'Unsupported artwork transform: {transform}')
            canvas.translate(float(match[1]), float(match[2]))
        if node.tag.endswith('path'):
            tokens = re.findall(r'[MLCZ]|-?\d+(?:\.\d+)?', node.attrib['d'])
            path = canvas.beginPath()
            i = 0
            while i < len(tokens):
                command = tokens[i]
                i += 1
                count = {'M': 2, 'L': 2, 'C': 6, 'Z': 0}[command]
                values = list(map(float, tokens[i:i + count]))
                i += count
                {'M': path.moveTo, 'L': path.lineTo, 'C': path.curveTo, 'Z': path.close}[command](*values)
            canvas.drawPath(path, fill=1, stroke=0)
        for child in node:
            visit(child)
        canvas.restoreState()

    visit(root)
    canvas.restoreState()


class Packet:
    def __init__(self, data, output):
        self.d = data
        self.c = Canvas(str(output), pagesize=(W, H), pageCompression=1, invariant=1)
        self.c.setTitle(data['title'])
        self.c.setAuthor('Venfour')
        self.c.setSubject('Hypothetical customer valuation review and response guidance')
        self.c.setCreator('Venfour document studio')
        self.page = 0
        self.extents = []

    def line(self, top, x=LEFT, width=WIDTH, color=RULE):
        self.c.setStrokeColor(color)
        self.c.setLineWidth(0.55)
        self.c.line(x, H - top, x + width, H - top)

    def text(self, text, top, x=LEFT, size=10, font='Body', color=INK, align='left'):
        self.c.setFillColor(color)
        self.c.setFont(font, size)
        method = self.c.drawRightString if align == 'right' else self.c.drawString
        method(x, H - top - size, str(text))

    def paragraph(self, text, top, x=LEFT, width=WIDTH, size=10.5,
                  leading=15, font='Body', color=INK):
        style = ParagraphStyle('p', fontName=font, fontSize=size, leading=leading,
                               textColor=color, spaceAfter=0, allowWidows=0, allowOrphans=0)
        paragraph = Paragraph(escaped(text).replace('\n', '<br/>'), style)
        _, height = paragraph.wrap(width, 1000)
        if top + height > 734:
            raise ValueError(f'Page {self.page}: text exceeds content area at {top + height:.1f}: {text[:75]}')
        paragraph.drawOn(self.c, x, H - top - height)
        self.extents.append({'page': self.page, 'top': top, 'bottom': top + height, 'text': text[:70]})
        return top + height

    def label(self, text, top, x=LEFT, color=COPY):
        self.text(text, top, x, 8, 'Bold', color)

    def heading(self, text, top, size=14):
        return self.paragraph(text, top, size=size, leading=size + 4, font='Bold') + 9

    def box(self, top, height, fill=PALE, x=LEFT, width=WIDTH):
        self.c.setFillColor(fill)
        self.c.rect(x, H - top - height, width, height, stroke=0, fill=1)

    def callout(self, title, body, top, size=10, leading=14):
        style = ParagraphStyle('measure', fontName='Body', fontSize=size, leading=leading)
        p = Paragraph(escaped(body), style)
        _, body_height = p.wrap(WIDTH - 32, 1000)
        height = body_height + 48
        self.box(top, height)
        self.paragraph(title, top + 13, x=LEFT + 16, width=WIDTH - 32,
                       size=10.5, leading=14, font='Bold')
        self.paragraph(body, top + 34, x=LEFT + 16, width=WIDTH - 32, size=size, leading=leading)
        return top + height

    def start(self, eyebrow, title, intro=None):
        if self.page:
            self.c.showPage()
        self.page += 1
        self.c.bookmarkPage(f'page-{self.page}')
        self.c.addOutlineEntry(PAGE_TITLES[self.page - 1], f'page-{self.page}', level=0)
        draw_brand_mark(self.c, LEFT, 36, 25)
        self.text('Venfour', 36, LEFT + 33, 20, 'Wordmark')
        self.text('SAMPLE / HYPOTHETICAL CASE', 43, RIGHT, 7.6, 'Bold', COPY, 'right')
        self.line(77)
        self.line(747)
        self.text('venfour.com', 758, size=8.2, font='Bold')
        self.c.linkURL('https://venfour.com', (LEFT, 21, LEFT + 65, 37), relative=0)
        self.text('SAMPLE-TL-2026-01  /  NOT A REAL CLAIM', 758, x=176, size=7.4, color=COPY)
        self.text(f'{self.page:02d} / 08', 758, RIGHT, 8.2, 'Body', COPY, 'right')
        self.label(eyebrow, 101)
        y = self.paragraph(title, 121, size=25.5, leading=30) + 14
        if intro:
            y = self.paragraph(intro, y, size=10.5, leading=15, color=COPY) + 20
        return y

    def row_table(self, headers, rows, widths, top, numeric=(), body_size=9.3, padding=9):
        x = LEFT
        for head, width in zip(headers, widths):
            self.paragraph(head, top, x=x + 7, width=width - 14, size=8, leading=10, font='Bold', color=COPY)
            x += width
        y = top + 30
        self.line(y)
        for index, row in enumerate(rows):
            heights = []
            for value, width in zip(row, widths):
                p = Paragraph(escaped(value).replace('\n', '<br/>'), ParagraphStyle('cell', fontName='Body', fontSize=body_size, leading=13))
                heights.append(p.wrap(width - 14, 1000)[1])
            height = max(heights) + 2 * padding
            if index % 2 == 0:
                self.box(y, height, x=LEFT, width=WIDTH)
            x = LEFT
            for col, (value, width) in enumerate(zip(row, widths)):
                if col in numeric and '\n' not in str(value):
                    self.text(value, y + padding, x + width - 7, body_size, 'Body', INK, 'right')
                else:
                    self.paragraph(value, y + padding, x=x + 7, width=width - 14, size=body_size, leading=13)
                x += width
            y += height
            self.line(y)
        return y

    def numbered(self, items, top, body_size=10.1, leading=14, gap=14):
        y = top
        for number, title, body in items:
            self.text(number, y + 1, LEFT, 10, 'Bold', COPY)
            y = self.paragraph(title, y, x=LEFT + 28, width=WIDTH - 28,
                               size=10.5, leading=14, font='Bold') + 5
            y = self.paragraph(body, y, x=LEFT + 28, width=WIDTH - 28,
                               size=body_size, leading=leading) + gap
        return y

    def cover(self):
        d, section = self.d, self.d['cover']
        self.start(section['eyebrow'], 'Sample Venfour\nTotal-Loss Review')
        y = self.paragraph(section['intro'], 198, width=475, size=11, leading=16, color=COPY)
        self.line(y + 19)
        y += 34
        self.label('SUBJECT VEHICLE', y)
        self.paragraph(d['vehicle'], y + 17, size=14, leading=18, font='Bold')
        self.text(f"{d['mileage']:,} miles  /  Loss: {d['loss_date']}", y + 43, size=9.5, color=COPY)
        self.text(f"Review issued {d['review_date']}", y + 61, size=9.5, color=COPY)
        y += 97
        self.label('INSURER VEHICLE VALUE', y)
        self.text(cash(d['insurer_value']), y + 18, size=27)
        self.label('SELECTED ASKING-PRICE RANGE', y, x=300)
        prices = [r['price'] for r in d['market']]
        self.text(f'{cash(min(prices))} - {cash(max(prices))}', y + 21, x=300, size=21)
        self.text(f'Median {cash(statistics.median(prices))} / 5 sample records', y + 53, x=300, size=9, color=COPY)
        self.text('Before separate settlement items', y + 53, size=9, color=COPY)
        y += 88
        y = self.heading(section['conclusion_title'], y, 13)
        y = self.paragraph(section['conclusion'], y, size=10.5, leading=15) + 17
        self.box(y, 82)
        self.label(section['gap_label'].upper(), y + 12, LEFT + 15)
        self.text(cash(statistics.median(prices) - d['insurer_value']), y + 32, LEFT + 15, 27)
        self.paragraph(section['gap_note'], y + 15, x=LEFT + 147, width=WIDTH - 163, size=9.6, leading=13)
        y += 100
        self.paragraph(section['sample_note'], y, size=8.7, leading=12, color=COPY)

    def scope(self):
        s = self.d['scope']
        y = self.start('01 / CASE AND MATERIALS', 'What this review covers', s['intro'])
        y = self.heading('Case and vehicle summary', y)
        for label, value in s['vehicle_facts']:
            self.paragraph(label, y, width=130, size=9.3, leading=13, color=COPY)
            bottom = self.paragraph(value, y, x=197, width=361, size=10, leading=13)
            y = bottom + 6
        self.line(y + 1)
        y = self.heading('Illustrative review file', y + 14)
        for ref, label, body in s['records']:
            self.text(ref, y + 1, size=9, font='Bold', color=COPY)
            y = self.paragraph(label, y, x=105, width=453, size=10, leading=13, font='Bold') + 3
            y = self.paragraph(body, y, x=105, width=453, size=9.5, leading=13) + 8
        y = self.paragraph(s['scope_note'], y + 1, size=8.6, leading=11.5, color=COPY) + 10
        self.callout('Vehicle value and settlement payment are separate', s['boundary'], y, 9.3, 13)

    def insurer(self):
        s = self.d['insurer_review']
        y = self.start('02 / INSURER VALUATION', 'Where the report needs clarity', s['intro'])
        rows = [[r['id'], f"{r['mileage']:,}", cash(r['price']), signed_cash(r['mileage_adjustment']),
                 signed_cash(r['condition_adjustment']), cash(r['adjusted'])] for r in self.d['insurer_comps']]
        y = self.row_table(['Record', 'Mileage', 'Asking\nprice', 'Mileage\nadjustment', 'Condition\nadjustment', 'Insurer-\nadjusted'],
                           rows, [43, 68, 87, 105, 107, 94], y, numeric=(1,2,3,4,5), body_size=9.6)
        y = self.paragraph(s['table_note'], y + 10, size=8.6, leading=12, color=COPY) + 16
        self.line(y)
        self.label('REPORTED VEHICLE VALUE', y + 12)
        self.text('($20,500 + $20,900 + $20,100) / 3 = $20,500', y + 28, size=10.7, font='Bold')
        y += 66
        y = self.numbered(s['findings'], y, body_size=10, leading=14, gap=17)
        self.paragraph(s['priority'], y + 1, size=9.2, leading=13, font='Bold')

    def market(self):
        s = self.d['market_review']
        y = self.start('03 / COMPARABLE EVIDENCE', 'The market records behind the gap', s['intro'])
        rows = [[r['id'], r['dealer'], f"{r['mileage']:,}", f"{r['distance']} mi", cash(r['price'])] for r in self.d['market']]
        y = self.row_table(['Record', 'Fictional listing source', 'Mileage', 'Distance', 'Asking price'], rows,
                           [49, 187, 85, 80, 103], y, numeric=(2,3,4), body_size=10, padding=8)
        y = self.paragraph(s['table_note'], y + 10, size=8.7, leading=12, color=COPY) + 16
        self.box(y, 61)
        for x, label, value in [(70, 'LOW', '$22,400'), (238, 'MEDIAN', '$22,900'), (406, 'HIGH', '$23,400')]:
            self.label(label, y + 11, x)
            self.text(value, y + 27, x, 20)
        y += 80
        for title, body in [('How the set is used', s['selection']), ('Loss-date context', s['timing']), ('Material limitations', s['limits'])]:
            y = self.heading(title, y, 11)
            y = self.paragraph(body, y, size=10, leading=14) + 13

    def reasoning(self):
        s = self.d['reasoning']
        y = self.start('04 / CONCLUSION AND ACTION', 'What the evidence supports', s['intro'])
        for title, body in s['steps']:
            y = self.heading(title, y, 11.2)
            y = self.paragraph(body, y, size=10.2, leading=14.2) + 12
        self.line(y)
        y = self.heading('A practical reconsideration plan', y + 19, 14)
        y = self.numbered(s['strategy'], y, body_size=10, leading=14, gap=10)
        self.paragraph(s['closing'], y, size=9.2, leading=13, color=COPY)

    def request(self):
        s = self.d['request']
        y = self.start('05 / READY-TO-SEND EXAMPLE', 'A clear request to the adjuster', s['intro'])
        self.label('SUBJECT', y)
        y = self.paragraph(s['subject'], y + 18, size=10.3, leading=14, font='Bold') + 16
        self.line(y)
        y += 22
        for text in s['paragraphs']:
            y = self.paragraph(text, y, x=LEFT + 15, width=WIDTH - 30, size=11, leading=15.5) + 10
        self.line(y + 3)
        y = self.heading('Attachments and final check', y + 22, 11)
        y = self.paragraph(s['attachments'], y, size=9.5, leading=13.5) + 13
        self.paragraph(s['send_note'], y, size=9.5, leading=13.5, color=COPY)

    def response(self):
        s = self.d['response']
        y = self.start('06 / FOLLOW-UP EXAMPLE', 'The insurer revises its valuation', s['intro'])
        self.label(f"HYPOTHETICAL INSURER REPLY / {self.d['response_date'].upper()}", y)
        y = self.callout('R2 / Sample Insurer', s['reply'], y + 21, size=10.2, leading=14.5) + 21
        for title, body in s['analysis']:
            y = self.heading(title, y, 11)
            y = self.paragraph(body, y, size=10, leading=14) + 16
        y = self.callout(s['recommendation_title'], s['recommendation'], y, size=10, leading=14) + 17
        self.paragraph(s['next'], y, size=10, leading=14)

    def continuation(self):
        s = self.d['continuation']
        y = self.start('07 / CONTINUING THE CASE', 'Support after the first request', s['intro'])
        for title, body in s['steps']:
            self.paragraph(title, y, width=120, size=10, leading=14, font='Bold')
            y = self.paragraph(body, y, x=190, width=368, size=9.5, leading=13) + 13
        self.line(y)
        y = self.heading(s['fee_title'], y + 16, 13)
        y = self.paragraph(s['fee_intro'], y, size=9.5, leading=13) + 13
        for title, body in s['refunds']:
            y = self.paragraph(title, y, size=9.5, leading=13, font='Bold') + 3
            y = self.paragraph(body, y, size=9.2, leading=12.5) + 10
        self.text('Full eligibility: venfour.com/refund-policy', y, size=9, color=BLUE)
        self.c.linkURL('https://venfour.com/refund-policy', (LEFT, H-y-13, LEFT+250, H-y+2), relative=0)
        y += 29
        self.line(y)
        y = self.paragraph(s['attorney_note'], y + 14, size=9.5, leading=13) + 12
        y = self.paragraph(s['limits'], y, size=8.5, leading=11.5, color=COPY) + 9
        self.text('Service terms: venfour.com/terms', y, size=8.5, color=BLUE)
        self.c.linkURL('https://venfour.com/terms', (LEFT, H-y-12, LEFT+220, H-y+2), relative=0)

    def build(self):
        for section in [self.cover, self.scope, self.insurer, self.market,
                        self.reasoning, self.request, self.response, self.continuation]:
            section()
        self.c.save()
        return self.extents


def validate(data):
    assert len(data['market']) == 5
    assert len({r['id'] for r in data['market']}) == 5
    prices = [r['price'] for r in data['market']]
    assert (min(prices), statistics.median(prices), max(prices)) == (22400, 22900, 23400)
    assert statistics.median(prices) - data['insurer_value'] == 2400
    assert min(prices) - data['insurer_value'] == 1900
    assert round(100 * 2400 / data['insurer_value'], 1) == 11.7
    for r in data['insurer_comps']:
        assert r['price'] + r['mileage_adjustment'] + r['condition_adjustment'] + r['other_adjustment'] == r['adjusted']
    assert statistics.mean(r['adjusted'] for r in data['insurer_comps']) == data['insurer_value']
    assert statistics.mean(r['price'] + r['mileage_adjustment'] - 300 for r in data['insurer_comps']) == data['revised_value']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--content', type=Path, default=ROOT / 'sample-review.json')
    parser.add_argument('--output', type=Path, default=ROOT.parent / 'Sample-Venfour-Total-Loss-Review.pdf')
    parser.add_argument('--fonts-dir', type=Path, help='Folder containing regular.ttf, bold.ttf, italic.ttf and wordmark.ttf')
    args = parser.parse_args()
    data = json.loads(args.content.read_text())
    validate(data)
    register_fonts(args.fonts_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    extents = Packet(data, args.output).build()
    (args.output.parent / 'qa' / 'text-extents.json').parent.mkdir(exist_ok=True)
    (args.output.parent / 'qa' / 'text-extents.json').write_text(json.dumps(extents, indent=2) + '\n')
    print(f'Created {args.output}')
    print(f'8 pages; {len(extents)} text blocks; sample calculations verified')


if __name__ == '__main__':
    main()
