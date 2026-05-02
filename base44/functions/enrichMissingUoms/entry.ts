import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Finds active purchasable products (raw, packaging, supplement, sauce) that have
 * NO purchase UoM defined anywhere (no ProductPurchaseUom, no legacy purchase_uom,
 * no SupplierProduct). Then cross-references ALL PurchaseOrderLine records to find
 * historical purchase data, and uses AI to infer purchase UoM, conversion factor,
 * and label. Creates both SupplierProduct AND ProductPurchaseUom records.
 *
 * Params:
 *   dry_run (bool)   – if true, preview only, no writes (default true)
 *   batch_size (int) – how many products to process per call (default 30)
 *   offset (int)     – skip first N missing products (default 0)
 *   include_no_po (bool) – also process products with no PO matches using AI inference (default false)
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false;
    const batchSize = body.batch_size || 30;
    const offset = body.offset || 0;
    const includeNoPO = body.include_no_po === true;

    // 1. Fetch all active products
    const allProducts = await base44.asServiceRole.entities.Product.filter(
      { status: 'active' }, 'sku', 2000
    );

    // Filter to relevant types
    const RELEVANT_TYPES = ['raw', 'packaging', 'supplement', 'sauce'];
    const purchasable = allProducts.filter(p =>
      p.purchasable !== false && RELEVANT_TYPES.includes(p.type)
    );

    // 2. Get existing coverage
    const allUoms = await base44.asServiceRole.entities.ProductPurchaseUom.list('product_id', 5000);
    const uomProductIds = new Set(allUoms.map(u => u.product_id));

    const allSP = await base44.asServiceRole.entities.SupplierProduct.filter({ active: true }, 'product_id', 5000);
    const spProductIds = new Set(allSP.map(sp => sp.product_id));

    // 3. Find missing products
    const missing = purchasable.filter(p => {
      const hasNewUom = uomProductIds.has(p.id);
      const hasLegacy = p.purchase_uom && p.purchase_uom.trim() !== '';
      const hasSP = spProductIds.has(p.id);
      return !hasNewUom && !hasLegacy && !hasSP;
    });

    // 4. Fetch ALL PO lines and PO headers for supplier lookup
    const allPOLines = await base44.asServiceRole.entities.PurchaseOrderLine.list('purchase_order_id', 5000);
    const allPOs = await base44.asServiceRole.entities.PurchaseOrder.list('order_date', 2000);

    // Build PO lookup: po_id -> { supplier_id, supplier_name }
    const poLookup = {};
    for (const po of allPOs) {
      poLookup[po.id] = { supplier_id: po.supplier_id, supplier_name: po.supplier_name };
    }

    // 5. For each missing product, find PO lines that reference it
    //    Match by: product_id, product_sku, or fuzzy name match
    const productNameMap = {};
    for (const p of allProducts) {
      productNameMap[p.id] = p;
    }

    // Build name-to-product index for fuzzy matching of unmatched PO lines
    const nameIndex = {};
    for (const p of missing) {
      const key = p.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      nameIndex[key] = p;
      // Also index by SKU
      if (p.sku) nameIndex[p.sku.toLowerCase()] = p;
    }

    // Match PO lines to missing products
    const productPOMatches = {}; // product_id -> [{ line, supplier_id, supplier_name }]

    for (const line of allPOLines) {
      const po = poLookup[line.purchase_order_id];
      if (!po) continue;

      let matchedProduct = null;

      // Direct match by product_id
      if (line.product_id && line.product_id !== 'unmatched') {
        const prod = productNameMap[line.product_id];
        if (prod && missing.some(m => m.id === prod.id)) {
          matchedProduct = prod;
        }
      }

      // Match by SKU
      if (!matchedProduct && line.product_sku) {
        const skuLower = line.product_sku.toLowerCase();
        if (nameIndex[skuLower]) {
          matchedProduct = nameIndex[skuLower];
        }
      }

      // Fuzzy name match for unmatched lines
      if (!matchedProduct && line.product_name) {
        const lineName = line.product_name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        // Try exact name match
        if (nameIndex[lineName]) {
          matchedProduct = nameIndex[lineName];
        } else {
          // Try partial match — line name contains product name or vice versa
          for (const [key, prod] of Object.entries(nameIndex)) {
            if (key.length < 4) continue; // skip short keys
            if (lineName.includes(key) || key.includes(lineName)) {
              matchedProduct = prod;
              break;
            }
          }
        }
      }

      if (matchedProduct) {
        if (!productPOMatches[matchedProduct.id]) {
          productPOMatches[matchedProduct.id] = [];
        }
        productPOMatches[matchedProduct.id].push({
          line_description: line.product_name || line.description || '',
          line_sku: line.product_sku || '',
          ordered_qty: line.ordered_qty,
          unit_cost: line.unit_cost,
          uom: line.uom || '',
          supplier_id: po.supplier_id,
          supplier_name: po.supplier_name,
        });
      }
    }

    // 6. Determine which products to process this batch
    const withPOData = missing.filter(p => productPOMatches[p.id]?.length > 0);
    const withoutPOData = missing.filter(p => !productPOMatches[p.id]?.length);

    const toProcess = includeNoPO
      ? [...withPOData, ...withoutPOData]
      : withPOData;

    const batch = toProcess.slice(offset, offset + batchSize);

    if (batch.length === 0) {
      return Response.json({
        status: 'nothing_to_process',
        total_missing: missing.length,
        with_po_data: withPOData.length,
        without_po_data: withoutPOData.length,
        offset,
        missing_without_po: withoutPOData.map(p => ({
          name: p.name, sku: p.sku, type: p.type, stock_uom: p.stock_uom
        })),
      });
    }

    // 7. Build AI prompt for batch
    const items = batch.map(p => {
      const poLines = productPOMatches[p.id] || [];
      // Deduplicate PO data by supplier
      const bySupplier = {};
      for (const pl of poLines) {
        const key = pl.supplier_id || pl.supplier_name;
        if (!bySupplier[key]) {
          bySupplier[key] = {
            supplier_id: pl.supplier_id,
            supplier_name: pl.supplier_name,
            descriptions: [],
            skus: [],
            qtys: [],
            costs: [],
            uoms: [],
          };
        }
        if (pl.line_description) bySupplier[key].descriptions.push(pl.line_description);
        if (pl.line_sku) bySupplier[key].skus.push(pl.line_sku);
        bySupplier[key].qtys.push(pl.ordered_qty);
        bySupplier[key].costs.push(pl.unit_cost);
        if (pl.uom) bySupplier[key].uoms.push(pl.uom);
      }

      return {
        product_id: p.id,
        product_name: p.name,
        product_sku: p.sku,
        product_type: p.type,
        stock_uom: p.stock_uom,
        category: p.category || '',
        suppliers: Object.values(bySupplier).map(s => ({
          supplier_id: s.supplier_id,
          supplier_name: s.supplier_name,
          invoice_descriptions: [...new Set(s.descriptions)].slice(0, 5),
          supplier_skus: [...new Set(s.skus)].slice(0, 3),
          typical_qtys: [...new Set(s.qtys)].slice(0, 5),
          typical_costs: [...new Set(s.costs)].slice(0, 5),
          line_uoms: [...new Set(s.uoms)].slice(0, 3),
        })),
      };
    });

    const prompt = `You are a food-industry procurement expert for a South African meal-prep kitchen.

For each product below, determine the PURCHASE unit of measure (how it's bought from the supplier).
The stock_uom is how the product is tracked in inventory.
Use the PO line data (descriptions, quantities, costs, UoMs) to infer the purchase packaging.

Rules:
- purchase_uom must be one of: case, bag, drum, pallet, box, each, kg, L
- purchase_uom_qty is how many stock units per purchase unit (e.g. case of 6 = 6, 10kg bag = 10)
- purchase_uom_label is human-friendly (e.g. "Case of 6×1kg", "10kg Bag", "25L Drum")
- conversion_factor = how many stock_uom units in 1 purchase unit
  Examples: if stock_uom=kg and you buy a 10kg bag, conversion_factor=10
  If stock_uom=g and you buy a 1kg bag, conversion_factor=1000
  If stock_uom=pcs and you buy a box of 100, conversion_factor=100
  If stock_uom=ml and you buy a 5L bottle, conversion_factor=5000
- If the product is spice/seasoning in g and bought per kg, conversion_factor=1000
- If no PO data exists, infer from the product name and category (e.g. "BBQ Spice-Kg" → per kg)
- confidence: high if PO data clearly shows the UoM, medium if inferred, low if guessing

Return a JSON object with key "results" containing an array. Each item:
{
  "product_id": "...",
  "supplier_id": "..." (or null if no supplier match),
  "supplier_name": "..." (or null),
  "supplier_sku": "..." (from PO data, or null),
  "purchase_uom": "case|bag|drum|pallet|box|each|kg|L",
  "purchase_uom_qty": number,
  "purchase_uom_label": "human label",
  "conversion_factor": number,
  "last_purchase_price": number (from cost data, or 0),
  "confidence": "high|medium|low"
}

Products:
${JSON.stringify(items, null, 2)}`;

    const aiResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                product_id: { type: 'string' },
                supplier_id: { type: 'string' },
                supplier_name: { type: 'string' },
                supplier_sku: { type: 'string' },
                purchase_uom: { type: 'string' },
                purchase_uom_qty: { type: 'number' },
                purchase_uom_label: { type: 'string' },
                conversion_factor: { type: 'number' },
                last_purchase_price: { type: 'number' },
                confidence: { type: 'string' },
              },
            },
          },
        },
      },
    });

    const results = aiResult?.results || [];
    const created = [];
    const errors = [];

    if (!dryRun) {
      for (const r of results) {
        try {
          const product = batch.find(p => p.id === r.product_id);
          if (!r.purchase_uom || !r.conversion_factor || !product) continue;

          // Create SupplierProduct if we have a supplier
          let spId = null;
          if (r.supplier_id) {
            const sp = await base44.asServiceRole.entities.SupplierProduct.create({
              supplier_id: r.supplier_id,
              supplier_name: r.supplier_name || '',
              product_id: r.product_id,
              product_name: product.name,
              product_sku: product.sku,
              supplier_sku: r.supplier_sku || '',
              purchase_uom: r.purchase_uom,
              purchase_uom_qty: r.purchase_uom_qty || 1,
              purchase_uom_label: r.purchase_uom_label || '',
              conversion_uom: product.stock_uom,
              conversion_factor: r.conversion_factor,
              last_purchase_price: r.last_purchase_price || 0,
              is_default_supplier: true,
              active: true,
              notes: `AI-enriched from PO data (confidence: ${r.confidence})`,
            });
            spId = sp.id;
          }

          // Create ProductPurchaseUom
          await base44.asServiceRole.entities.ProductPurchaseUom.create({
            product_id: r.product_id,
            label: r.purchase_uom_label || `${r.purchase_uom} of ${r.purchase_uom_qty}`,
            purchase_to_stock_factor: r.conversion_factor,
            supplier_id: r.supplier_id || null,
            supplier_name: r.supplier_name || null,
            is_default: true,
            notes: `AI-enriched from PO data (confidence: ${r.confidence})`,
          });

          created.push({
            product: product.name,
            sku: product.sku,
            purchase_uom_label: r.purchase_uom_label,
            conversion_factor: r.conversion_factor,
            supplier: r.supplier_name || 'none',
            confidence: r.confidence,
            supplier_product_created: !!spId,
          });
        } catch (err) {
          errors.push({ product_id: r.product_id, error: err.message });
        }
      }

      // Audit log
      if (created.length > 0) {
        await base44.asServiceRole.entities.AuditLog.create({
          action: 'import',
          entity_type: 'SupplierProduct',
          description: `AI enriched ${created.length} missing purchase UoMs from PO line data`,
          new_value: JSON.stringify(created.slice(0, 20)),
        });
      }
    }

    return Response.json({
      status: dryRun ? 'dry_run' : 'completed',
      total_missing: missing.length,
      missing_by_type: {
        raw: missing.filter(p => p.type === 'raw').length,
        packaging: missing.filter(p => p.type === 'packaging').length,
        supplement: missing.filter(p => p.type === 'supplement').length,
        sauce: missing.filter(p => p.type === 'sauce').length,
      },
      with_po_data: withPOData.length,
      without_po_data: withoutPOData.length,
      batch_processed: batch.length,
      offset,
      next_offset: offset + batchSize < toProcess.length ? offset + batchSize : null,
      ai_results: results.length,
      created: dryRun ? [] : created,
      preview: dryRun ? results : [],
      errors,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});