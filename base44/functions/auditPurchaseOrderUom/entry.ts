import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Audit-only: checks how many PO lines still have 'pcs' and whether
 * a better UoM can be parsed from their description. No updates.
 */

function parseUomFromDescription(description) {
  if (!description) return null;
  const d = description.toUpperCase();
  if (/P\/KG|\/KG|PER\s*KG|PER\s*KILO/i.test(d)) return 'kg';
  if (/P\/G\b|\/G\b|PER\s*GRAM/i.test(d)) return 'g';
  if (/P\/L\b|\/L\b|PER\s*LIT/i.test(d)) return 'L';
  if (/P\/ML|\/ML|PER\s*ML/i.test(d)) return 'ml';
  if (/\bEACH\b/i.test(d)) return 'pcs';
  if (/\d+\s*[xX]\s*\d+\s*(kg|g|l|ml)\b/i.test(d)) return 'box';
  return null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    let allLines = [];
    let offset = 0;
    while (true) {
      const batch = await base44.asServiceRole.entities.PurchaseOrderLine.filter(
        {}, 'created_date', 500, offset
      );
      allLines = allLines.concat(batch);
      if (batch.length < 500) break;
      offset += 500;
    }

    const pcsLines = allLines.filter(l => l.uom === 'pcs');
    const fixable = [];
    const genuinePcs = [];

    for (const line of pcsLines) {
      const parsed = parseUomFromDescription(line.product_name);
      if (parsed && parsed !== 'pcs') {
        fixable.push({ id: line.id, name: line.product_name, suggested_uom: parsed });
      } else {
        genuinePcs.push(line.product_name);
      }
    }

    // Also show what UoMs are now in use
    const uomCounts = {};
    allLines.forEach(l => {
      uomCounts[l.uom || 'null'] = (uomCounts[l.uom || 'null'] || 0) + 1;
    });

    return Response.json({
      total_lines: allLines.length,
      still_pcs: pcsLines.length,
      fixable_count: fixable.length,
      genuine_pcs_count: genuinePcs.length,
      uom_distribution: uomCounts,
      fixable_sample: fixable.slice(0, 30),
      genuine_pcs_sample: genuinePcs.slice(0, 30),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});