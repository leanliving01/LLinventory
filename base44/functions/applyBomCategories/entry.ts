import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Applies subcategories and reclassifications to BOMs using rule-based logic.
 * No AI call — just deterministic categorization based on product names/SKUs/types.
 * Payload: { dry_run: true/false }
 */

// --- COOK / PREP subcategory rules ---
const MEAT_KEYWORDS = ['chicken', 'beef', 'steak', 'mince', 'lamb', 'pork', 'turkey', 'fish', 'salmon', 'hake', 'tuna', 'prawn', 'protein', 'biltong', 'boerewors', 'sausage', 'bacon', 'fillet'];
const VEG_KEYWORDS = ['broccoli', 'spinach', 'cabbage', 'butternut', 'carrot', 'cauliflower', 'green bean', 'zucchini', 'courgette', 'mushroom', 'pepper', 'onion', 'tomato', 'peas', 'corn', 'vegetable', 'salad', 'lettuce', 'cucumber', 'beans', 'lentil', 'chickpea', 'mixed veg', 'stir fry veg', 'stir-fry', 'medley'];
const STARCH_KEYWORDS = ['rice', 'pasta', 'potato', 'sweet potato', 'couscous', 'quinoa', 'noodle', 'mash', 'wedge', 'basmati', 'brown rice', 'long grain', 'spaghetti', 'penne', 'fusilli', 'macaroni', 'shell'];
const SAUCE_KEYWORDS = ['sauce', 'gravy', 'marinade', 'dressing', 'pesto', 'chutney', 'relish', 'mayo', 'sriracha', 'bbq', 'teriyaki', 'tikka', 'curry sauce', 'cream sauce', 'cheese sauce', 'salsa'];
const SPICE_KEYWORDS = ['spice', 'seasoning', 'paprika', 'cumin', 'turmeric', 'oregano', 'thyme', 'garlic powder', 'chilli', 'pepper mix', 'herb'];
const DAIRY_KEYWORDS = ['cheese', 'cream', 'yoghurt', 'yogurt', 'milk', 'butter', 'egg', 'feta'];

function classifyCookPrep(name) {
  const lower = (name || '').toLowerCase();
  if (MEAT_KEYWORDS.some(k => lower.includes(k))) return 'Meats';
  if (SAUCE_KEYWORDS.some(k => lower.includes(k))) return 'Sauces & Condiments';
  if (STARCH_KEYWORDS.some(k => lower.includes(k))) return 'Starches';
  if (SPICE_KEYWORDS.some(k => lower.includes(k))) return 'Spices & Seasoning';
  if (DAIRY_KEYWORDS.some(k => lower.includes(k))) return 'Dairy & Eggs';
  if (VEG_KEYWORDS.some(k => lower.includes(k))) return 'Vegetables';
  return 'Other';
}

// --- PORTION subcategory rules ---
// SKU suffixes: MLM = Men's Lean Muscle, MWL = Men's Weight Loss / BYO, WLM = Women's Lean Muscle, WWL = Women's Weight Loss, LC = Low Carb
function classifyPortion(sku, name) {
  const s = (sku || '').toUpperCase();
  const n = (name || '').toLowerCase();
  if (s.startsWith('MLM') || s.includes('-MLM')) return "Men's Lean Muscle";
  if (s.startsWith('MWL') || s.includes('-MWL')) return "Men's Weight Loss / BYO";
  if (s.startsWith('WLM') || s.includes('-WLM')) return "Women's Lean Muscle";
  if (s.startsWith('WWL') || s.includes('-WWL')) return "Women's Weight Loss";
  if (s.startsWith('LC') || s.includes('-LC') || n.includes('low carb')) return 'Low Carb';
  // Check by portion weight in name
  if (n.includes('330g') || n.includes('330 g')) return "Men's Lean Muscle";
  if (n.includes('300g') || n.includes('300 g')) return "Men's Weight Loss / BYO";
  if (n.includes('260g') || n.includes('260 g')) return "Women's Lean Muscle";
  if (n.includes('240g') || n.includes('240 g')) return "Women's Weight Loss";
  // Fallback: check if it's a primary meal SKU (no suffix = MWL/BYO 300g)
  // Primary SKUs like BeeandBea-2, BeeTri, ChiCur etc. are MWL
  return "Men's Weight Loss / BYO";
}

// --- PACK subcategory rules ---
const SUPPLEMENT_KEYWORDS = ['supplement', 'protein porridge', 'protein pudding', 'protein bar', 'whey', 'collagen', 'creatine', 'vitamin', 'omega', 'bcaa', 'pre-workout', 'preworkout', 'shaker'];
const BUNDLE_KEYWORDS = ['bundle', 'combo', 'hamper'];

function classifyPack(sku, name) {
  const s = (sku || '').toUpperCase();
  const n = (name || '').toLowerCase();
  if (SUPPLEMENT_KEYWORDS.some(k => n.includes(k))) return 'Supplement';
  if (BUNDLE_KEYWORDS.some(k => n.includes(k))) return 'Bundle';
  if (n.includes('byo') || s.includes('BYO')) return 'BYO';
  if (n.includes('low carb') || s.includes('LC') || s.startsWith('LC')) return 'Low Carb';
  // Default goal-based packages
  return 'Goal Based';
}

// --- RAW MATERIAL detection (things that should NOT be pack BOMs) ---
const RAW_MATERIAL_PATTERNS = [
  /case of/i, /box of/i, /bag\s+\d+kg/i, /\d+kg$/i, /tinned/i,
  /cooking with/i, /bulk.*raw/i,
];
const RAW_PRODUCT_TYPES = ['raw', 'packaging'];

function isRawMaterialInPack(bom, product) {
  const name = (bom.product_name || '').toLowerCase();
  const sku = (bom.product_sku || '').toLowerCase();
  // Exclude supplement/retail boxes — these are valid pack BOMs
  if (SUPPLEMENT_KEYWORDS.some(k => name.includes(k))) return false;
  if (name.includes('box of 12') || name.includes('box of 6') || name.includes('box of 24')) return false;
  // Exclude packaging materials — they belong in pack or have no BOM
  if (product && product.type === 'packaging') return false;
  if (name.includes('vacuum') || name.includes('sleeve') || name.includes('label') || name.includes('sticker') || name.includes('tray') || name.includes('lid')) return false;
  // Check patterns for actual raw ingredients
  if (RAW_MATERIAL_PATTERNS.some(p => p.test(name) || p.test(sku))) return true;
  // Check if product type is raw
  if (product && product.type === 'raw') return true;
  return false;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (user?.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body = {};
  try { body = await req.json(); } catch {}
  const dryRun = body.dry_run !== false;

  const allBoms = await base44.asServiceRole.entities.Bom.list('-created_date', 500);
  
  // Fetch products for type checking (only needed for reclassification)
  const products = await base44.asServiceRole.entities.Product.list('name', 1000);
  const productMap = {};
  for (const p of products) productMap[p.id] = p;

  const subcategoryUpdates = [];
  const reclassifications = [];
  const needsPrepNote = [];

  for (const bom of allBoms) {
    let newSub = null;
    const product = productMap[bom.product_id];

    // 1. Assign subcategory
    if (bom.bom_type === 'cook' || bom.bom_type === 'prep') {
      newSub = classifyCookPrep(bom.product_name);
    } else if (bom.bom_type === 'portion') {
      newSub = classifyPortion(bom.product_sku, bom.product_name);
    } else if (bom.bom_type === 'pack') {
      // First check if it's misclassified
      if (isRawMaterialInPack(bom, product)) {
        const bestType = classifyCookPrep(bom.product_name) === 'Starches' ? 'prep' : 'prep';
        reclassifications.push({
          id: bom.id,
          name: bom.product_name,
          sku: bom.product_sku,
          from: 'pack',
          to: bestType,
          sub: classifyCookPrep(bom.product_name),
        });
        newSub = classifyCookPrep(bom.product_name);
      } else {
        newSub = classifyPack(bom.product_sku, bom.product_name);
      }
    }

    if (newSub && newSub !== bom.subcategory) {
      subcategoryUpdates.push({ id: bom.id, name: bom.product_name, sku: bom.product_sku, type: bom.bom_type, newSub });
    }

    // 2. Flag cook items that need prep
    if (bom.bom_type === 'cook') {
      const cat = classifyCookPrep(bom.product_name);
      if (cat === 'Vegetables' || cat === 'Meats' || cat === 'Starches') {
        needsPrepNote.push({ cook_bom_id: bom.id, name: bom.product_name, sku: bom.product_sku, category: cat });
      }
    }
  }

  // Apply if not dry run
  let appliedSubs = 0;
  let appliedReclass = 0;
  if (!dryRun) {
    // Batch subcategory updates
    for (const u of subcategoryUpdates) {
      await base44.asServiceRole.entities.Bom.update(u.id, { subcategory: u.newSub });
      appliedSubs++;
    }
    // Reclassify misclassified pack BOMs
    for (const r of reclassifications) {
      await base44.asServiceRole.entities.Bom.update(r.id, {
        bom_type: r.to,
        subcategory: r.sub,
        notes: `[Auto-reclassified] Was in Pack layer. Moved to ${r.to}.`,
      });
      appliedReclass++;
    }
  }

  return Response.json({
    dry_run: dryRun,
    total_boms: allBoms.length,
    subcategory_updates: subcategoryUpdates.length,
    reclassifications_count: reclassifications.length,
    reclassifications,
    cook_items_needing_prep: needsPrepNote,
    applied_subs: appliedSubs,
    applied_reclass: appliedReclass,
    message: dryRun
      ? `DRY RUN: Would update ${subcategoryUpdates.length} subcategories and reclassify ${reclassifications.length} BOMs.`
      : `Done! Updated ${appliedSubs} subcategories and reclassified ${appliedReclass} BOMs.`,
  });
});