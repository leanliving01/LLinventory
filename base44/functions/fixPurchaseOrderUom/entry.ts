import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Retroactively fixes UoM on existing PurchaseOrderLines by parsing
 * the product_name (description from Xero) for unit hints.
 * V3: comprehensive patterns for meat, veg, oils, bulk weights, etc.
 */

function parseUomFromDescription(description) {
  if (!description) return null;
  const d = description;
  const D = d.toUpperCase();

  // ── Skip: packaging, admin debits, numeric codes, labels, tape ──
  if (/^\d+\s+off\s+\d/i.test(d)) return null;          // "1000 off 295 x 285 x 30"
  if (/Admin debit/i.test(d)) return null;
  if (/^[\d]+$/.test(d.trim())) return null;              // pure numeric codes
  if (/TAPE|LABEL|STICKER|CARTON|OUTER|PRINTED|LIDS|SIDES|TOPS|BOTTOMS/i.test(D)) return null;
  if (/^\.\s*$/.test(d.trim())) return null;              // just a dot

  // ── "EACH" means pcs — check FIRST before any kg patterns ──
  if (/\bEACH\b/i.test(D)) return 'pcs';

  // ── Explicit per-unit patterns ──
  if (/P['\u2019\/]KG|P\/KG|\/KG\b|PER\s*KG|PER\s*KILO/i.test(D)) return 'kg';
  if (/P\/G\b|\/G\b|PER\s*GRAM/i.test(D)) return 'g';
  if (/P\/L\b|\/L\b|PER\s*LIT/i.test(D)) return 'L';
  if (/P\/ML|\/ML|PER\s*ML/i.test(D)) return 'ml';

  // ── Bulk box patterns (e.g. "10x1kg", "Peanut Butter x 5kg") ──
  if (/\d+\s*[xX]\s*\d+\s*(KG|G|L|ML)\b/i.test(D)) return 'box';

  // ── Volume: litres (oils, sauces, vinegar) ──
  if (/\d+\s*LT\b|\d+\s*LITRE/i.test(D)) return 'L';

  // ── Weight in description: items with KG/G weight ──
  // Items that contain a weight like "10KG", "2.5KG", "500GR", "1KG" 
  // These are bulk-purchased items — the UoM is kg
  if (/\b\d+(\.\d+)?\s*KG\b/i.test(D)) return 'kg';
  if (/\b\d+\s*GR\b/i.test(D)) return 'kg';  // "500GR" = still bought by weight

  // ── Meat (always kg) ──
  const MEAT_KEYWORDS = [
    'MINCE', 'RUMP', 'SIRLOIN', 'FILLET', 'STEAK', 'BEEF', 'STIRFRY', 'STIR FRY',
    'TRINCHADO', 'BRISKET', 'TOPSIDE', 'SILVERSIDE',
    'CHICKEN BREAST', 'CHICKEN THIGH', 'CHICKEN DRUM', 'CHICKEN STRIP',
    'CHICKEN DICED', 'CHICKEN B/L',
    'HAKE', 'SALMON', 'FISH', 'CALAMARI', 'PRAWN', 'SHRIMP',
    'LAMB', 'PORK', 'BACON', 'BILTONG', 'BOEREWORS',
    'OSTRICH',
  ];
  for (const kw of MEAT_KEYWORDS) {
    if (D.includes(kw)) return 'kg';
  }

  // ── Fresh produce sold loose / by weight (kg) ──
  const PRODUCE_KEYWORDS = [
    'BRINGAL', 'BRINJAL', 'AUBERGINE', 'EGGPLANT',
    'MUSHROOM', 'BABY MARROW', 'COURGETTE', 'ZUCCHINI',
    'SWEET POTATO', 'BUTTERNUT', 'PUMPKIN',
    'CABBAGE', 'LETTUCE', 'SPINACH', 'KALE',
    'TOMATO', 'CHERRY TOM',
    'GINGER', 'GARLIC PEELED', 'CORIANDER',
    'GREEN BEANS', 'MANGE TOUT', 'SNAP PEAS',
    'CAULIFLOWER', 'BROCCOLI', 'CELERY',
    'CORN',
  ];
  for (const kw of PRODUCE_KEYWORDS) {
    if (D.includes(kw)) return 'kg';
  }

  // "LOOSE" items are typically kg
  if (/\bLOOSE\b/i.test(D)) return 'kg';

  // Onion/potato in bags with weight
  if (/\b(ONION|POTATO|RED ONION)\b.*BAG/i.test(D)) return 'kg';

  // ── Dry goods / spices / sauces bought in bulk weight ──
  const BULK_WEIGHT_KEYWORDS = [
    'SPICE', 'SEASONING', 'PREMIX', 'PAPRIKA',
    'CUMIN', 'TURMERIC', 'CINNAMON', 'CHILLI FLAKE',
    'PEANUT BUTTER', 'MAYONNAISE', 'MAYO',
    'TOMATO PASTE', 'TOMATO PUREE',
    'COCONUT CREAM', 'COCONUT MILK',
    'STOCK', 'BOUILLON',
    'CHEESE', 'CREAM CHEESE', 'FETA', 'MOZZARELLA', 'CHEDDAR', 'PARMESAN',
    'YOGHURT', 'YOGURT',
    'BUTTER UNSALTED', 'BUTTER SALTED', 'MARGARINE',
    'HONEY',
    'FLOUR',
    'RICE',
    'PASTA', 'SPAGHETTI', 'NOODLE', 'MACARONI', 'PENNE', 'FUSILLI',
    'LENTIL', 'CHICKPEA', 'CHICK PEA', 'KIDNEY',
    'QUINOA', 'COUSCOUS', 'BULGUR',
    'OATS',
  ];
  for (const kw of BULK_WEIGHT_KEYWORDS) {
    if (D.includes(kw)) return 'kg';
  }

  // ── Tinned/canned goods (bought by weight if has weight, else pcs) ──
  if (/TINNED|CANNED|TIN\b/i.test(D)) return 'kg';

  // ── Sauces and condiments in litres ──
  const SAUCE_KEYWORDS = [
    'SOY SAUCE', 'SOYA LIGHT', 'SOYA HONEY', 'WORCESTER', 'TABASCO', 'HOT SAUCE',
    'SWEET CHILLI', 'SRIRACHA', 'BBQ SAUCE', 'BARBEQUE SAUCE',
    'VINEGAR', 'BALSAMIC',
    'TOPPING VERSATIE', 'STEAKHOUSE',
    'DRESSING SALAD', 'FRENCH DRESSING',
    'JUICE LEMON',
    'MILK LONG LIFE',
  ];
  for (const kw of SAUCE_KEYWORDS) {
    if (D.includes(kw)) return 'L';
  }

  // ── Oil is litres ──
  if (/\bOIL\b/i.test(D)) return 'L';

  // ── Peppadew / piquante ──
  if (/PEPPADEW|PIQUANTE/i.test(D)) return 'kg';

  // ── Items with "EACH" — must come BEFORE produce/meat keywords ──
  // Actually handled at the top — see below

  // ── Items with "BOX" as standalone (e.g. "RED PEPPER BOX") ──
  if (/\bBOX\b/i.test(D)) return 'box';

  // ── Items with "POLY 1KG" etc. (pre-packed produce bags) ──
  if (/POLY\s*\d/i.test(D)) return 'kg';

  // ── Supplement / gelatin / capsule items are pcs ──
  if (/SUPPLEMENT|CAPSULE|GELATIN/i.test(D)) return 'pcs';

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

    // Check what would change (dry run mode)
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;

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

    if (dryRun) {
      const changeSummary = {};
      for (const [uom, lines] of Object.entries(byNewUom)) {
        changeSummary[uom] = lines.map(l => l.product_name);
      }
      return Response.json({
        dry_run: true,
        would_update: Object.values(byNewUom).reduce((s, arr) => s + arr.length, 0),
        unchanged_count: unchanged.length,
        changes_count_by_uom: Object.fromEntries(Object.entries(changeSummary).map(([k,v]) => [k, v.length])),
        unchanged_unique_n_z: [...new Set(unchanged)].sort().filter(n => n.toUpperCase() >= 'N'),
        unchanged_unique_a_m: [...new Set(unchanged)].sort().filter(n => n.toUpperCase() < 'N'),
      });
    }

    const maxUpdates = body.max_updates || 80; // Cap per run to avoid timeouts
    let updated = 0;
    const changes = [];
    let hitCap = false;

    for (const [newUom, linesToFix] of Object.entries(byNewUom)) {
      for (let i = 0; i < linesToFix.length; i++) {
        if (updated >= maxUpdates) { hitCap = true; break; }
        const line = linesToFix[i];
        await base44.asServiceRole.entities.PurchaseOrderLine.update(line.id, { uom: newUom });
        changes.push({ product_name: line.product_name, new_uom: newUom });
        updated++;
        // Throttle: pause every 5 updates
        if (updated > 0 && updated % 5 === 0) {
          await new Promise(r => setTimeout(r, 5000));
        }
      }
      if (hitCap) break;
    }

    console.log(`Updated: ${updated} lines, Unchanged: ${unchanged.length}`);

    return Response.json({
      success: true,
      total_lines: allLines.length,
      candidates_checked: candidates.length,
      updated,
      remaining: hitCap ? Object.values(byNewUom).reduce((s, arr) => s + arr.length, 0) - updated : 0,
      unchanged_count: unchanged.length,
      changes,
    });
  } catch (error) {
    console.error('fixPurchaseOrderUom error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});