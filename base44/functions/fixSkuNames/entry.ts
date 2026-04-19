import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // Load all meals and SKUs
  const [meals, skus] = await Promise.all([
    base44.asServiceRole.entities.Meal.filter({}),
    base44.asServiceRole.entities.SKU.filter({}),
  ]);

  // Build meal lookup by ID
  const mealsById = {};
  meals.forEach(m => { mealsById[m.id] = m; });

  let updated = 0;
  const changes = [];

  for (const sku of skus) {
    const meal = mealsById[sku.meal_id];
    if (!meal) continue;

    // Check if SKU meal_name is stale
    if (sku.meal_name !== meal.meal_name) {
      const newDisplayName = `${meal.meal_name} (${sku.package_type === 'LOW_CARB' ? 'LC' : sku.package_type} ${sku.portion_size_grams}g)`;
      
      console.log(`Fixing SKU ${sku.sku_code}: "${sku.meal_name}" → "${meal.meal_name}"`);
      await base44.asServiceRole.entities.SKU.update(sku.id, {
        meal_name: meal.meal_name,
        display_name: newDisplayName,
      });
      
      changes.push({
        sku_code: sku.sku_code,
        package_type: sku.package_type,
        old_name: sku.meal_name,
        new_name: meal.meal_name,
      });
      updated++;
      await delay(200);
    }
  }

  return Response.json({
    success: true,
    total_skus: skus.length,
    updated,
    changes,
  });
});