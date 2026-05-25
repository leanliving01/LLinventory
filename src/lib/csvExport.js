/**
 * Download an array of objects as a CSV file.
 * @param {string} filename  e.g. "purchase_report.csv"
 * @param {Object[]} rows    array of flat objects
 * @param {string[]} [columns]  optional ordered list of keys; defaults to all keys from first row
 */
export function downloadCSV(filename, rows, columns) {
  if (!rows.length) return;
  const cols = columns || Object.keys(rows[0]);
  const header = cols.join(',');
  const body = rows.map(row =>
    cols.map(c => {
      const v = row[c] ?? '';
      const s = String(v).replace(/"/g, '""');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
    }).join(',')
  ).join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Export stock movements as CSV.
 * @param {Object[]} rows  Pre-formatted movement rows
 * @param {string} filename
 */
export function exportMovementsCSV(rows, filename) {
  downloadCSV(filename, rows, ['Date', 'SKU', 'Product', 'Reason', 'Qty', 'UoM', 'Reference', 'Notes']);
}