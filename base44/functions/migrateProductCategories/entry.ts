import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Migration function: reads existing text-based category / subcategory / pick_category
 * values from all Products and creates structured ProductCategory + ProductSubcategory
 * records, then links them back to each Product via category_id / subcategory_id.
 *
 * Safe to run multiple times — it checks for existing records before creating duplicates.
 *
 * Payload: { dry_run: boolean } — if true, returns the plan without making changes.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;

    // Fetch all data
    const products = await base44.asServiceRole.entities.Product.list('-created_date', 1000);
    const existingCats = await base44.asServiceRole.entities.ProductCategory.list('name', 500);
    const existingSubs = await base44.asServiceRole.entities.ProductSubcategory.list('name', 1000);

    // Build lookup maps for existing records
    const catKey = (name, type) => `${type}::${name.toLowerCase().trim()}`;
    const subKey = (name, catId) => `${catId}::${name.toLowerCase().trim()}`;

    const catMap = {};
    existingCats.forEach(c => { catMap[catKey(c.name, c.product_type)] = c; });

    const subMap = {};
    existingSubs.forEach(s => { subMap[subKey(s.name, s.category_id)] = s; });

    const plan = {
      categories_to_create: [],
      subcategories_to_create: [],
      products_to_update: [],
      skipped_no_category: 0,
    };

    // Track newly created records during execution
    const createdCats = {};
    const createdSubs = {};

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    let apiCalls = 0;
    const throttle = async () => { apiCalls++; if (apiCalls % 8 === 0) await sleep(2000); };

    for (const product of products) {
      if (!product.type) continue;

      // Determine the category name
      // For raw materials, use pick_category. For others, use the legacy 'category' field.
      const rawCatName = product.type === 'raw'
        ? (product.pick_category || product.category || '')
        : (product.category || '');

      // Determine subcategory name from the legacy 'subcategory' field
      const rawSubName = product.subcategory || '';

      if (!rawCatName.trim() && !rawSubName.trim()) {
        plan.skipped_no_category++;
        continue;
      }

      let categoryId = product.category_id || null;
      let subcategoryId = product.subcategory_id || null;

      // ── Category ──
      if (rawCatName.trim() && !categoryId) {
        const key = catKey(rawCatName, product.type);
        const existing = catMap[key] || createdCats[key];

        if (existing) {
          categoryId = existing.id;
        } else {
          plan.categories_to_create.push({ name: rawCatName.trim(), product_type: product.type });
          if (!dryRun) {
            await throttle();
            const created = await base44.asServiceRole.entities.ProductCategory.create({
              name: rawCatName.trim(),
              product_type: product.type,
              is_active: true,
              sort_order: 0,
            });
            createdCats[key] = created;
            catMap[key] = created;
            categoryId = created.id;
          }
        }
      }

      // ── Subcategory ──
      if (rawSubName.trim() && categoryId && !subcategoryId) {
        const key = subKey(rawSubName, categoryId);
        const existing = subMap[key] || createdSubs[key];

        if (existing) {
          subcategoryId = existing.id;
        } else {
          const catRecord = catMap[catKey(rawCatName, product.type)] || createdCats[catKey(rawCatName, product.type)];
          plan.subcategories_to_create.push({
            name: rawSubName.trim(),
            category_id: categoryId,
            category_name: catRecord?.name || rawCatName.trim(),
            product_type: product.type,
          });
          if (!dryRun) {
            await throttle();
            const created = await base44.asServiceRole.entities.ProductSubcategory.create({
              name: rawSubName.trim(),
              category_id: categoryId,
              category_name: catRecord?.name || rawCatName.trim(),
              product_type: product.type,
              is_active: true,
              sort_order: 0,
            });
            createdSubs[key] = created;
            subMap[key] = created;
            subcategoryId = created.id;
          }
        }
      }

      // ── Update product if we have new IDs ──
      const needsUpdate = (categoryId && categoryId !== product.category_id) ||
                          (subcategoryId && subcategoryId !== product.subcategory_id);

      if (needsUpdate) {
        const updateData = {};
        if (categoryId && categoryId !== product.category_id) updateData.category_id = categoryId;
        if (subcategoryId && subcategoryId !== product.subcategory_id) updateData.subcategory_id = subcategoryId;

        plan.products_to_update.push({
          id: product.id,
          sku: product.sku,
          name: product.name,
          category_name: rawCatName.trim(),
          subcategory_name: rawSubName.trim(),
          ...updateData,
        });

        if (!dryRun) {
          await throttle();
          await base44.asServiceRole.entities.Product.update(product.id, updateData);
        }
      }
    }

    return Response.json({
      dry_run: dryRun,
      summary: {
        total_products: products.length,
        categories_created: plan.categories_to_create.length,
        subcategories_created: plan.subcategories_to_create.length,
        products_linked: plan.products_to_update.length,
        skipped_no_category: plan.skipped_no_category,
      },
      plan,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});