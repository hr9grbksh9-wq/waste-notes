// Minimal PDF writer: Helvetica / Helvetica-Bold text (WinAnsi), lines,
// rectangles and JPEG images. No dependencies, works offline.
// Coordinates in the public API are points from the TOP-LEFT of an A4 page.

export const A4 = { w: 595.28, h: 841.89 };

// Standard Helvetica advance widths (1/1000 em) for codes 32..126.
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,
  722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,
  667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,
  222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,
  260,334,584];
const HELV_B = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,
  722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,
  667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,
  278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,
  280,389,584];

// Unicode -> WinAnsi (cp1252) for the characters outside Latin-1.
const CP1252 = { 0x20AC:0x80, 0x201A:0x82, 0x0192:0x83, 0x201E:0x84, 0x2026:0x85,
  0x2020:0x86, 0x2021:0x87, 0x02C6:0x88, 0x2030:0x89, 0x0160:0x8A, 0x2039:0x8B,
  0x0152:0x8C, 0x017D:0x8E, 0x2018:0x91, 0x2019:0x92, 0x201C:0x93, 0x201D:0x94,
  0x2022:0x95, 0x2013:0x96, 0x2014:0x97, 0x02DC:0x98, 0x2122:0x99, 0x0161:0x9A,
  0x203A:0x9B, 0x0153:0x9C, 0x017E:0x9E, 0x0178:0x9F };
const HIGH_WIDTH = { 0x91:222, 0x92:222, 0x93:333, 0x94:333, 0x95:350, 0x96:556,
  0x97:1000, 0x85:1000, 0xA3:556, 0xD7:584, 0xB0:400, 0xB2:333, 0xB3:333 };

function encode(str) {
  const s = String(str ?? '')
    .replace(/→/g, '->').replace(/≈/g, '~').replace(/✓|✔/g, 'Y')
    .replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/[   ]/g, ' ');
  const out = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10 || c === 13) out.push(32);
    else if (c < 32) continue;
    else if (c < 127) out.push(c);
    else if (c >= 0xA0 && c <= 0xFF) out.push(c);
    else if (CP1252[c]) out.push(CP1252[c]);
    else out.push(63); // '?'
  }
  return out;
}

export function textWidth(str, size = 10, bold = false) {
  const table = bold ? HELV_B : HELV;
  let w = 0;
  for (const b of encode(str)) {
    w += b < 127 ? table[b - 32] : (HIGH_WIDTH[b] ?? 556);
  }
  return (w * size) / 1000;
}

// Split text into lines that fit maxWidth (hard-breaking words that are too long).
export function wrap(str, maxWidth, size = 10, bold = false) {
  const lines = [];
  for (const para of String(str ?? '').split('\n')) {
    const words = para.split(/ +/);
    let line = '';
    for (let word of words) {
      const trial = line ? line + ' ' + word : word;
      if (textWidth(trial, size, bold) <= maxWidth) { line = trial; continue; }
      if (line) lines.push(line);
      // a single word longer than the line: hard-break it
      while (textWidth(word, size, bold) > maxWidth) {
        let i = word.length;
        while (i > 1 && textWidth(word.slice(0, i), size, bold) > maxWidth) i--;
        lines.push(word.slice(0, i));
        word = word.slice(i);
      }
      line = word;
    }
    lines.push(line);
  }
  return lines;
}

function pdfString(str) {
  let out = '(';
  for (const b of encode(str)) {
    if (b === 40 || b === 41 || b === 92) out += '\\' + String.fromCharCode(b);
    else if (b > 126) out += '\\' + b.toString(8).padStart(3, '0');
    else out += String.fromCharCode(b);
  }
  return out + ')';
}

const n = (v) => (Math.round(v * 100) / 100).toString();
const rgb = (c) => (Array.isArray(c) ? c : hexToRgb(c)).map((v) => n(v)).join(' ');

export function hexToRgb(hex) {
  const h = String(hex || '#000000').replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function dataUrlToBytes(dataUrl) {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export class PdfDoc {
  constructor({ title = 'Document', author = '' } = {}) {
    this.title = title;
    this.author = author;
    this.pages = [];
    this.images = [];
    this.addPage();
  }

  addPage() {
    this.page = { ops: [], xobjects: new Set() };
    this.pages.push(this.page);
    return this.page;
  }

  // y is the text BASELINE measured from the top of the page.
  text(x, y, str, { size = 10, bold = false, color = [0, 0, 0] } = {}) {
    this.page.ops.push(`BT ${rgb(color)} rg /${bold ? 'F2' : 'F1'} ${n(size)} Tf ${n(x)} ${n(A4.h - y)} Td ${pdfString(str)} Tj ET`);
  }

  line(x1, y1, x2, y2, { width = 0.5, color = [0, 0, 0] } = {}) {
    this.page.ops.push(`${n(width)} w ${rgb(color)} RG ${n(x1)} ${n(A4.h - y1)} m ${n(x2)} ${n(A4.h - y2)} l S`);
  }

  // x, y = top-left corner.
  rect(x, y, w, h, { fill = null, stroke = null, width = 0.5 } = {}) {
    const box = `${n(x)} ${n(A4.h - y - h)} ${n(w)} ${n(h)} re`;
    if (fill && stroke) this.page.ops.push(`${n(width)} w ${rgb(fill)} rg ${rgb(stroke)} RG ${box} B`);
    else if (fill) this.page.ops.push(`${rgb(fill)} rg ${box} f`);
    else this.page.ops.push(`${n(width)} w ${rgb(stroke || [0, 0, 0])} RG ${box} S`);
  }

  // Register a JPEG (data URL); returns an image handle for drawImage.
  addJpeg(dataUrl, width, height) {
    const img = { name: `Im${this.images.length + 1}`, bytes: dataUrlToBytes(dataUrl), width, height };
    this.images.push(img);
    return img;
  }

  drawImage(img, x, y, w, h) {
    this.page.xobjects.add(img);
    this.page.ops.push(`q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(A4.h - y - h)} cm /${img.name} Do Q`);
  }

  output() {
    const parts = [];
    let length = 0;
    const offsets = [];
    const push = (chunk) => {
      const bytes = typeof chunk === 'string' ? latin1(chunk) : chunk;
      parts.push(bytes);
      length += bytes.length;
    };
    const objects = []; // index = object number - 1; each is a function writing the body
    const reserve = () => { objects.push(null); return objects.length; };

    const catalogId = reserve();
    const pagesId = reserve();
    const f1 = reserve();
    const f2 = reserve();
    const infoId = reserve();
    const imageIds = new Map();
    for (const img of this.images) imageIds.set(img, reserve());
    const pageIds = this.pages.map(() => ({ page: reserve(), content: reserve() }));

    const body = new Map();
    body.set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    body.set(pagesId, `<< /Type /Pages /Kids [${pageIds.map((p) => `${p.page} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
    body.set(f1, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    body.set(f2, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const now = new Date();
    const pad = (v) => String(v).padStart(2, '0');
    const stamp = `D:${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
    body.set(infoId, `<< /Title ${pdfString(this.title)} /Author ${pdfString(this.author)} /Producer (Waste Notes) /CreationDate (${stamp}) >>`);

    this.pages.forEach((page, i) => {
      const { page: pid, content: cid } = pageIds[i];
      const xo = [...page.xobjects].map((img) => `/${img.name} ${imageIds.get(img)} 0 R`).join(' ');
      body.set(pid, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${xo ? ` /XObject << ${xo} >>` : ''} >> /Contents ${cid} 0 R >>`);
      const stream = page.ops.join('\n');
      body.set(cid, { dict: `<< /Length ${latin1(stream).length} >>`, bytes: latin1(stream) });
    });
    for (const img of this.images) {
      body.set(imageIds.get(img), {
        dict: `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>`,
        bytes: img.bytes,
      });
    }

    push('%PDF-1.4\n%âãÏÓ\n');
    for (let id = 1; id <= objects.length; id++) {
      offsets[id] = length;
      const b = body.get(id);
      if (typeof b === 'string') push(`${id} 0 obj\n${b}\nendobj\n`);
      else { push(`${id} 0 obj\n${b.dict}\nstream\n`); push(b.bytes); push('\nendstream\nendobj\n'); }
    }
    const xrefAt = length;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let id = 1; id <= objects.length; id++) xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    push(xref);
    push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

    const out = new Uint8Array(length);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }
}

function latin1(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 255;
  return bytes;
}

// Cursor-based layout on top of PdfDoc: headings, paragraphs, key/value rows,
// tables with wrapping and repeated headers, and automatic page breaks.
export class Flow {
  constructor(doc, { margin = 40, top = 40, bottom = 60, theme = {} } = {}) {
    this.doc = doc;
    this.m = margin;
    this.top = top;
    this.bottom = bottom;
    this.y = top;
    this.width = A4.w - margin * 2;
    this.theme = { ink: [0.15, 0.16, 0.17], muted: [0.42, 0.43, 0.45], rule: [0.8, 0.8, 0.8], accent: [0.25, 0.27, 0.27], band: [0.95, 0.95, 0.94], ...theme };
    this.onNewPage = null;
  }

  ensure(h) {
    if (this.y + h > A4.h - this.bottom) {
      this.doc.addPage();
      this.y = this.top;
      if (this.onNewPage) this.onNewPage(this);
    }
  }

  space(h) { this.y += h; }

  // keep = space the following block needs, so a heading never sits alone at a page foot.
  heading(text, { size = 11, keep = 60 } = {}) {
    this.ensure(size + 18 + keep);
    this.y += 8;
    this.doc.rect(this.m, this.y, this.width, size + 8, { fill: this.theme.accent });
    this.doc.text(this.m + 6, this.y + size + 2, text.toUpperCase(), { size: size - 1, bold: true, color: [1, 1, 1] });
    this.y += size + 14;
  }

  para(text, { size = 9, bold = false, color = null, indent = 0, gap = 3 } = {}) {
    const lines = wrap(text, this.width - indent, size, bold);
    for (const line of lines) {
      this.ensure(size + 3);
      this.y += size + 1.5;
      this.doc.text(this.m + indent, this.y, line, { size, bold, color: color || this.theme.ink });
    }
    this.y += gap;
  }

  // Two-column label/value rows; value wraps.
  kv(rows, { labelWidth = 150, size = 9 } = {}) {
    for (const [label, value] of rows) {
      const vLines = wrap(value ?? '', this.width - labelWidth, size, false);
      const lLines = wrap(label, labelWidth - 8, size, true);
      const h = Math.max(vLines.length, lLines.length) * (size + 2.5) + 3;
      this.ensure(h);
      let yy = this.y;
      lLines.forEach((l) => { yy += size + 2.5; this.doc.text(this.m, yy, l, { size, bold: true, color: this.theme.muted }); });
      yy = this.y;
      vLines.forEach((l) => { yy += size + 2.5; this.doc.text(this.m + labelWidth, yy, l, { size, color: this.theme.ink }); });
      this.y += h;
      this.doc.line(this.m, this.y - 1, this.m + this.width, this.y - 1, { width: 0.3, color: this.theme.rule });
    }
    this.y += 3;
  }

  // cols: [{ title, width (fraction), align: 'left'|'right' }]
  table(cols, rows, { size = 8.5 } = {}) {
    const widths = cols.map((c) => c.width * this.width);
    const drawHeader = () => {
      this.ensure(size + 10);
      this.doc.rect(this.m, this.y, this.width, size + 7, { fill: this.theme.band });
      let x = this.m;
      cols.forEach((c, i) => {
        const tx = c.align === 'right' ? x + widths[i] - 4 - textWidth(c.title, size, true) : x + 4;
        this.doc.text(tx, this.y + size + 2, c.title, { size, bold: true, color: this.theme.ink });
        x += widths[i];
      });
      this.y += size + 7;
    };
    drawHeader();
    for (const row of rows) {
      const cells = row.map((cell, i) => wrap(cell ?? '', widths[i] - 8, size, false));
      const h = Math.max(...cells.map((c) => c.length)) * (size + 2) + 5;
      if (this.y + h > A4.h - this.bottom) { this.ensure(h + size + 10); drawHeader(); }
      let x = this.m;
      cells.forEach((lines, i) => {
        let yy = this.y + 1;
        lines.forEach((l) => {
          yy += size + 2;
          const tx = cols[i].align === 'right' ? x + widths[i] - 4 - textWidth(l, size) : x + 4;
          this.doc.text(tx, yy, l, { size, color: this.theme.ink });
        });
        x += widths[i];
      });
      this.y += h;
      this.doc.line(this.m, this.y, this.m + this.width, this.y, { width: 0.3, color: this.theme.rule });
    }
    this.y += 6;
  }
}
