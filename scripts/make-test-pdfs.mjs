// Writes the small PDFs the document checks are tested against, by hand, so every byte in
// them is known and nothing depends on a PDF library's defaults:
//   node scripts/make-test-pdfs.mjs
// Output goes to test/fixtures/site/docs/ and is committed.
//   tagged.pdf    tagged, titled (and set to show the title), language declared: clean
//   untagged.pdf  text with no tags, no title and no language
//   scanned.pdf   one picture of a page and no text, untagged; titled but the title is not shown
//   long.pdf      twelve tagged pages with a title and language but no bookmarks
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../test/fixtures/site/docs/', import.meta.url));

// Objects are numbered from 1 in the order given. A stream is { dict, data }.
function build(objects, { root, info }) {
  const chunks = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let length = chunks[0].length;
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(length);
    const body = typeof obj === 'string'
      ? Buffer.from(`${i + 1} 0 obj\n${obj}\nendobj\n`, 'latin1')
      : Buffer.concat([
        Buffer.from(`${i + 1} 0 obj\n<< ${obj.dict} /Length ${obj.data.length} >>\nstream\n`, 'latin1'),
        obj.data,
        Buffer.from('\nendstream\nendobj\n', 'latin1'),
      ]);
    chunks.push(body);
    length += body.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${root} 0 R${info ? ` /Info ${info} 0 R` : ''} >>\nstartxref\n${length}\n%%EOF\n`;
  chunks.push(Buffer.from(xref + trailer, 'latin1'));
  return Buffer.concat(chunks);
}

const text = (s, mcid) => Buffer.from(
  (mcid === undefined ? '' : `/P << /MCID ${mcid} >> BDC\n`) + `BT /F1 24 Tf 72 700 Td (${s}) Tj ET` + (mcid === undefined ? '' : '\nEMC'),
  'latin1',
);
const FONT = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

// A tagged document: one paragraph per page, each marked with an MCID and pointed at from a
// P element in the structure tree, the way authoring tools write it.
function tagged({ pages, title, lang = 'en-US', showTitle = true }) {
  // 1 catalog, 2 pages, 3 font, 4 struct tree root, 5 document element, 6 parent tree, 7 info,
  // then per page: page, content, P element.
  const first = 8;
  const pageObj = (i) => first + i * 3, contentObj = (i) => first + i * 3 + 1, pObj = (i) => first + i * 3 + 2;
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R /MarkInfo << /Marked true >> /StructTreeRoot 4 0 R${lang ? ` /Lang (${lang})` : ''}${showTitle ? ' /ViewerPreferences << /DisplayDocTitle true >>' : ''} >>`,
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${pages} >>`,
    FONT,
    '<< /Type /StructTreeRoot /K 5 0 R /ParentTree 6 0 R /ParentTreeNextKey ' + pages + ' >>',
    `<< /Type /StructElem /S /Document /P 4 0 R /K [${Array.from({ length: pages }, (_, i) => `${pObj(i)} 0 R`).join(' ')}] >>`,
    `<< /Nums [${Array.from({ length: pages }, (_, i) => `${i} [${pObj(i)} 0 R]`).join(' ')}] >>`,
    `<< /Title (${title}) /Producer (accessready test fixtures) >>`,
  ];
  for (let i = 0; i < pages; i++) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj(i)} 0 R /StructParents ${i} >>`,
      { dict: '', data: text(`${title}, page ${i + 1}`, 0) },
      `<< /Type /StructElem /S /P /P 5 0 R /Pg ${pageObj(i)} 0 R /K 0 >>`,
    );
  }
  return build(objects, { root: 1, info: 7 });
}

function untagged() {
  return build([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    FONT,
    { dict: '', data: text('Volunteer handbook') },
  ], { root: 1 });
}

// A "scan": the page is one grey picture. Real scans are photographs of text; a gradient is
// enough here, because the check only asks whether a page with a picture has any text.
function scanned() {
  const pixels = Buffer.alloc(64);
  for (let i = 0; i < 64; i++) pixels[i] = (i * 4) & 0xff;
  return build([
    '<< /Type /Catalog /Pages 2 0 R /Lang (en-US) >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>',
    { dict: '/Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceGray /BitsPerComponent 8', data: pixels },
    { dict: '', data: Buffer.from('q 400 0 0 300 100 400 cm /Im1 Do Q', 'latin1') },
    '<< /Title (Spring event flyer) >>',
  ], { root: 1, info: 6 });
}

mkdirSync(OUT, { recursive: true });
const files = {
  'tagged.pdf': tagged({ pages: 1, title: 'Annual report 2026' }),
  'untagged.pdf': untagged(),
  'scanned.pdf': scanned(),
  'long.pdf': tagged({ pages: 12, title: 'Program guide' }),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(OUT + name, data);
  console.log(`${name}  ${data.length} bytes`);
}
