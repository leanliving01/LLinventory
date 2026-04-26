import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Retroactively fixes UoM on existing PurchaseOrderLines by parsing
 * the product_name (description from Xero) for unit hints.
 * Only updates lines that currently have 'pcs' and where a better
 * UoM can be inferred from the description.
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

    // Fetch all PO lines (paginated)
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

    console.log(`Total PO lines: ${allLines.length}`);

    // Only fix lines where uom is 'pcs' (the default fallback)
    const candidates = allLines.filter(l => l.uom === 'pcs');
    console.log(`Lines with 'pcs' UoM: ${candidates.length}`);

    // Group by parsed UoM to minimize API calls
    const byNewUom = {};
    const unchanged = [];
    for (const line of candidates) {
      const parsed = parseUomFromDescription(line.product_name);
      if (parsed && parsed !== 'pcs') {
        if (!byNewUom[parsed]) byNewUom[parsed] = [];
        byNewUom[parsed].push(line);
      } else {
        unchanged.push(line.product_name);
      }
    }

    let updated = 0;
    const changes = [];

    // Process in small batches with delays to avoid rate limits
    for (const [newUom, linesToFix] of Object.entries(byNewUom)) {
      for (let i = 0; i < linesToFix.length; i++) {
        const line = linesToFix[i];
        await base44.asServiceRole.entities.PurchaseOrderLine.update(line.id, { uom: newUom });
        changes.push({ product_name: line.product_name, new_uom: newUom });
        updated++;
        // Throttle: pause every 5 updates
        if (updated > 0 && updated % 5 === 0) {
          await new Promise(r => setTimeout(r, 5000));
        }
      }
    }

    console.log(`Updated: ${updated} lines, Unchanged: ${unchanged.length}`);

    return Response.json({
      success: true,
      total_lines: allLines.length,
      candidates_checked: candidates.length,
      updated,
      unchanged_sample: unchanged.slice(0, 20),
      changes: changes.slice(0, 50),
    });
  } catch (error) {
    console.error('fixPurchaseOrderUom error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});