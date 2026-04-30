import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Upload } from 'lucide-react';
import InventoryImportReview from './InventoryImportReview';

/**
 * CSV Import button + file picker.
 * Parses the CSV and opens the review modal with diffs.
 *
 * Props:
 *  - products: all Product records (to match SKUs)
 *  - stockByProduct: { productId: { on_hand, committed, available } }
 *  - onImportComplete: callback after successful import
 */
/**
 * Auto-detect CSV delimiter from the header line.
 * Excel in South African locale uses semicolon (;) when decimal is comma.
 * Also handles tab-separated.
 */
function detectDelimiter(headerLine) {
  // Count occurrences of common delimiters outside quotes
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

function parseCSVLine(line, delimiter = ',') {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Robustly parse a numeric string — strips locale thousand separators,
 * spaces, currency symbols, and handles both comma and period decimals.
 */
function parseNumber(raw) {
  if (raw == null) return NaN;
  // Strip BOM, whitespace, currency symbols, spaces used as thousands sep
  let cleaned = String(raw).replace(/[\u00A0\u200B\uFEFF]/g, '').trim();
  // Remove anything that isn't digit, minus, period, or comma
  cleaned = cleaned.replace(/[^0-9.\-,]/g, '');
  if (!cleaned) return NaN;
  // If comma is used as decimal (e.g. "1.234,56"), convert to period decimal
  if (cleaned.includes(',') && cleaned.includes('.')) {
    // "1.234,56" → "1234.56" or "1,234.56" → "1234.56"
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    // Could be "1,234" (thousands) or "1,5" (decimal) — check position
    const parts = cleaned.split(',');
    if (parts.length === 2 && parts[1].length === 3) {
      // Likely thousands separator: "1,234"
      cleaned = cleaned.replace(/,/g, '');
    } else {
      // Likely decimal: "1,5"
      cleaned = cleaned.replace(',', '.');
    }
  }
  return parseFloat(cleaned);
}

export default function InventoryCSVImport({ products, stockByProduct, onImportComplete }) {
  const [changes, setChanges] = useState(null);
  const [parseErrors, setParseErrors] = useState([]);
  const fileRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Build SKU lookup fresh each time (captures latest products prop)
    const skuToProduct = {};
    products.forEach(p => {
      if (p.sku) skuToProduct[p.sku.trim().toLowerCase()] = p;
    });

    const reader = new FileReader();
    reader.onload = (evt) => {
      // Strip BOM if present
      let text = evt.target.result;
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) {
        setParseErrors(['CSV file is empty or has no data rows.']);
        return;
      }

      // Auto-detect delimiter (comma vs semicolon vs tab)
      const delimiter = detectDelimiter(lines[0]);

      const headers = parseCSVLine(lines[0], delimiter).map(h =>
        h.toLowerCase().replace(/[\u00A0\u200B\uFEFF]/g, '').replace(/\s+/g, '_')
      );

      // Validate required headers
      const skuIdx = headers.indexOf('sku');
      const onHandIdx = headers.indexOf('on_hand');
      const reorderIdx = headers.indexOf('reorder_point');

      if (skuIdx === -1) {
        setParseErrors(['Missing required "sku" column in CSV. Detected delimiter: "' + (delimiter === '\t' ? 'TAB' : delimiter) + '". Headers found: ' + headers.join(', ')]);
        return;
      }

      const diffs = [];
      const errors = [];
      let matchedCount = 0;

      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i], delimiter);
        const sku = (cols[skuIdx] || '').replace(/[\u00A0\u200B\uFEFF]/g, '').trim();
        if (!sku) continue;

        const product = skuToProduct[sku.toLowerCase()];
        if (!product) {
          errors.push(`Row ${i + 1}: SKU "${sku}" not found in system — skipped.`);
          continue;
        }

        matchedCount++;
        const currentStock = stockByProduct[product.id] || { on_hand: 0, committed: 0, available: 0 };
        const currentReorder = product.min_before_reorder || 0;

        const csvOnHand = onHandIdx !== -1 ? parseNumber(cols[onHandIdx]) : NaN;
        const csvReorder = reorderIdx !== -1 ? parseNumber(cols[reorderIdx]) : NaN;

        const rowChanges = {};
        if (!isNaN(csvOnHand) && Math.abs(csvOnHand - currentStock.on_hand) > 0.001) {
          rowChanges.on_hand = { from: currentStock.on_hand, to: csvOnHand };
        }
        if (!isNaN(csvReorder) && Math.abs(csvReorder - currentReorder) > 0.001) {
          rowChanges.reorder_point = { from: currentReorder, to: csvReorder };
        }

        if (Object.keys(rowChanges).length > 0) {
          diffs.push({
            product,
            currentStock,
            changes: rowChanges,
          });
        }
      }

      // Add summary as first info line
      const summary = `Parsed ${lines.length - 1} data rows · Matched ${matchedCount} SKUs · ${diffs.length} with changes · Delimiter: "${delimiter === '\t' ? 'TAB' : delimiter}"`;
      setParseErrors([summary, ...errors]);
      setChanges(diffs);
    };
    reader.readAsText(file);
    // Reset so same file can be re-selected
    e.target.value = '';
  };

  return (
    <>
      <input
        type="file"
        accept=".csv"
        ref={fileRef}
        className="hidden"
        onChange={handleFile}
      />
      <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="gap-1.5">
        <Upload className="w-4 h-4" /> Import CSV
      </Button>

      {changes !== null && (
        <InventoryImportReview
          diffs={changes}
          parseErrors={parseErrors}
          onClose={() => { setChanges(null); setParseErrors([]); }}
          onImportComplete={onImportComplete}
        />
      )}
    </>
  );
}