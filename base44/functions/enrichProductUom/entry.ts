import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Enriches Product records with purchase_uom and purchase_to_stock_factor
 * from Cin7 Alt UoM data and product name description parsing.
 *
 * Sources of truth (in priority order):
 * 1. Cin7 Alt UoM products (e.g. CON1349-C with UOM="Case of 6")
 * 2. Cin7 product name patterns (e.g. "5x2KG", "CASE of 6", "10KG")
 * 3. Cin7 PO line usage (what SKU+qty was actually ordered)
 *
 * Also updates stock_uom if Cin7's UOM differs from what we have.
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
      throw new Error(`Cin7 API ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }
  throw new Error('Cin7 rate limit exceeded after 3 retries');
}

function normalizeUom(u) {
  const s = (u || '').toLowerCase().trim();
  if (s === 'kg' || s === 'kgs' || s === 'kilogram' || s === 'kilograms') return 'kg';
  if (s === 'g' || s === 'gram' || s === 'grams') return 'g';
  if (s === 'ml' || s === 'millilitre' || s === 'millilitres') return 'ml';
  if (s === 'l' || s === 'litre' || s === 'litres' || s === 'liter') return 'L';
  if (s === 'pcs' || s === 'piece' || s === 'pieces' || s === 'each' || s === 'ea') return 'pcs';
  if (s === 'box' || s === 'boxes' || s === 'case' || s === 'carton') return 'box';
  return s || 'pcs';
}

/**
 * Parse the product name to extract purchase UoM info.
 * Examples:
 *   "Beef Mince Lean 90/10 VL - Cooking With - 5x2KG" → { purchase_uom: "5x2KG pack", factor: 10 }
 *   "Chicken Breast Fillet Bulk 10 PCT - 10 KG" → { purchase_uom: "10kg bag", factor: 10 }
 *   "COCONUT CREAM / MILK-400ML" → { purchase_uom: "400ml can", factor: 0.4 (L) }
 */
function parsePurchaseInfoFromName(name, stockUom) {
  if (!name) return null;
  const N = name.toUpperCase();

  // Pattern: "NxMKG" e.g. "5x2KG" means 5 packs of 2kg each = 10kg
  const nxmkg = N.match(/(\d+)\s*[xX]\s*(\d+(?:\.\d+)?)\s*KG/);
  if (nxmkg) {
    const packs = parseInt(nxmkg[1]);
    const kgPer = parseFloat(nxmkg[2]);
    const totalKg = packs * kgPer;
    return {
      purchase_uom: `${packs}x${kgPer}kg pack`,
      factor: stockUom === 'g' ? totalKg * 1000 : totalKg,
    };
  }

  // Pattern: "CASE of N" or "-CASE of N"
  const caseOf = N.match(/CASE\s+(?:of\s+)?(\d+)/i);
  if (caseOf) {
    return {
      purchase_uom: `Case of ${caseOf[1]}`,
      factor: parseInt(caseOf[1]),
    };
  }

  // Pattern: standalone weight like "10KG" or "2.5KG" at end
  const kgWeight = N.match(/[-\s](\d+(?:\.\d+)?)\s*KG\b/);
  if (kgWeight) {
    const kg = parseFloat(kgWeight[1]);
    if (kg >= 1) {
      if (stockUom === 'g') {
        return { purchase_uom: `${kg}kg bag`, factor: kg * 1000 };
      } else if (stockUom === 'kg') {
        return { purchase_uom: `${kg}kg bag`, factor: kg };
      }
    }
  }

  // Pattern: "NML" or "N ML" (millilitres)
  const mlWeight = N.match(/[-\s](\d+)\s*ML\b/);
  if (mlWeight) {
    const ml = parseInt(mlWeight[1]);
    if (stockUom === 'ml') {
      return { purchase_uom: `${ml}ml unit`, factor: ml };
    } else if (stockUom === 'L') {
      return { purchase_uom: `${ml}ml unit`, factor: ml / 1000 };
    }
  }

  // Pattern: "NLT" or "N LT" (litres)
  const ltWeight = N.match(/[-\s](\d+(?:\.\d+)?)\s*(?:LT|LITRE|LITER)\b/);
  if (ltWeight) {
    const lt = parseFloat(ltWeight[1]);
    if (stockUom === 'L') {
      return { purchase_uom: `${lt}L unit`, factor: lt };
    } else if (stockUom === 'ml') {
      return { purchase_uom: `${lt}L unit`, factor: lt * 1000 };
    }
  }

  // Pattern: "NGR" or "N GR" (grams)
  const grWeight = N.match(/[-\s](\d+)\s*GR?\b/);
  if (grWeight) {
    const gr = parseInt(grWeight[1]);
    if (gr >= 100) {
      if (stockUom === 'g') {
        return { purchase_uom: `${gr}g pack`, factor: gr };
      } else if (stockUom === 'kg') {
        return { purchase_uom: `${gr}g pack`, factor: gr / 1000 };
      }
    }
  }

  return null;
}

/**
 * Parse Cin7 Alt UoM "Case of N" UOM string to extract factor.
 */
function parseAltUomFactor(altUomString, parentStockUom) {
  const s = (altUomString || '').toLowerCase();
  
  // "case of 6", "case of 24"
  const caseMatch = s.match(/case\s+of\s+(\d+)/);
  if (caseMatch) return parseInt(caseMatch[1]);
  
  // "kg" alt on a "g" parent → factor is 1000
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
    const dryRun = body.dry_run !== false; // Default to dry run
    const batchSize = body.batch_size || 50;

    const accountId = Deno.env.get('CIN7_ACCOUNT_ID');
    const appKey = Deno.env.get('CIN7_APPLICATION_KEY');

    // 1. Load all Cin7 products
    console.log('Loading Cin7 products...');
    let allCin7 = [];
    let page = 1;
    while (page <= 5) {
      const data = await cin7Fetch(`/Product?Page=${page}&Limit=250`, accountId, appKey);
      const products = data.Products || [];
      allCin7 = allCin7.concat(products);
      if (products.length < 250) break;
      page++;
      await delay(1100);
    }
    console.log(`Loaded ${allCin7.length} Cin7 products`);

    // 2. Build Alt UoM map: parent SKU → { altSku, altUom, factor }
    const altUomMap = {}; // parentSku → alt info
    const altUomBySku = {};
    for (const p of allCin7) {
      const cat = (p.Category || '').toLowerCase();
      if (cat === 'alt uom' || cat === 'alternative uom') {
        altUomBySku[p.SKU] = p;
      }
    }

    // Match alt UoM products to parents by SKU pattern
    for (const [sku, altP] of Object.entries(altUomBySku)) {
      // Try to find parent by removing suffix
      const suffixMatch = sku.match(/^(.+?)[-](?:C\d*|Kg|KG|kg|L|Box|Case\s+of\s+\d+)$/i);
      if (suffixMatch) {
        const parentSku = suffixMatch[1];
        const parent = allCin7.find(p => p.SKU === parentSku);
        if (parent) {
          const parentStockUom = normalizeUom(parent.UOM);
          const factor = parseAltUomFactor(altP.UOM, parentStockUom);
          altUomMap[parentSku] = {
            alt_sku: sku,
            alt_uom: altP.UOM,
            factor: factor,
            alt_name: altP.Name,
          };
        }
      }
    }

    // Also check for "- Case of N" in SKU (like VEC4572-Case of 6)
    for (const p of allCin7) {
      const caseInSku = p.SKU.match(/^(.+?)-Case\s+of\s+(\d+)$/i);
      if (caseInSku) {
        const parentSku = caseInSku[1];
        const factor = parseInt(caseInSku[2]);
        if (!altUomMap[parentSku]) {
          altUomMap[parentSku] = {
            alt_sku: p.SKU,
            alt_uom: `Case of ${factor}`,
            factor: factor,
            alt_name: p.Name,
          };
        }
      }
    }

    console.log(`Alt UoM mappings found: ${Object.keys(altUomMap).length}`);

    // 3. Load our products
    const ourProducts = await base44.asServiceRole.entities.Product.filter({}, 'sku', 1000);
    console.log(`Our products: ${ourProducts.length}`);

    // 4. Match and enrich
    const updates = [];
    const noMatch = [];

    for (const product of ourProducts) {
      const sku = product.sku;
      const cin7Product = allCin7.find(p => p.SKU === sku);
      if (!cin7Product) {
        noMatch.push(sku);
        continue;
      }

      const cin7StockUom = normalizeUom(cin7Product.UOM);
      const changes = {};

      // Update stock_uom if different
      if (product.stock_uom !== cin7StockUom) {
        changes.stock_uom = cin7StockUom;
      }

      // Check Alt UoM map first
      const altInfo = altUomMap[sku];
      if (altInfo && altInfo.factor) {
        if (product.purchase_uom !== altInfo.alt_uom) changes.purchase_uom = altInfo.alt_uom;
        if (product.purchase_to_stock_factor !== altInfo.factor) changes.purchase_to_stock_factor = altInfo.factor;
      } else {
        // Try parsing from product name
        const parsed = parsePurchaseInfoFromName(cin7Product.Name, cin7StockUom);
        if (parsed) {
          if (product.purchase_uom !== parsed.purchase_uom) changes.purchase_uom = parsed.purchase_uom;
          if (product.purchase_to_stock_factor !== parsed.factor) changes.purchase_to_stock_factor = parsed.factor;
        }
      }

      // Update purchase_tax_rule from Cin7
      if (cin7Product.PurchaseTaxRule && product.purchase_tax_rule !== cin7Product.PurchaseTaxRule) {
        changes.purchase_tax_rule = cin7Product.PurchaseTaxRule;
      }

      if (Object.keys(changes).length > 0) {
        updates.push({
          id: product.id,
          sku: product.sku,
          name: product.name,
          old: {
            stock_uom: product.stock_uom,
            purchase_uom: product.purchase_uom,
            purchase_to_stock_factor: product.purchase_to_stock_factor,
          },
          changes,
        });
      }
    }

    console.log(`Updates to apply: ${updates.length}, No Cin7 match: ${noMatch.length}`);

    if (dryRun) {
      return Response.json({
        dry_run: true,
        total_products: ourProducts.length,
        cin7_products: allCin7.length,
        alt_uom_mappings: altUomMap,
        updates_needed: updates.length,
        updates: updates.slice(0, 50),
        no_cin7_match: noMatch,
      });
    }

    // Apply updates
    let applied = 0;
    for (const u of updates.slice(0, batchSize)) {
      await base44.asServiceRole.entities.Product.update(u.id, u.changes);
      applied++;
      if (applied % 5 === 0) await delay(1000);
    }

    return Response.json({
      success: true,
      applied,
      remaining: updates.length - applied,
      updates: updates.slice(0, 30),
      no_cin7_match: noMatch,
    });
  } catch (error) {
    console.error('enrichProductUom error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});