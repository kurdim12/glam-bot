// Minimal PDF writer for the GLAMBOT invoice — no libraries, no deps.
// Emits PDF 1.4 with the base-14 Helvetica fonts (WinAnsi encoding), which
// every viewer ships built in, so the file needs no embedded fonts and stays
// a few KB. Layout mirrors the HTML print view / the brand template:
// dark header band, orange INVOICE, items table, Subtotal/Tax/TOTAL.
//
// Limitation (documented in the README): base-14 fonts are Latin-only, so
// Arabic characters fall back to '?'. The /print view remains the
// full-Unicode path — this endpoint exists for direct download/attachments.

/* Helvetica AFM widths (per 1000 em) for the printable Latin range. */
// prettier-ignore
const HELV = {32:278,33:278,34:355,35:556,36:556,37:889,38:667,39:191,40:333,41:333,42:389,43:584,44:278,45:333,46:278,47:278,48:556,49:556,50:556,51:556,52:556,53:556,54:556,55:556,56:556,57:556,58:278,59:278,60:584,61:584,62:584,63:556,64:1015,65:667,66:667,67:722,68:722,69:667,70:611,71:778,72:722,73:278,74:500,75:667,76:556,77:833,78:722,79:778,80:667,81:778,82:722,83:667,84:611,85:722,86:667,87:944,88:667,89:667,90:611,91:278,92:278,93:278,94:469,95:556,96:333,97:556,98:556,99:500,100:556,101:556,102:278,103:556,104:556,105:222,106:222,107:500,108:222,109:833,110:556,111:556,112:556,113:556,114:333,115:500,116:278,117:556,118:500,119:722,120:500,121:500,122:500,123:334,124:260,125:334,126:584};
// prettier-ignore
const HELV_BOLD = {32:278,33:333,34:474,35:556,36:556,37:889,38:722,39:238,40:333,41:333,42:389,43:584,44:278,45:333,46:278,47:278,48:556,49:556,50:556,51:556,52:556,53:556,54:556,55:556,56:556,57:556,58:333,59:333,60:584,61:584,62:584,63:611,64:975,65:722,66:722,67:722,68:722,69:667,70:611,71:778,72:722,73:278,74:556,75:722,76:611,77:833,78:722,79:778,80:667,81:778,82:722,83:667,84:611,85:722,86:667,87:944,88:667,89:667,90:611,91:333,92:278,93:333,94:584,95:556,96:333,97:556,98:611,99:556,100:611,101:556,102:333,103:611,104:611,105:278,106:278,107:556,108:278,109:889,110:611,111:611,112:611,113:611,114:389,115:556,116:333,117:611,118:556,119:778,120:556,121:556,122:500,123:389,124:280,125:389,126:584};

// Typographic characters WinAnsi supports beyond Latin-1 (code, width).
const WINANSI_EXTRA = {
  0x2014: [0x97, 1000], // — em dash
  0x2013: [0x96, 556], // – en dash
  0x2018: [0x91, 222], // '
  0x2019: [0x92, 222], // '
  0x201c: [0x93, 333], // "
  0x201d: [0x94, 333], // "
  0x2026: [0x85, 1000], // …
  0x00b7: [0xb7, 278], // ·
};

/** Unicode string → WinAnsi byte codes (unsupported → '?'). */
function toWinAnsi(s) {
  const out = [];
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    if (cp >= 32 && cp <= 126) out.push(cp);
    else if (WINANSI_EXTRA[cp]) out.push(WINANSI_EXTRA[cp][0]);
    else if (cp >= 0xa0 && cp <= 0xff) out.push(cp); // Latin-1 accents
    else out.push(63); // '?'
  }
  return out;
}

function textWidth(s, size, bold = false, charSpace = 0) {
  const table = bold ? HELV_BOLD : HELV;
  let w = 0;
  let n = 0;
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    if (WINANSI_EXTRA[cp]) w += WINANSI_EXTRA[cp][1];
    else w += table[cp] || table[toWinAnsi(ch)[0]] || 556;
    n++;
  }
  return (w / 1000) * size + Math.max(0, n - 1) * charSpace;
}

/** Escape WinAnsi codes into a PDF literal string. */
function pdfStr(s) {
  return toWinAnsi(s)
    .map((c) => {
      if (c === 0x28 || c === 0x29 || c === 0x5c) return '\\' + String.fromCharCode(c);
      if (c < 32 || c > 126) return '\\' + c.toString(8).padStart(3, '0');
      return String.fromCharCode(c);
    })
    .join('');
}

/** Greedy word-wrap to a max width in points. */
function wrap(s, maxWidth, size, bold = false) {
  const words = String(s).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (textWidth(next, size, bold) <= maxWidth || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

const COL = {
  black: '0.067 0.067 0.067',
  white: '0.961 0.961 0.953',
  orange: '1 0.361 0',
  grey: '0.533 0.533 0.525',
  hair: '0.898 0.898 0.886',
  text: '0.067 0.067 0.067',
};

/** Build the invoice PDF. `inv` is the DB row; totals come from computeTotals. */
export function buildInvoicePdf(inv, { items, subtotal, tax, total }) {
  const ops = [];
  const rect = (x, y, w, h, color) => ops.push(`${color} rg ${x} ${y} ${w} ${h} re f`);
  const text = (x, y, s, { size = 11, bold = false, color = COL.text, charSpace = 0 } = {}) =>
    ops.push(
      `BT ${color} rg /F${bold ? 2 : 1} ${size} Tf ${charSpace ? charSpace + ' Tc ' : ''}${x} ${y} Td (${pdfStr(s)}) Tj${charSpace ? ' 0 Tc' : ''} ET`
    );
  const rightText = (xr, y, s, opt = {}) =>
    text(xr - textWidth(s, opt.size || 11, opt.bold, opt.charSpace || 0), y, s, opt);

  const L = 50; // left margin
  const R = 562; // right edge
  const cur = inv.currency || 'JOD';
  const money = (n) => n.toFixed(2);

  // Header band
  rect(0, 692, 612, 100, COL.black);
  rect(L, 733, 12, 12, COL.orange); // brand mark
  text(L + 20, 734, 'GLAMBOT', { size: 24, bold: true, color: COL.white, charSpace: 1.5 });
  rightText(R, 734, 'INVOICE', { size: 22, bold: true, color: COL.orange, charSpace: 5 });

  // Meta
  let y = 650;
  text(L, y, 'BILLED TO', { size: 8, color: COL.grey, charSpace: 1.2 });
  rightText(R, y, 'INVOICE NO.', { size: 8, color: COL.grey, charSpace: 1.2 });
  text(L, y - 17, inv.client_name, { size: 12, bold: true });
  rightText(R, y - 17, inv.number, { size: 12, bold: true });
  if (inv.client_contact) text(L, y - 33, inv.client_contact, { size: 10, color: COL.grey });
  rightText(R, y - 42, 'DATE', { size: 8, color: COL.grey, charSpace: 1.2 });
  rightText(R, y - 57, String(inv.issued_at || ''), { size: 11 });

  // Items table
  y = 545;
  text(L, y, 'SERVICE OR PACKAGE', { size: 8, color: COL.grey, charSpace: 1.2 });
  rightText(R, y, `AMOUNT (${cur})`, { size: 8, color: COL.grey, charSpace: 1.2 });
  rect(L, y - 8, R - L, 1.6, COL.orange);
  y -= 28;
  for (const it of items) {
    const lines = wrap(it.description, 380, 11);
    rightText(R, y, money(it.amount), { size: 11 });
    for (const line of lines) {
      text(L, y, line, { size: 11 });
      y -= 15;
    }
    y -= 3;
    rect(L, y + 9, R - L, 0.8, COL.hair);
    y -= 12;
    if (y < 220) break; // keep one page; the print view handles monsters
  }

  // Totals
  const tx = 340;
  y -= 8;
  text(tx, y, 'Subtotal', { size: 11, color: COL.grey });
  rightText(R, y, `${money(subtotal)} ${cur}`, { size: 11 });
  y -= 20;
  text(tx, y, `Tax (${inv.tax_rate}%)`, { size: 11, color: COL.grey });
  rightText(R, y, `${money(tax)} ${cur}`, { size: 11 });
  y -= 14;
  rect(tx, y, R - tx, 1.6, COL.black);
  y -= 22;
  text(tx, y, 'TOTAL', { size: 14, bold: true, charSpace: 1.5 });
  rightText(R, y, `${money(total)} ${cur}`, { size: 14, bold: true, color: COL.orange });

  // Notes
  if (inv.notes) {
    y -= 40;
    text(L, y, 'NOTES', { size: 8, color: COL.grey, charSpace: 1.2 });
    y -= 16;
    for (const para of String(inv.notes).split(/\r?\n/)) {
      for (const line of wrap(para, R - L, 10)) {
        text(L, y, line, { size: 10, color: '0.267 0.267 0.267' });
        y -= 14;
        if (y < 110) break;
      }
      if (y < 110) break;
    }
  }

  // Footer
  rect(L, 78, R - L, 0.8, COL.hair);
  text(L, 60, 'GLAMBOT', { size: 8, bold: true, color: COL.orange, charSpace: 0.8 });
  text(L + textWidth('GLAMBOT', 8, true, 0.8) + 6, 60, '— cinematic robotic glam videos · Amman, Jordan', {
    size: 8,
    color: COL.grey,
  });
  rightText(R, 60, 'www.glambotjo.com · book@glambotjo.com', { size: 8, color: COL.grey });

  return assemblePdf(ops.join('\n'));
}

/** Wrap a content stream into a complete single-page PDF file. */
function assemblePdf(content) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  // Every char is a WinAnsi/latin-1 code — emit bytes 1:1.
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
