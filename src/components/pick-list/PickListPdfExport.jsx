import { jsPDF } from 'jspdf';
import { format } from 'date-fns';

/**
 * Generates a professional PDF pick list with categories, checkboxes, and clean formatting.
 */
export function generatePickListPdf({ run, lines, pickItems, categories }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentW = pageW - margin * 2;
  let y = margin;

  const addNewPage = () => {
    doc.addPage();
    y = margin;
    drawFooter();
  };

  const checkSpace = (needed) => {
    if (y + needed > pageH - 20) addNewPage();
  };

  const drawFooter = () => {
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text(`Lean Living Production — Pick List ${run.run_number} — Printed ${format(new Date(), 'dd MMM yyyy HH:mm')}`, margin, pageH - 8);
    doc.text(`Page ${doc.getNumberOfPages()}`, pageW - margin, pageH - 8, { align: 'right' });
    doc.setTextColor(0);
  };

  // ── Title Block ──
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('PICK LIST', margin, y + 6);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(run.run_number || '', pageW - margin, y + 6, { align: 'right' });
  y += 12;

  // Info row
  doc.setFontSize(9);
  doc.setTextColor(100);
  const runDate = run.run_date ? format(new Date(run.run_date), 'dd MMM yyyy') : '—';
  doc.text(`Date: ${runDate}   |   Meals: ${lines.length}   |   Ingredients: ${pickItems.length}   |   Categories: ${categories.length}`, margin, y);
  doc.setTextColor(0);
  y += 4;

  // Divider
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  // Signature line at top
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text('Picked by: ______________________   Checked by: ______________________   Time: __________', margin, y);
  doc.setTextColor(0);
  y += 8;

  // Column positions
  const colCheck = margin;
  const colSku = margin + 8;
  const colName = margin + 32;
  const colQty = pageW - margin - 20;
  const colUom = pageW - margin - 5;

  // ── Loop through categories ──
  for (const cat of categories) {
    const catItems = pickItems.filter(i => i.pickCategory === cat);
    if (catItems.length === 0) continue;

    // Category header
    checkSpace(16);
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, y - 1, contentW, 7, 'F');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`${cat}  (${catItems.length})`, margin + 2, y + 4);
    y += 9;

    // Column headers
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(120);
    doc.text('✓', colCheck, y);
    doc.text('SKU', colSku, y);
    doc.text('INGREDIENT', colName, y);
    doc.text('QTY', colQty + 15, y, { align: 'right' });
    doc.text('UOM', colUom, y, { align: 'right' });
    doc.setTextColor(0);
    y += 1;
    doc.setDrawColor(200);
    doc.setLineWidth(0.2);
    doc.line(margin, y, pageW - margin, y);
    y += 3.5;

    // Rows
    doc.setFont('helvetica', 'normal');
    for (const item of catItems) {
      checkSpace(7);
      // Checkbox
      doc.setDrawColor(100);
      doc.setLineWidth(0.3);
      doc.rect(colCheck, y - 2.5, 4, 4);

      doc.setFontSize(7.5);
      doc.setTextColor(120);
      doc.text(item.product.sku || '', colSku, y);

      doc.setTextColor(30);
      doc.setFontSize(8);
      // Truncate long names
      const name = item.product.name.length > 40 ? item.product.name.substring(0, 38) + '…' : item.product.name;
      doc.text(name, colName, y);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(item.totalQty.toLocaleString(), colQty + 15, y, { align: 'right' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(120);
      doc.text(item.uom || '', colUom, y, { align: 'right' });
      doc.setTextColor(0);

      y += 5.5;
    }

    y += 3;
  }

  // Notes section
  checkSpace(25);
  y += 4;
  doc.setDrawColor(200);
  doc.setLineWidth(0.2);
  doc.line(margin, y, pageW - margin, y);
  y += 5;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('NOTES:', margin, y);
  y += 4;
  doc.setFont('helvetica', 'normal');
  for (let i = 0; i < 3; i++) {
    doc.setDrawColor(220);
    doc.line(margin, y + 5, pageW - margin, y + 5);
    y += 7;
  }

  drawFooter();

  doc.save(`Pick-List-${run.run_number || 'export'}.pdf`);
}