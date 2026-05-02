import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * AI-driven purchase UoM enrichment.
 *
 * Reads ALL matched PurchaseOrderLines, groups by product+supplier,
 * sends the line descriptions to InvokeLLM to determine the correct
 * purchase_uom, purchase_uom_qty, conversion_factor, and label.
 * Then creates SupplierProduct records.
 *
 * Example logic the AI must follow:
 *   "Peanut Butter (Unsalted) x 5kg" → purchase_uom: bag, purchase_uom_qty: 5, conversion_factor: 5, label: "Bag of 5kg"
 *   "BEEF MINCE LEAN 90/10 VL-COOKING WITH-5X2KG" → purchase_uom: box, purchase_uom_qty: 10, conversion_factor: 10, label: "Box of 5×2kg"
 *   "DRESSING SALAD FRENCH-HELLMANNS-1LT" with SKU "Case of 6" → purchase_uom: case, purchase_uom_qty: 6, conversion_factor: 6, label: "Case of 6×1L"
 *   "Spice Paprika Refill 700g" → purchase_uom: bag, purchase_uom_qty: 0.7, conversion_factor: 0.7, label: "700g pack"
 */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Admin only' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dry_run !== false; // default true
  const offset = body.offset || 0; // pagination: skip first N groups
  const limit = body.limit || 40; // max groups per call

  // 1. Load all matched PO lines (product_id is a real ID, not "unmatched")
  const allLines = await base44.asServiceRole.entities.PurchaseOrderLine.filter({}, '-created_date', 5000);
  const matchedLines = allLines.filter(l => l.product_id && l.product_id !== 'unmatched' && l.product_name);
  console.log(`[EnrichUoM] ${matchedLines.length} matched PO lines out of ${allLines.length} total`);

  // 2. Load all POs for supplier info
  const allPOs = await base44.asServiceRole.entities.PurchaseOrder.filter({}, '-created_date', 5000);
  const poMap = {};
  for (const po of allPOs) poMap[po.id] = po;

  // 3. Load all products for stock_uom
  const allProducts = await base44.asServiceRole.entities.Product.filter({}, 'sku', 5000);
  const productMap = {};
  for (const p of allProducts) productMap[p.id] = p;

  // 4. Load existing SupplierProduct records to skip duplicates
  const existingSPs = await base44.asServiceRole.entities.SupplierProduct.filter({}, 'product_id', 5000);
  const existingSPKeys = new Set();
  for (const sp of existingSPs) {
    existingSPKeys.add(`${sp.supplier_id}__${sp.product_id}`);
  }

  // 5. Group by supplier+product — collect all line descriptions for context
  const groups = {};
  for (const line of matchedLines) {
    const po = poMap[line.purchase_order_id];
    if (!po || !po.supplier_id) continue;
    const product = productMap[line.product_id];
    if (!product) continue;

    const key = `${po.supplier_id}__${line.product_id}`;
    if (existingSPKeys.has(key)) continue; // already has SupplierProduct

    if (!groups[key]) {
      groups[key] = {
        supplier_id: po.supplier_id,
        supplier_name: po.supplier_name || '',
        product_id: line.product_id,
        product_sku: product.sku || line.product_sku || '',
        product_name: product.name || line.product_name || '',
        stock_uom: product.stock_uom || 'kg',
        line_uom: line.uom || '',
        descriptions: [],
        skus: [],
        unit_costs: [],
        quantities: [],
      };
    }
    groups[key].descriptions.push(line.product_name);
    if (line.product_sku) groups[key].skus.push(line.product_sku);
    groups[key].unit_costs.push(line.unit_cost || 0);
    groups[key].quantities.push(line.ordered_qty || 0);
  }

  const allGroups = Object.values(groups);
  console.log(`[EnrichUoM] ${allGroups.length} total unique pairs (${existingSPKeys.size} already exist), offset=${offset}, limit=${limit}`);

  if (allGroups.length === 0) {
    return Response.json({ ok: true, message: 'Nothing to process — all pairs already have SupplierProduct records', existing: existingSPKeys.size });
  }

  const groupList = allGroups.slice(offset, offset + limit);
  const hasMore = offset + limit < allGroups.length;
  console.log(`[EnrichUoM] Processing ${groupList.length} pairs (${offset}..${offset + groupList.length} of ${allGroups.length})`);

  if (groupList.length === 0) {
    return Response.json({ ok: true, message: 'Offset beyond available pairs', total: allGroups.length, offset });
  }

  // 6. Process in batches of 20 via AI
  const BATCH_SIZE = 20;
  const results = [];
  let created = 0;
  let errors = 0;

  for (let i = 0; i < groupList.length; i += BATCH_SIZE) {
    const batch = groupList.slice(i, i + BATCH_SIZE);

    const prompt = `You are a food-industry purchasing expert. For each item below, determine the correct PURCHASE unit of measure based on the invoice/PO description.

RULES:
- The "stock_uom" is how we store this product internally (kg, g, L, ml, pcs).
- The "description" is from the supplier invoice — it reveals the actual purchase pack size.
- You must determine:
  - purchase_uom: one of [case, bag, drum, pallet, box, each, kg, L]
  - purchase_uom_qty: the quantity per purchase unit in terms of stock_uom (e.g. a 5kg bag = 5, a case of 6×1L = 6, a 700g pack when stock_uom=kg = 0.7, a 700g pack when stock_uom=g = 700)
  - conversion_factor: always equals purchase_uom_qty (1 purchase unit = X stock units)
  - purchase_uom_label: human-friendly label like "5kg Bag", "Case of 6×1L", "Box of 50×6g", "700g Pack", "10kg Bag"

EXAMPLES:
- Description: "Peanut Butter (Unsalted) x 5kg", stock_uom: kg → purchase_uom: bag, purchase_uom_qty: 5, conversion_factor: 5, label: "5kg Bag"
- Description: "BEEF MINCE LEAN 90/10 VL-COOKING WITH-5X2KG", stock_uom: kg → purchase_uom: box, purchase_uom_qty: 10, conversion_factor: 10, label: "Box of 5×2kg"
- Description: "DRESSING SALAD FRENCH-HELLMANNS-1LT", SKU: "Case of 6", stock_uom: L → purchase_uom: case, purchase_uom_qty: 6, conversion_factor: 6, label: "Case of 6×1L"
- Description: "Spice Paprika Refill 700g", stock_uom: g → purchase_uom: bag, purchase_uom_qty: 700, conversion_factor: 700, label: "700g Pack"
- Description: "Spice Paprika Refill 700g", stock_uom: kg → purchase_uom: bag, purchase_uom_qty: 0.7, conversion_factor: 0.7, label: "700g Pack"
- Description: "Olive Oil 90/10 Cooking Worth 4L", stock_uom: L → purchase_uom: each, purchase_uom_qty: 4, conversion_factor: 4, label: "4L Bottle"
- Description: "CORN-COOKING WITH-10KG", stock_uom: kg, ordered_qty: 1, unit_cost: 1550 → purchase_uom: bag, purchase_uom_qty: 10, conversion_factor: 10, label: "10kg Bag"
- Description: "Beef Mince Lean 90/10", stock_uom: kg, ordered_qty: 200, unit_cost: 121.5 → purchase_uom: kg, purchase_uom_qty: 1, conversion_factor: 1, label: "Per kg"
- Description: "biocide deliver cross 50x6g", stock_uom: pcs → purchase_uom: box, purchase_uom_qty: 50, conversion_factor: 50, label: "Box of 50×6g"

If the description doesn't have pack info AND the ordered quantity and unit cost suggest it's bought per kg/L (e.g. 200 kg at R121.50/kg), then purchase_uom = the stock_uom with conversion_factor = 1.

ITEMS TO PROCESS:
${batch.map((g, idx) => `${idx + 1}. product: "${g.product_name}" (SKU: ${g.product_sku})
   stock_uom: ${g.stock_uom}
   line_uom_on_po: ${g.line_uom}
   descriptions from invoices: ${[...new Set(g.descriptions)].join(' | ')}
   SKUs on PO lines: ${[...new Set(g.skus)].join(' | ')}
   typical ordered_qty: ${g.quantities[0]}, unit_cost: R${g.unit_costs[0]}`).join('\n')}

Return a JSON array with one object per item (same order). Each object has: index, purchase_uom, purchase_uom_qty, conversion_factor, purchase_uom_label, confidence (high/medium/low).`;

    const aiResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                index: { type: 'number' },
                purchase_uom: { type: 'string' },
                purchase_uom_qty: { type: 'number' },
                conversion_factor: { type: 'number' },
                purchase_uom_label: { type: 'string' },
                confidence: { type: 'string' },
              },
            },
          },
        },
      },
    });

    const items = aiResult?.items || [];
    console.log(`[EnrichUoM] Batch ${Math.floor(i / BATCH_SIZE) + 1}: AI returned ${items.length} items`);

    for (const item of items) {
      const idx = (item.index || 1) - 1;
      const group = batch[idx];
      if (!group) continue;

      const spData = {
        supplier_id: group.supplier_id,
        supplier_name: group.supplier_name,
        product_id: group.product_id,
        product_name: group.product_name,
        product_sku: group.product_sku,
        supplier_description: [...new Set(group.descriptions)].join(' | '),
        purchase_uom: item.purchase_uom || 'each',
        purchase_uom_qty: item.purchase_uom_qty || 1,
        purchase_uom_label: item.purchase_uom_label || '',
        conversion_uom: group.stock_uom,
        conversion_factor: item.conversion_factor || 1,
        yield_factor: 1.0,
        effective_internal_qty: item.conversion_factor || 1,
        last_purchase_price: group.unit_costs[0] || 0,
        is_default_supplier: true,
        active: true,
        notes: `AI-enriched (confidence: ${item.confidence || 'unknown'})`,
      };

      results.push(spData);

      if (!dryRun) {
        try {
          await base44.asServiceRole.entities.SupplierProduct.create(spData);
          created++;
        } catch (err) {
          console.error(`[EnrichUoM] Failed to create SP for ${group.product_sku}: ${err.message}`);
          errors++;
        }
      }
    }

    if (i + BATCH_SIZE < groupList.length) await sleep(2000); // Rate limit between batches
  }

  // Audit log
  if (!dryRun && created > 0) {
    await base44.asServiceRole.entities.AuditLog.create({
      action: 'import',
      entity_type: 'SupplierProduct',
      description: `AI purchase UoM enrichment: ${created} SupplierProduct records created, ${errors} errors`,
    }).catch(() => {});
  }

  return Response.json({
    ok: true,
    dry_run: dryRun,
    total_matched_lines: matchedLines.length,
    total_pairs: allGroups.length,
    processed_in_this_call: groupList.length,
    offset,
    has_more: hasMore,
    next_offset: hasMore ? offset + limit : null,
    already_existed: existingSPKeys.size,
    preview: dryRun ? results : undefined,
    created: dryRun ? 0 : created,
    errors,
  });
});