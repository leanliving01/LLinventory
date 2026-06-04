// Shared CSV parsing helpers (locale-aware — handles SA semicolon/comma decimals).

const STRIP_CHARS = /[ ​﻿]/g; // nbsp, zero-width space, BOM

// Auto-detect the delimiter from the header line (comma, semicolon or tab).
export function detectDelimiter(headerLine) {
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = 0;
  for (const delim of candidates) {
    let count = 0;
    let inQ = false;
    for (const ch of headerLine) {
      if (ch === '"') inQ = !inQ;
      else if (ch === delim && !inQ) count++;
    }
    if (count > bestCount) { bestCount = count; best = delim; }
  }
  return best;
}

// Parse one CSV line, honouring quoted fields and escaped quotes.
export function parseCSVLine(line, delimiter = ',') {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === delimiter) { result.push(current.trim()); current = ''; }
      else current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// Robustly parse a numeric string — strips locale thousand separators, spaces,
// currency symbols, and handles both comma and period decimals.
export function parseNumber(raw) {
  if (raw == null) return NaN;
  let cleaned = String(raw).replace(STRIP_CHARS, '').trim();
  cleaned = cleaned.replace(/[^0-9.\-,]/g, '');
  if (!cleaned) return NaN;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    const parts = cleaned.split(',');
    if (parts.length === 2 && parts[1].length === 3) cleaned = cleaned.replace(/,/g, '');
    else cleaned = cleaned.replace(',', '.');
  }
  return parseFloat(cleaned);
}

// Split raw file text into non-empty rows of cells using a detected delimiter.
export function parseCSV(text) {
  const lines = String(text).split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return { header: [], rows: [], delimiter: ',' };
  const delimiter = detectDelimiter(lines[0]);
  const header = parseCSVLine(lines[0], delimiter).map(h => h.toLowerCase().replace(STRIP_CHARS, '').trim());
  const rows = lines.slice(1).map(l => parseCSVLine(l, delimiter));
  return { header, rows, delimiter };
}
