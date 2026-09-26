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
    'What the client receives', 'Insurer report findings', 'Comparable evidence and comparison',
    'Initial customer request', 'Insurer reply and prepared follow-up', 'Attorney handoff and fee protection',
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
        self.text(f'{self.page:02d} / 06', 758, RIGHT, 8.2, 'Body', COPY, 'right')
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

    def workflow(self, top):
        labels = self.d['cover']['workflow']
        step_width = 96
        for i, label in enumerate(labels):
            x = LEFT + i * 103
            self.label(f'{i + 1:02d}', top, x)
            self.paragraph(label, top + 20, x=x, width=step_width, size=10, leading=13, font='Bold')
            if i < 4:
                self.c.setStrokeColor(RULE)
                self.c.setLineWidth(0.8)
                ax = x + 69
                self.c.line(ax, H-top-5, ax+21, H-top-5)
                self.c.line(ax+17, H-top-8, ax+21, H-top-5)
                self.c.line(ax+17, H-top-2, ax+21, H-top-5)
        return top + 72

    def cover(self):
        s = self.d['cover']
        y = self.start('TOTAL-LOSS VALUATION / SAMPLE CUSTOMER PACKET', 'Sample Venfour\nTotal-Loss Review')
        y = self.paragraph(s['benefit'], y, size=11, leading=16) + 25
        y = self.workflow(y)
        y = self.paragraph(s['workflow_note'], y, size=10, leading=14, color=COPY) + 23
        self.line(y)
        y += 19
        y = self.paragraph(self.d['vehicle'], y, size=15, leading=20, font='Bold') + 7
        y = self.paragraph(s['case_line'], y, size=10.5, leading=15, color=COPY) + 4
        y = self.paragraph(s['case_meta'], y, size=10, leading=14, color=COPY) + 24
        prices = [r['price'] for r in self.d['market']]
        values = [('INSURER VEHICLE VALUE', cash(self.d['insurer_value'])),
                  ('MEDIAN ASKING PRICE', cash(statistics.median(prices))),
                  ('ASKING-PRICE GAP', cash(statistics.median(prices)-self.d['insurer_value']))]
        for i, (label, value) in enumerate(values):
            x = LEFT + i*176
            self.label(label, y, x)
            self.text(value, y+21, x, size=26)
        for i, caption in enumerate(['Vehicle value only', '$22,400 - $23,400 range', 'Not a recovery estimate']):
            self.text(caption, y+53, LEFT+i*176, size=10, color=COPY)
        y += 84
        y = self.paragraph(s['conclusion'], y, size=11, leading=16) + 15
        y = self.paragraph(s['gap_note'], y, size=10.5, leading=15, color=COPY) + 22
        self.line(y)
        self.paragraph(s['sample_note'], y+14, size=10, leading=14, color=COPY)

    def insurer(self):
        s = self.d['insurer_review']
        y = self.start('01 / REVIEW FINDINGS', 'What the insurer report leaves open', s['intro'])
        y = self.paragraph(s['scope'], y, size=10.5, leading=15) + 20
        rows = [[r['id'], f"{r['mileage']:,}", cash(r['price']), signed_cash(r['mileage_adjustment']),
                 signed_cash(r['condition_adjustment']), cash(r['adjusted'])] for r in self.d['insurer_comps']]
        y = self.row_table(['Record', 'Mileage', 'Asking\nprice', 'Mileage\nadjustment', 'Condition\nadjustment', 'Insurer-\nadjusted'],
                           rows, [43, 68, 87, 105, 107, 94], y, numeric=(1,2,3,4,5), body_size=10)
        y = self.paragraph(s['table_note'], y+10, size=10, leading=14, color=COPY)+13
        y = self.paragraph('Equal-weight mean: ($20,500 + $20,900 + $20,100) / 3 = $20,500.', y, size=10.5, leading=15, font='Bold')+22
        y = self.numbered(s['findings'], y, body_size=10.5, leading=15, gap=14)
        self.paragraph(s['action'], y, size=10.5, leading=15, color=COPY)

    def comparison_chart(self, top):
        lo, hi = 20000, 24000
        x0, x1 = LEFT+22, RIGHT-22
        def position(value):
            return x0+(value-lo)*(x1-x0)/(hi-lo)
        prices = [r['price'] for r in self.d['market']]
        insurer = self.d['insurer_value']
        low, median, high = min(prices), statistics.median(prices), max(prices)
        self.label('VEHICLE VALUE AND SELECTED ASKING PRICES / USD', top)
        self.paragraph('Insurer value\n$20,500', top+25, x=position(insurer)-33, width=95, size=10.5, leading=14, font='Bold')
        self.paragraph('Asking-price range\n$22,400 - $23,400', top+25, x=position(low)-3, width=178, size=10.5, leading=14, font='Bold')
        axis = top+82
        self.line(axis, x=x0, width=x1-x0)
        self.c.setFillColor(colors.HexColor('#bdbdbd'))
        self.c.rect(position(low), H-axis-5, position(high)-position(low), 10, fill=1, stroke=0)
        self.c.setFillColor(INK)
        self.c.circle(position(insurer), H-axis, 4, fill=1, stroke=0)
        self.c.setStrokeColor(INK)
        self.c.setLineWidth(1.2)
        self.c.line(position(median), H-axis-8, position(median), H-axis+8)
        for tick in range(lo, hi+1, 1000):
            x=position(tick)
            self.c.setLineWidth(0.5)
            self.c.setStrokeColor(RULE)
            self.c.line(x, H-axis-10, x, H-axis-14)
            label=cash(tick)
            self.text(label, axis+19, x-pdfmetrics.stringWidth(label,'Body',9)/2, size=9, color=COPY)
        y=axis+53
        self.c.setStrokeColor(INK)
        self.c.line(position(insurer), H-y, position(median), H-y)
        for x in [position(insurer),position(median)]:
            self.c.line(x,H-y-3,x,H-y+3)
        self.paragraph('$2,400 to the $22,900 median', y+9, x=position(insurer), width=position(median)-position(insurer), size=10, leading=14)
        self.chart_geometry={'axis_min':lo,'axis_max':hi,'axis_left':x0,'axis_right':x1,
            'insurer_x':position(insurer),'range_low_x':position(low),'median_x':position(median),'range_high_x':position(high)}
        return y+35

    def market(self):
        s = self.d['market_review']
        y = self.start('02 / MARKET EVIDENCE', 'Comparable vehicles, clearly compared', s['intro'])
        rows = [[r['id'], r['dealer'], f"{r['mileage']:,}", f"{r['distance']} mi", cash(r['price'])] for r in self.d['market']]
        y = self.row_table(['Record','Fictional listing source','Mileage','Distance','Asking price'], rows,
                           [49,187,85,80,103], y, numeric=(2,3,4), body_size=10.5,padding=8)
        y = self.paragraph(s['table_note'], y+10, size=10, leading=14, color=COPY)+19
        y = self.comparison_chart(y)
        y = self.paragraph(s['chart_note'], y, size=10.5, leading=15)+15
        y = self.paragraph(s['selection'], y, size=10.5, leading=15)+12
        self.paragraph(s['limits'],y,size=10,leading=14,color=COPY)

    def request(self):
        s = self.d['request']
        y = self.start('03 / CUSTOMER RECONSIDERATION REQUEST', 'A specific request, ready to send', s['intro'])
        self.label('SUBJECT',y)
        y=self.paragraph(s['subject'],y+18,size=10.5,leading=15,font='Bold')+17
        self.line(y)
        y+=23
        for text in s['paragraphs']:
            y=self.paragraph(text,y,x=LEFT+15,width=WIDTH-30,size=11,leading=16)+12
        self.line(y+3)
        y=self.heading('After the client sends it',y+22,size=12)
        y=self.paragraph(s['after'],y,size=10.5,leading=15)+14
        self.paragraph(s['sample_note'],y,size=10,leading=14,color=COPY)

    def response(self):
        s = self.d['response']
        y = self.start('04 / INSURER RESPONSE AND SUPPORTED FOLLOW-UP', 'A revised offer. A focused next question.', s['intro'])
        self.label('SEPTEMBER 23 / HYPOTHETICAL INSURER REPLY',y)
        y=self.paragraph(s['reply'],y+18,size=10.5,leading=15,font='Bold')+12
        y=self.paragraph(s['report_note'],y,size=10.5,leading=15)+12
        y=self.paragraph(s['addressed'],y,size=10.5,leading=15)+12
        y=self.paragraph(s['action'],y,size=10.5,leading=15)+19
        self.line(y)
        self.label('PREPARED FOLLOW-UP / CUSTOMER-REVIEWED EXAMPLE',y+15)
        y=self.paragraph(s['subject'],y+33,size=10.5,leading=15,font='Bold')+16
        for text in s['paragraphs']:
            y=self.paragraph(text,y,x=LEFT+15,width=WIDTH-30,size=11,leading=15.5)+9
        self.paragraph(s['send_note'],y+3,size=10,leading=14,color=COPY)

    def link(self,label,url,top,size=10.5,font='Body'):
        self.text(label,top,size=size,font=font,color=BLUE)
        width=pdfmetrics.stringWidth(label,font,size)
        self.c.linkURL(url,(LEFT,H-top-size-3,LEFT+width,H-top+2),relative=0)
        return top+size+5

    def handoff(self):
        s = self.d['handoff']
        y=self.start('05 / FOR THE REFERRING ATTORNEY','A simple handoff for your client',s['intro'])
        y=self.paragraph(s['benefit'],y,size=10.5,leading=15)+15
        y=self.paragraph(s['steps'][2][1],y,size=10.5,leading=15)+19
        self.line(y)
        y=self.heading(s['price'],y+16,size=14)
        y=self.paragraph(s['price_note'],y,size=10.5,leading=15)+15
        for title,body in s['refunds']:
            y=self.paragraph(title,y,size=10.5,leading=15,font='Bold')+5
            y=self.paragraph(body,y,size=10.5,leading=15)+14
        y=self.paragraph(s['refund_note'],y,size=10,leading=14,color=COPY)+10
        y=self.link('Complete refund policy: venfour.com/refund-policy',self.d['links']['refund'],y,size=10)+19
        self.box(y,66)
        self.paragraph(s['cta'],y+12,x=LEFT+15,width=WIDTH-30,size=12,leading=16,font='Bold')
        label=self.d['links']['start'].removeprefix('https://')
        self.text(label,y+37,LEFT+15,size=10.5,color=BLUE)
        self.c.linkURL(self.d['links']['start'],(LEFT+15,H-y-54,RIGHT-15,H-y-32),relative=0)
        y+=77
        self.paragraph(s['limits'],y,size=10,leading=14,color=COPY)

    def build(self):
        for section in [self.cover,self.insurer,self.market,self.request,self.response,self.handoff]:
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
    parser.add_argument('--output', type=Path, default=ROOT.parent / 'Venfour-Sample-Total-Loss-Review.pdf')
    parser.add_argument('--fonts-dir', type=Path, help='Folder containing regular.ttf, bold.ttf, italic.ttf and wordmark.ttf')
    args = parser.parse_args()
    data = json.loads(args.content.read_text())
    validate(data)
    register_fonts(args.fonts_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    packet = Packet(data, args.output)
    extents = packet.build()
    (args.output.parent / 'qa' / 'text-extents.json').parent.mkdir(exist_ok=True)
    (args.output.parent / 'qa' / 'text-extents.json').write_text(json.dumps(extents, indent=2) + '\n')
    print(f'Created {args.output}')
    (args.output.parent / 'qa' / 'chart-geometry.json').write_text(json.dumps(packet.chart_geometry, indent=2) + '\n')
    print(f'6 pages; {len(extents)} text blocks; sample calculations verified')


if __name__ == '__main__':
    main()
