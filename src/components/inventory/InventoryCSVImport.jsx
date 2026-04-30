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
function parseCSVLine(line) {
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
      } else if (ch === ',') {
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

export default function InventoryCSVImport({ products, stockByProduct, onImportComplete }) {
  const [changes, setChanges] = useState(null);
  const [parseErrors, setParseErrors] = useState([]);
  const fileRef = useRef(null);

  const skuToProduct = {};
  products.forEach(p => {
    if (p.sku) skuToProduct[p.sku.toLowerCase()] = p;
  });

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result;
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) {
        setParseErrors(['CSV file is empty or has no data rows.']);
        return;
      }

      const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'));

      // Validate required headers
      const skuIdx = headers.indexOf('sku');
      const onHandIdx = headers.indexOf('on_hand');
      const reorderIdx = headers.indexOf('reorder_point');

      if (skuIdx === -1) {
        setParseErrors(['Missing required "sku" column in CSV.']);
        return;
      }

      const diffs = [];
      const errors = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        const sku = (cols[skuIdx] || '').trim();
        if (!sku) continue;

        const product = skuToProduct[sku.toLowerCase()];
        if (!product) {
          errors.push(`Row ${i + 1}: SKU "${sku}" not found in system — skipped.`);
          continue;
        }

        const currentStock = stockByProduct[product.id] || { on_hand: 0, committed: 0, available: 0 };
        const currentReorder = product.min_before_reorder || 0;

        const csvOnHand = onHandIdx !== -1 ? parseFloat(cols[onHandIdx]) : null;
        const csvReorder = reorderIdx !== -1 ? parseFloat(cols[reorderIdx]) : null;

        const changes = {};
        if (csvOnHand !== null && !isNaN(csvOnHand) && Math.abs(csvOnHand - currentStock.on_hand) > 0.001) {
          changes.on_hand = { from: currentStock.on_hand, to: csvOnHand };
        }
        if (csvReorder !== null && !isNaN(csvReorder) && Math.abs(csvReorder - currentReorder) > 0.001) {
          changes.reorder_point = { from: currentReorder, to: csvReorder };
        }

        if (Object.keys(changes).length > 0) {
          diffs.push({
            product,
            currentStock,
            changes,
          });
        }
      }

      setParseErrors(errors);
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