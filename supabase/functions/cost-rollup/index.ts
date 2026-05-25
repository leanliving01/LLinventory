import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = () => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
});

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── 1. Load all active products ──────────────────────────────────────────
  const { data: productRows, error: pErr } = await supabase
    .from('products')
    .select('id, name, sku, cost_avg')
    .eq('status', 'active');

  if (pErr) return json({ error: `Failed to load products: ${pErr.message}` }, 500);

  // Working cost map — updated in-memory as each layer is processed
  const costMap = new Map<string, number>();
  const nameMap = new Map<string, string>();
  for (const p of productRows || []) {
    costMap.set(p.id as string, Number(p.cost_avg) || 0);
    nameMap.set(p.id as string, (p.name as string) || (p.sku as string) || p.id);
  }

  // ── 2. Load all active BOMs ───────────────────────────────────────────────
  const { data: bomRows, error: bErr } = await supabase
    .from('boms')
    .select('id, product_id, bom_type, yield_qty')
    .eq('is_active', true);

  if (bErr) return json({ error: `Failed to load BOMs: ${bErr.message}` }, 500);

  // ── 3. Load all BOM components ────────────────────────────────────────────
  const { data: compRows, error: cErr } = await supabase
    .from('bom_components')
    .select('bom_id, input_product_id, qty, is_consumable');

  if (cErr) return json({ error: `Failed to load BOM components: ${cErr.message}` }, 500);

  // Index components by bom_id
  const compsByBom = new Map<string, Array<{ input_product_id: string; qty: number; is_consumable: boolean }>>();
  for (const c of compRows || []) {
    const key = c.bom_id as string;
    if (!compsByBom.has(key)) compsByBom.set(key, []);
    compsByBom.get(key)!.push({
      input_product_id: c.input_product_id as string,
      qty: Number(c.qty) || 0,
      is_consumable: Boolean(c.is_consumable),
    });
  }

  // ── 4. Process layers in order ────────────────────────────────────────────
  const LAYER_ORDER: Array<'cook' | 'portion' | 'pack'> = ['cook', 'portion', 'pack'];
  const changes: Array<{ id: string; oldCost: number; newCost: number; name: string }> = [];

  for (const layer of LAYER_ORDER) {
    const layerBoms = (bomRows || []).filter(b => b.bom_type === layer);

    for (const bom of layerBoms) {
      const outputId = bom.product_id as string;
      const yieldQty = Number(bom.yield_qty) || 1;
      const components = compsByBom.get(bom.id as string) || [];

      // Sum costs of all non-consumable inputs
      let inputCost = 0;
      for (const comp of components) {
        if (comp.is_consumable) continue;
        const unitCost = costMap.get(comp.input_product_id) || 0;
        inputCost += unitCost * comp.qty;
      }

      // Skip BOMs with no costed components — don't zero out existing costs
      if (components.filter(c => !c.is_consumable).length === 0) continue;

      const newCost = Math.round((inputCost / yieldQty) * 10000) / 10000;
      const oldCost = costMap.get(outputId) || 0;

      // Update in-memory map so downstream layers see the new cost
      costMap.set(outputId, newCost);

      // Only record as a change if it actually moved (threshold: 0.0001)
      if (Math.abs(newCost - oldCost) > 0.0001) {
        changes.push({ id: outputId, oldCost, newCost, name: nameMap.get(outputId) || outputId });
      }
    }
  }

  // ── 5. Bulk write changed products ───────────────────────────────────────
  if (changes.length > 0) {
    const now = new Date().toISOString();
    // Supabase doesn't support bulk updates with different values per row,
    // so we update in parallel batches of 50
    const BATCH = 50;
    for (let i = 0; i < changes.length; i += BATCH) {
      const batch = changes.slice(i, i + BATCH);
      await Promise.all(
        batch.map(({ id, newCost }) =>
          supabase.from('products').update({ cost_avg: newCost, updated_date: now }).eq('id', id)
        )
      );
    }
  }

  // ── 6. Return result ──────────────────────────────────────────────────────
  const details = changes.map(
    c => `${c.name}: R${c.oldCost.toFixed(4)} → R${c.newCost.toFixed(4)}`
  );

  return json({
    status: 'completed',
    updated: changes.length,
    details,
    layers_processed: LAYER_ORDER.length,
    boms_evaluated: (bomRows || []).filter(b => LAYER_ORDER.includes(b.bom_type as 'cook' | 'portion' | 'pack')).length,
  });
});
