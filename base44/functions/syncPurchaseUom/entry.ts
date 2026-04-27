import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Syncs purchase UoM and purchase-to-stock conversion factor from Cin7
 * into our Product records.
 *
 * Data sources (priority order):
 * 1. Alt UoM products in Cin7 (Category="Alt UoM", e.g. CON1349-C → "Case of 6")
 * 2. Cin7 Supplier.SupplierProductName (e.g. "BULK FILLETS 10*1KG BOX FRESH")
 * 3. Cin7 product Name (e.g. "TOPPING VERSATIE-RICHS-1LT", "Baked Beans-410GR")
 *
 * Params:
 *   dry_run (default true) — preview changes without applying
 *   batch_size (default 40) — max products to update per call
 *   types — array of product types to target (default: ["raw","packaging","sauce","supplement"])
 */

const CIN7_BASE = 'https://inventory.dearsystems.com/ExternalApi/v2';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function cin7Fetch(path, accountId, appKey) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${CIN7_BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        'api-auth-accountid': accountId,
        'api-auth-applicationkey': appKey,
      },
    });
    if (res.status === 429) {
      await delay((attempt + 1) * 2000);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cin7 API ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json();
  }
  throw new Error('Cin7 rate limit exceeded');
}

function normalizeUom(u) {
  const s = (u || '').toLowerCase().trim();
  if (['kg', 'kgs', 'kilogram', 'kilograms'].includes(s)) return 'kg';
  if (['g', 'gram', 'grams', 'gr'].includes(s)) return 'g';
  if (['ml', 'millilitre', 'millilitres'].includes(s)) return 'ml';
  if (['l', 'ltr', 'litre', 'litres', 'liter'].includes(s)) return 'L';
  if (['pcs', 'piece', 'pieces', 'each', 'ea', 'unit'].includes(s)) return 'pcs';
  if (['box', 'boxes', 'case', 'carton'].includes(s)) return 'box';
  return s || 'pcs';
}

/**
 * Parse purchase UoM from a description string (Cin7 SupplierProductName or product Name).
 * Returns { purchase_uom: string, factor: number } or null.
 *
 * Examples:
 *   "BULK FILLETS 10*1KG BOX FRESH" → { purchase_uom: "Box of 10kg", factor: 10 }
 *   "SPICE POWDER CURRY ALL IN ONE-RAJAH-800GR" → { purchase_uom: "800g pack", factor: 800 }
 *   "TOPPING VERSATIE-RICHS-1LT" → { purchase_uom: "1L bottle", factor: 1 }
 *   "Beef Mince Lean 90/10 VL - Cooking With - 5x2KG" → { purchase_uom: "5x2kg box", factor: 10 }
 *   "OIL OLIVE POMACE-OLITALIA-5LT" → { purchase_uom: "5L drum", factor: 5 }
 *   "SAUCE WORCHESTER-HOLBROOKS-2LT" → { purchase_uom: "2L bottle", factor: 2 }
 */
function parsePurchaseUom(text, stockUom) {
  if (!text) return null;
  const T = text.toUpperCase();

  // ── NxMKG pattern: "5x2KG", "10*1KG", "10x1KG" ──
  const nxm = T.match(/(\d+)\s*[xX*]\s*(\d+(?:\.\d+)?)\s*KG/);
  if (nxm) {
    const packs = parseInt(nxm[1]);
    const kgPer = parseFloat(nxm[2]);
    const totalKg = packs * kgPer;
    return {
      purchase_uom: `${packs}x${kgPer}kg box`,
      factor: stockUom === 'g' ? totalKg * 1000 : totalKg,
    };
  }

  // ── NxMLT/NxML pattern ──
  const nxmlt = T.match(/(\d+)\s*[xX*]\s*(\d+(?:\.\d+)?)\s*(LT|L)\b/);
  if (nxmlt) {
    const packs = parseInt(nxmlt[1]);
    const ltPer = parseFloat(nxmlt[2]);
    const totalL = packs * ltPer;
    return {
      purchase_uom: `${packs}x${ltPer}L case`,
      factor: stockUom === 'ml' ? totalL * 1000 : totalL,
    };
  }

  const nxmml = T.match(/(\d+)\s*[xX*]\s*(\d+)\s*ML/);
  if (nxmml) {
    const packs = parseInt(nxmml[1]);
    const mlPer = parseInt(nxmml[2]);
    const totalMl = packs * mlPer;
    return {
      purchase_uom: `${packs}x${mlPer}ml case`,
      factor: stockUom === 'L' ? totalMl / 1000 : totalMl,
    };
  }

  // ── Litres: "5LT", "2LT", "1LT", "5 LITRE" ──
  const lt = T.match(/[-\s](\d+(?:\.\d+)?)\s*(?:LT|LITRE|LITER)\b/);
  if (lt) {
    const val = parseFloat(lt[1]);
    return {
      purchase_uom: `${val}L bottle`,
      factor: stockUom === 'ml' ? val * 1000 : val,
    };
  }

  // ── KG: "10KG", "2.5KG", "1KG" ──
  const kg = T.match(/[-\s](\d+(?:\.\d+)?)\s*KG\b/);
  if (kg) {
    const val = parseFloat(kg[1]);
    return {
      purchase_uom: `${val}kg bag`,
      factor: stockUom === 'g' ? val * 1000 : val,
    };
  }

  // ── Grams: "800GR", "500G", "250GR", "100G" ──
  const gr = T.match(/[-\s](\d+)\s*(?:GR|G)\b/);
  if (gr) {
    const val = parseInt(gr[1]);
    if (val >= 50) { // Ignore tiny numbers that might be model numbers
      return {
        purchase_uom: `${val}g pack`,
        factor: stockUom === 'kg' ? val / 1000 : val,
      };
    }
  }

  // ── ML: "400ML", "500ML" ──
  const ml = T.match(/[-\s](\d+)\s*ML\b/);
  if (ml) {
    const val = parseInt(ml[1]);
    return {
      purchase_uom: `${val}ml unit`,
      factor: stockUom === 'L' ? val / 1000 : val,
    };
  }

  return null;
}

/**
 * Parse Cin7 Alt UoM string to extract factor.
 * E.g. "Case of 6" → 6, "Case of 24" → 24
 */
function parseAltUomFactor(altUomStr, parentStockUom) {
  const s = (altUomStr || '').toLowerCase();
  const m = s.match(/case\s+of\s+(\d+)/);
  if (m) return parseInt(m[1]);
  if (s === 'kg' && parentStockUom === 'g') return 1000;
  if (s === 'l' && parentStockUom === 'ml') return 1000;
  return null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false;
    const batchSize = body.batch_size || 40;
    const targetTypes = body.types || ['raw', 'packaging', 'sauce', 'supplement', 'wip_bulk'];

    const accountId = Deno.env.get('CIN7_ACCOUNT_ID');
    const appKey = Deno.env.get('CIN7_APPLICATION_KEY');

    // ── 1. Load all Cin7 products (paginated, with suppliers) ──
    console.log('Loading Cin7 products with supplier info...');
    let allCin7 = [];
    let page = 1;
    while (page <= 10) {
      const data = await cin7Fetch(
        `/Product?Page=${page}&Limit=250&IncludeSuppliers=true`,
        accountId, appKey
      );
      const products = data.Products || [];
      allCin7 = allCin7.concat(products);
      if (products.length < 250) break;
      page++;
      await delay(1200);
    }
    console.log(`Loaded ${allCin7.length} Cin7 products`);

    // ── 2. Build indexes ──
    const cin7BySku = {};
    const altUomProducts = []; // Category = "Alt UoM"
    for (const p of allCin7) {
      cin7BySku[p.SKU] = p;
      const cat = (p.Category || '').toLowerCase();
      if (cat === 'alt uom' || cat === 'alternative uom') {
        altUomProducts.push(p);
      }
    }

    // Alt UoM map: parentSKU → { alt_uom, factor, alt_supplier_name }
    const altUomMap = {};
    for (const alt of altUomProducts) {
      // Parent SKU = alt SKU minus suffix (e.g. CON1349-C → CON1349)
      const suffixMatch = alt.SKU.match(/^(.+?)[-](?:C\d*|Kg|KG|kg|L|Box|Case\s+of\s+\d+)$/i);
      const caseInSku = alt.SKU.match(/^(.+?)-Case\s+of\s+(\d+)$/i);

      let parentSku = null;
      if (suffixMatch) parentSku = suffixMatch[1];
      else if (caseInSku) parentSku = caseInSku[1];

      if (parentSku && cin7BySku[parentSku]) {
        const parentStockUom = normalizeUom(cin7BySku[parentSku].UOM);
        const factor = parseAltUomFactor(alt.UOM, parentStockUom);
        const supplierName = alt.Suppliers?.[0]?.SupplierProductName || null;
        altUomMap[parentSku] = {
          alt_sku: alt.SKU,
          alt_uom_label: alt.UOM,
          alt_name: alt.Name,
          factor,
          supplier_product_name: supplierName,
        };
      }
    }
    console.log(`Alt UoM mappings: ${Object.keys(altUomMap).length}`);

    // ── 3. Load our products ──
    const ourProducts = await base44.asServiceRole.entities.Product.filter(
      { status: 'active', purchasable: true }, 'sku', 1000
    );
    console.log(`Our purchasable active products: ${ourProducts.length}`);

    // ── 4. Match and compute purchase UoM ──
    const updates = [];
    const noMatch = [];
    const alreadySet = [];
    const noParseHits = [];

    for (const product of ourProducts) {
      // Skip types we don't care about
      if (!targetTypes.includes(product.type)) continue;

      const sku = product.sku;
      const cin7 = cin7BySku[sku];
      if (!cin7) {
        noMatch.push({ sku, name: product.name });
        continue;
      }

      const stockUom = normalizeUom(cin7.UOM);
      let purchaseUom = null;
      let factor = null;
      let source = null;

      // Priority 1: Alt UoM
      const alt = altUomMap[sku];
      if (alt && alt.factor) {
        purchaseUom = alt.alt_uom_label;
        factor = alt.factor;
        source = 'alt_uom';
      }

      // Priority 2: Cin7 Supplier's SupplierProductName
      if (!purchaseUom && cin7.Suppliers?.length > 0) {
        for (const s of cin7.Suppliers) {
          const parsed = parsePurchaseUom(s.SupplierProductName, stockUom);
          if (parsed) {
            purchaseUom = parsed.purchase_uom;
            factor = parsed.factor;
            source = 'supplier_product_name';
            break;
          }
        }
      }

      // Priority 3: Cin7 product Name
      if (!purchaseUom) {
        const parsed = parsePurchaseUom(cin7.Name, stockUom);
        if (parsed) {
          purchaseUom = parsed.purchase_uom;
          factor = parsed.factor;
          source = 'product_name';
        }
      }

      // Determine what needs updating
      const changes = {};
      if (purchaseUom && product.purchase_uom !== purchaseUom) {
        changes.purchase_uom = purchaseUom;
      }
      if (factor && product.purchase_to_stock_factor !== factor) {
        changes.purchase_to_stock_factor = factor;
      }

      if (Object.keys(changes).length > 0) {
        updates.push({
          id: product.id,
          sku,
          name: product.name,
          stock_uom: stockUom,
          old_purchase_uom: product.purchase_uom,
          old_factor: product.purchase_to_stock_factor,
          new_purchase_uom: purchaseUom,
          new_factor: factor,
          source,
          changes,
          cin7_name: cin7.Name,
          supplier_product_name: cin7.Suppliers?.[0]?.SupplierProductName || null,
        });
      } else if (product.purchase_uom) {
        alreadySet.push({ sku, name: product.name, purchase_uom: product.purchase_uom });
      } else {
        noParseHits.push({
          sku,
          name: product.name,
          cin7_name: cin7.Name,
          cin7_uom: cin7.UOM,
          supplier_product_name: cin7.Suppliers?.[0]?.SupplierProductName || null,
        });
      }
    }

    console.log(`Updates: ${updates.length}, Already set: ${alreadySet.length}, No parse: ${noParseHits.length}, No Cin7 match: ${noMatch.length}`);

    if (dryRun) {
      return Response.json({
        dry_run: true,
        summary: {
          total_purchasable: ourProducts.filter(p => targetTypes.includes(p.type)).length,
          updates_needed: updates.length,
          already_set: alreadySet.length,
          no_parse_hit: noParseHits.length,
          no_cin7_match: noMatch.length,
        },
        updates: updates.slice(0, 60),
        no_parse_hits: noParseHits,
        no_cin7_match: noMatch,
        alt_uom_map: altUomMap,
      });
    }

    // ── 5. Apply updates ──
    let applied = 0;
    const toApply = updates.slice(0, batchSize);
    for (const u of toApply) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await base44.asServiceRole.entities.Product.update(u.id, u.changes);
          applied++;
          break;
        } catch (err) {
          if (err.message?.includes('429') || err.message?.includes('Rate limit')) {
            console.log(`Rate limited on ${u.sku}, waiting ${(attempt + 1) * 5}s...`);
            await delay((attempt + 1) * 5000);
            continue;
          }
          throw err;
        }
      }
      await delay(2000);
    }

    return Response.json({
      success: true,
      applied,
      remaining: updates.length - applied,
      no_parse_hits: noParseHits,
      no_cin7_match: noMatch,
    });
  } catch (error) {
    console.error('syncPurchaseUom error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});