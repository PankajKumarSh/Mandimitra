import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildXlsx, colName, safeSheetName } from '../utils/xlsx.ts';

/** Minimal ZIP reader (central directory → entries) to verify what we wrote, independent of the writer. */
function unzip(buf: Buffer): Map<string, string> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd).toBeGreaterThan(0);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    expect(buf.readUInt32LE(off)).toBe(0x04034b50);
    const lnlen = buf.readUInt16LE(off + 26);
    const lelen = buf.readUInt16LE(off + 28);
    const data = buf.subarray(off + 30 + lnlen + lelen, off + 30 + lnlen + lelen + csize);
    const raw = method === 8 ? inflateRawSync(data) : data;
    expect(raw.length).toBe(usize);
    out.set(name, raw.toString('utf8'));
    p += 46 + nlen + elen + clen;
  }
  return out;
}

/** Well-formedness check: every opened tag is closed in order. */
function balanced(x: string): boolean {
  const stack: string[] = [];
  for (const m of x.replace(/<\?xml[^>]*\?>/g, '').matchAll(/<(\/?)([A-Za-z][\w:.-]*)[^>]*?(\/?)>/g)) {
    const [, close, tag, self] = m;
    if (self) continue;
    if (close) {
      if (stack.pop() !== tag) return false;
    } else stack.push(tag!);
  }
  return stack.length === 0;
}

describe('xlsx writer', () => {
  const buf = buildXlsx({
    name: 'Farmer: Outstanding [Nov]',
    title: 'किसान बकाया / Farmer outstanding',
    subtitle: '01/11/2026 – 20/11/2026',
    columns: [
      { header: 'Code', type: 'text' },
      { header: 'नाम', type: 'text' },
      { header: 'Weight (kg)', type: 'weight' },
      { header: 'Bags', type: 'int' },
      { header: 'Amount', type: 'money' },
    ],
    rows: [
      ['F-00001', 'राम कुमार <&> "quotes"', '5200.000', 104, '125000.50'],
      ['F-00002', 'Mohan', '0.5', 0, '-3000'],
      ['F-00003', null, null, null, '999999999999.99'],
    ],
    totals: ['Total', '', '5200.500', 104, '1000000122000.49'],
  });

  it('is a valid ZIP with all required OOXML parts', () => {
    expect(buf.subarray(0, 4).toString('hex')).toBe('504b0304');
    const files = unzip(buf);
    expect([...files.keys()].sort()).toEqual(
      ['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'].sort(),
    );
    for (const [name, content] of files) expect(balanced(content), name).toBe(true);
  });

  it('writes exact decimal strings as numbers and escapes text', () => {
    const sheet = unzip(buf).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<v>125000.50</v>');
    expect(sheet).toContain('<v>999999999999.99</v>'); // no float rounding
    expect(sheet).toContain('<v>-3000</v>');
    expect(sheet).toContain('राम कुमार &lt;&amp;&gt; &quot;quotes&quot;');
    expect(sheet).toContain('किसान बकाया / Farmer outstanding');
    expect(sheet).toMatch(/<pane ySplit="4"/); // title, subtitle, blank, header → freeze below row 4
  });

  it('sanitises the sheet name', () => {
    const wb = unzip(buf).get('xl/workbook.xml')!;
    expect(wb).toContain('name="Farmer- Outstanding -Nov-"');
    expect(safeSheetName('x'.repeat(40))).toHaveLength(31);
  });

  it('column letters', () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(colName)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });
});
