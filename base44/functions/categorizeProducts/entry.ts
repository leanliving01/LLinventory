import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const VALID_CATEGORIES = [
  'Meats',
  'Vegetables',
  'Starches',
  'Spices & Seasoning',
  'Sauces & Condiments',
  'Dairy & Eggs',
  'Oils & Fats',
  'Dry Goods',
  'Packaging',
  'Other',
];

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (user?.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const MAX_PER_CALL = body.limit || 80; // process up to 80 per invocation

  // Fetch active raw/packaging products without a pick_category
  const allProducts = await base44.asServiceRole.entities.Product.filter(
    { status: 'active' },
    'name',
    500
  );

  const uncategorized = allProducts.filter(
    p => (p.type === 'raw' || p.type === 'packaging') && !p.pick_category
  ).slice(0, MAX_PER_CALL);

  if (uncategorized.length === 0) {
    return Response.json({ message: 'All products already categorized', updated: 0, remaining: 0 });
  }

  // Send all names in one LLM call (80 products fits easily)
  const productList = uncategorized.map(p => `${p.id}|${p.name}`).join('\n');

  const prompt = `You are categorizing food production ingredients for a meal-prep company's warehouse pick list.

For each product below, assign exactly ONE category from this list:
- Meats (chicken, beef, steak, mince, fish, lamb, pork, etc.)
- Vegetables (onion, tomato, spinach, beans, broccoli, carrots, peppers, mushrooms, courgette, peas, etc.)
- Starches (rice, pasta, potato, sweet potato, couscous, noodles, wraps, etc.)
- Spices & Seasoning (turmeric, paprika, cumin, salt, pepper, garlic powder, curry powder, herb blends, chili flakes, etc.)
- Sauces & Condiments (BBQ sauce, soy sauce, vinegar, mayo, pesto, chutney, tomato paste, Worcestershire, etc.)
- Dairy & Eggs (cheese, cream, milk, eggs, yogurt, butter, etc.)
- Oils & Fats (olive oil, sunflower oil, coconut oil, cooking spray, etc.)
- Dry Goods (flour, sugar, stock powder, baked beans, canned goods, lentils, etc.)
- Packaging (plates, lids, boxes, labels, tape, bags, sleeves, vacuum skin, film, etc.)
- Other (anything that doesn't clearly fit)

Return a JSON object with an "items" array. Each item has "id" and "category". No explanation.

Products:
${productList}`;

  const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              category: { type: 'string' },
            },
            required: ['id', 'category'],
          },
        },
      },
      required: ['items'],
    },
  });

  const assignments = result?.items || [];
  let totalUpdated = 0;

  // Batch updates — 5 concurrent at a time
  for (let i = 0; i < assignments.length; i += 5) {
    const batch = assignments.slice(i, i + 5);
    await Promise.all(
      batch.map(a => {
        const category = VALID_CATEGORIES.includes(a.category) ? a.category : 'Other';
        return base44.asServiceRole.entities.Product.update(a.id, { pick_category: category });
      })
    );
    totalUpdated += batch.length;
  }

  const totalRemaining = allProducts.filter(
    p => (p.type === 'raw' || p.type === 'packaging') && !p.pick_category
  ).length - totalUpdated;

  return Response.json({
    message: `Categorized ${totalUpdated} products`,
    updated: totalUpdated,
    remaining: Math.max(0, totalRemaining),
  });
});