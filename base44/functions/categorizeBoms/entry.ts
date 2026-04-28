import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (user?.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  // Fetch all BOMs
  const allBoms = await base44.asServiceRole.entities.Bom.list('-created_date', 500);

  // Build a compact representation for AI analysis
  const bomSummary = allBoms.map(b => ({
    id: b.id,
    sku: b.product_sku,
    name: b.product_name,
    type: b.bom_type,
    yield_uom: b.yield_uom,
    current_sub: b.subcategory || null,
  }));

  // Use InvokeLLM to categorize
  const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: `You are an expert in food production management for a meal-prep company called Lean Living (South Africa).

BUSINESS CONTEXT:
- 5 package types: Men's Lean Muscle (MLM, 330g), Men's Weight Loss/BYO (MWL, 300g), Women's Lean Muscle (WLM, 260g), Women's Weight Loss (WWL, 240g), Low Carb (330g, 5 unique meals)
- Goal-based packages share the same 15 meals; portion weight differs
- Production flow: Prep → Cook → Portion → Pack

I'm giving you a list of all BOMs in the system. For EACH BOM, you need to:

1. ASSIGN A SUBCATEGORY based on the current bom_type:
   - For "prep" and "cook" BOMs, use these subcategories: Meats, Vegetables, Starches, Sauces & Condiments, Spices & Seasoning, Dairy & Eggs, Other
   - For "portion" BOMs, use: Men's Lean Muscle, Men's Weight Loss / BYO, Women's Lean Muscle, Women's Weight Loss, Low Carb
   - For "pack" BOMs, use: Goal Based, Low Carb, BYO, Supplement, Bundle, Other

2. FLAG MISCLASSIFIED BOMs - identify items that are in the WRONG layer:
   - Raw ingredients (like "CORN-COOKING WITH-10KG", "PEAS CHICK TINNED-ARCO-2.5KG", "Pasta Shells-g") should NOT be in "pack" — they are either raw materials with no BOM needed, or should be "prep" or "cook"
   - Supplement/protein products in "pack" that are actually retail box assemblies are fine as "pack" with subcategory "Supplement"
   - Any item name containing "Case of", "Box of", or bulk raw ingredient names in "pack" is likely misclassified

3. IDENTIFY COOK items that ALSO need a PREP step:
   - Items like vegetables (broccoli, carrots, butternut, cauliflower, potato wedges, green beans, stir-fry veg) need washing/chopping/peeling before cooking
   - Rice, pasta, couscous need measuring/rinsing
   - Meats (chicken breast, steak, mince, beef strips) need defrosting/trimming/marinating
   - Sauces may need ingredient prep (mixing, measuring)

Here are all the BOMs:
${JSON.stringify(bomSummary, null, 2)}

Return a JSON object with:
{
  "categorizations": [
    { "id": "bom_id", "subcategory": "assigned subcategory" }
  ],
  "reclassifications": [
    { "id": "bom_id", "current_type": "pack", "recommended_type": "prep", "reason": "This is a raw ingredient, not a package assembly" }
  ],
  "needs_prep_bom": [
    { "cook_bom_id": "id", "name": "Bulk Broccoli", "prep_reason": "Needs washing, trimming, and cutting before cooking" }
  ]
}

Be thorough. Every BOM must get a subcategory. Use exact subcategory names from the lists above.`,
    response_json_schema: {
      type: "object",
      properties: {
        categorizations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              subcategory: { type: "string" }
            },
            required: ["id", "subcategory"]
          }
        },
        reclassifications: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              current_type: { type: "string" },
              recommended_type: { type: "string" },
              reason: { type: "string" }
            },
            required: ["id", "current_type", "recommended_type", "reason"]
          }
        },
        needs_prep_bom: {
          type: "array",
          items: {
            type: "object",
            properties: {
              cook_bom_id: { type: "string" },
              name: { type: "string" },
              prep_reason: { type: "string" }
            },
            required: ["cook_bom_id", "name", "prep_reason"]
          }
        }
      },
      required: ["categorizations", "reclassifications", "needs_prep_bom"]
    },
    model: "gemini_3_1_pro"
  });

  // Get request body for mode param
  let body = {};
  try { body = await req.json(); } catch {}
  const dryRun = body.dry_run !== false; // default to dry run

  const applied = [];
  if (!dryRun) {
    // Apply subcategory updates
    for (const cat of result.categorizations) {
      const bom = allBoms.find(b => b.id === cat.id);
      if (bom && bom.subcategory !== cat.subcategory) {
        await base44.asServiceRole.entities.Bom.update(cat.id, { subcategory: cat.subcategory });
        applied.push({ id: cat.id, field: 'subcategory', value: cat.subcategory });
      }
    }
  }

  // Enrich categorizations with names for readability
  const enriched = result.categorizations.map(c => {
    const bom = allBoms.find(b => b.id === c.id);
    return { ...c, name: bom?.product_name, sku: bom?.product_sku, type: bom?.bom_type };
  });

  // If mode=summary, return just flags and prep items
  if (body.mode === 'flags') {
    return Response.json({
      reclassifications: result.reclassifications.map(r => {
        const bom = allBoms.find(b => b.id === r.id);
        return { ...r, name: bom?.product_name, sku: bom?.product_sku };
      }),
      needs_prep_bom: result.needs_prep_bom,
    });
  }

  return Response.json({
    total_boms: allBoms.length,
    dry_run: dryRun,
    categorizations: enriched,
    reclassifications: result.reclassifications.map(r => {
      const bom = allBoms.find(b => b.id === r.id);
      return { ...r, name: bom?.product_name, sku: bom?.product_sku };
    }),
    needs_prep_bom: result.needs_prep_bom,
    applied_count: applied.length,
    message: dryRun
      ? 'DRY RUN — review the results then call again with { "dry_run": false } to apply subcategories.'
      : `Applied ${applied.length} subcategory updates.`
  });
});