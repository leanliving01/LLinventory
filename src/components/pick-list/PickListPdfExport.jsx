import { jsPDF } from 'jspdf';
import { format } from 'date-fns';

/**
 * Compact, minimal PDF pick list — matches the on-screen layout.
 * Tight row spacing to minimize pages.
 */
export function generatePickListPdf({ run, lines, pickItems, categories, pickedState = {} }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentW = pageW - margin * 2;
  let y = margin;
  const rowH = 4.2; // tight row height

  const checkSpace = (needed) => {
    if (y + needed > pageH - 12) {
      doc.addPage();
      y = margin;
    }
  };

  // Check if any items have been picked (to show Picked column)
  const hasPicked = pickItems.some(i => {
    const s = pickedState[i.product?.id];
    return s?.picked && s?.qty && Number(s.qty) > 0;
  });

  // Column positions — aligned like the screen
  const colCheck = margin;
  const colSku = margin + 6;
  const colName = margin + 28;
  const colPicked = hasPicked ? pageW - margin - 28 : null;
  const colQty = hasPicked ? pageW - margin - 14 : pageW - margin - 14;
  const colUom = pageW - margin;

  // ── Header ──
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('PICK LIST', margin, y + 5);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(run.run_number || '', pageW - margin, y + 5, { align: 'right' });
  y += 8;

  doc.setFontSize(8);
  doc.setTextColor(100);
  const runDate = run.run_date ? format(new Date(run.run_date), 'dd MMM yyyy') : '—';
  doc.text(`${runDate}  ·  ${lines.length} meals  ·  ${pickItems.length} ingredients`, margin, y);
  doc.text(`Printed ${format(new Date(), 'dd MMM yyyy HH:mm')}`, pageW - margin, y, { align: 'right' });
  doc.setTextColor(0);
  y += 3;
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 3;

  // Signature line
  doc.setFontSize(7);
  doc.setTextColor(120);
  doc.text('Picked by: ________________________   Checked: ________________________   Time: _________', margin, y);
  doc.setTextColor(0);
  y += 5;

  // ── Categories ──
  for (const cat of categories) {
    const catItems = pickItems.filter(i => i.pickCategory === cat);
    if (catItems.length === 0) continue;

    // Category header
    checkSpace(8 + rowH * 2);
    doc.setFillColor(235, 235, 235);
    doc.rect(margin, y - 0.5, contentW, 5.5, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30);
    doc.text(`${cat}  (${catItems.length})`, margin + 1.5, y + 3.5);
    y += 7;

    // Column sub-headers for this category
    doc.setFontSize(6);
    doc.setTextColor(120);
    doc.text('Needed', colQty, y, { align: 'right' });
    if (hasPicked) {
      doc.text('Picked', colPicked, y, { align: 'right' });
    }
    doc.setTextColor(0);
    y += 3;

    // Rows
    doc.setFont('helvetica', 'normal');
    for (const item of catItems) {
      checkSpace(rowH + 1);

      const ps = pickedState[item.product?.id];
      const pickedQty = ps?.picked && ps?.qty ? Number(ps.qty) : 0;
      const isPicked = pickedQty > 0;

      // Checkbox — filled if picked
      doc.setDrawColor(120);
      doc.setLineWidth(0.25);
      if (isPicked) {
        doc.setFillColor(34, 139, 34);
        doc.rect(colCheck, y - 2, 3, 3, 'FD');
        // Tick mark
        doc.setDrawColor(255, 255, 255);
        doc.setLineWidth(0.4);
        doc.line(colCheck + 0.6, y - 0.3, colCheck + 1.2, y + 0.3);
        doc.line(colCheck + 1.2, y + 0.3, colCheck + 2.4, y - 1.2);
        doc.setDrawColor(120);
        doc.setLineWidth(0.25);
      } else {
        doc.rect(colCheck, y - 2, 3, 3);
      }

      // SKU
      doc.setFontSize(6.5);
      doc.setTextColor(130);
      doc.text(item.product.sku || '', colSku, y);

      // Name
      doc.setFontSize(7.5);
      doc.setTextColor(20);
      const nameEnd = hasPicked ? colPicked - 4 : colQty - 4;
      const maxNameW = nameEnd - colName;
      const name = doc.getStringUnitWidth(item.product.name) * 7.5 / doc.internal.scaleFactor > maxNameW
        ? item.product.name.substring(0, 36) + '…'
        : item.product.name;
      doc.text(name, colName, y);

      // Picked qty (if column is shown)
      if (hasPicked) {
        doc.setFont('helvetica', isPicked ? 'bold' : 'normal');
        doc.setFontSize(8);
        doc.setTextColor(isPicked ? 34 : 180, isPicked ? 139 : 180, isPicked ? 34 : 180);
        doc.text(isPicked ? pickedQty.toLocaleString() : '—', colPicked, y, { align: 'right' });
      }

      // Needed qty
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(0);
      doc.text(item.totalQty.toLocaleString(), colQty, y, { align: 'right' });

      // UoM
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(130);
      doc.text(item.uom || '', colUom, y, { align: 'right' });

      doc.setTextColor(0);
      y += rowH;
    }

    y += 2; // gap between categories
  }

  // Footer on all pages
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(6);
    doc.setTextColor(160);
    doc.text(`Lean Living — ${run.run_number}`, margin, pageH - 6);
    doc.text(`Page ${p}/${totalPages}`, pageW - margin, pageH - 6, { align: 'right' });
  }

  doc.save(`Pick-List-${run.run_number || 'export'}.pdf`);
}