import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import OpenAI from 'npm:openai';

// ── Livi — Lean Living's grounded, permission-gated assistant ──
// Answers ONLY from the system manual (knowledge_base table) + live read-only data tools,
// gated by the caller's permissions. Says "not documented" rather than guessing.

const MODEL = 'gpt-4.1'; // accurate, large context (fits the whole manual), cost-effective

const corsHeaders = () => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });

// Money/cost fields stripped from any tool result unless the caller has a cost permission.
const COST_FIELDS = new Set([
  'cost_avg', 'cost_current', 'unit_cost', 'unit_cost_at_movement', 'price', 'unit_price',
  'line_total', 'total', 'total_amount', 'subtotal_price', 'cost_per_cooked_kg',
  'actual_cost_per_cooked_kg', 'bom_expected_cost_per_cooked_kg', 'carrying_cost_per_kg',
  'total_carrying_value', 'raw_cost_at_event', 'total_cost',
]);

// Tables Livi may read, mapped to the permission that unlocks them.
const READ_TABLES: Record<string, string> = {
  knowledge_base: '*',
  products: 'catalog_view', product_categories: 'catalog_view', pack_boms: 'catalog_view',
  boms: 'recipes_view', bom_components: 'recipes_view',
  stock_on_hand: 'inventory_overview', stock_movements: 'movements_view', par_levels: 'par_levels',
  sales_orders: 'sales_view', sales_order_lines: 'sales_view', customers: 'customers',
  purchase_orders: 'po_view', purchase_order_lines: 'po_view',
  goods_received_notes: 'po_view', grn_lines: 'po_view',
  purchase_invoices: 'po_view', purchase_invoice_lines: 'po_view',
  suppliers: 'po_view', supplier_products: 'po_view', supplier_price_histories: 'po_view',
  supplier_shortages: 'shortages_view', supplier_returns: 'returns_view',
  production_runs: 'runs_view', production_run_lines: 'runs_view',
  production_tasks: 'runs_view', production_task_logs: 'runs_view',
  cooking_runs: 'cooking_runs_view', wip_batches: 'wip_view', yield_records: 'yield_review',
  packing_event_logs: 'reports_dispatch', team_members: 'reports_team',
  wastage_logs: 'wastage', production_wastage_events: 'wastage_review',
};

function can(perms: Record<string, boolean>, key: string) {
  if (!perms) return false;
  return perms[key] === true || perms.admin === true || perms.director === true;
}
function canSeeCost(perms: Record<string, boolean>) {
  return can(perms, 'reports_costs') || can(perms, 'dashboard_costs') || can(perms, 'food_cost_view');
}
function stripCost<T extends Record<string, any>>(rows: T[], showCost: boolean): T[] {
  if (showCost || !Array.isArray(rows)) return rows;
  return rows.map((r) => {
    const o: Record<string, any> = {};
    for (const [k, v] of Object.entries(r)) if (!COST_FIELDS.has(k)) o[k] = v;
    return o as T;
  });
}

function applyFilters(query: any, filters: Record<string, any>) {
  for (const [key, value] of Object.entries(filters || {})) {
    if (value === null || value === undefined) query = query.is(key, null);
    else if (Array.isArray(value)) query = query.in(key, value);
    else if (typeof value === 'object') {
      if (value.$lt !== undefined) query = query.lt(key, value.$lt);
      if (value.$lte !== undefined) query = query.lte(key, value.$lte);
      if (value.$gt !== undefined) query = query.gt(key, value.$gt);
      if (value.$gte !== undefined) query = query.gte(key, value.$gte);
      if (value.$ne !== undefined) query = query.neq(key, value.$ne);
      if (value.$in !== undefined) query = query.in(key, value.$in);
      if (value.$ilike !== undefined) query = query.ilike(key, `%${value.$ilike}%`);
    } else query = query.eq(key, value);
  }
  return query;
}

// ── Daily digest + anomalies (computed server-side, permission-aware) ──
async function buildDigest(supabase: any, perms: Record<string, boolean>) {
  const out: Record<string, unknown> = {};
  const nowIso = new Date().toISOString();
  const safe = async (fn: () => Promise<unknown>, key: string) => {
    try { out[key] = await fn(); } catch (e: any) { out[key] = { error: e?.message }; }
  };

  if (can(perms, 'po_view')) {
    await safe(async () => {
      const { data } = await supabase.from('purchase_orders')
        .select('id,po_number,supplier_name,status,expected_date')
        .in('status', ['approved', 'partially_received'])
        .lt('expected_date', nowIso).limit(50);
      return { count: data?.length || 0, examples: (data || []).slice(0, 8) };
    }, 'overdue_pos');
  }
  if (can(perms, 'sales_view')) {
    await safe(async () => {
      const cutoff = new Date(Date.now() - 4 * 3600 * 1000).toISOString(); // busy packing > 4h
      const { data } = await supabase.from('sales_orders')
        .select('order_number,status,picking_started_at,sup_status,mea_status')
        .eq('status', 'picking').lt('picking_started_at', cutoff).limit(50);
      return { count: data?.length || 0, examples: (data || []).slice(0, 8) };
    }, 'stuck_busy_packing');
  }
  if (can(perms, 'par_levels') || can(perms, 'inventory_overview')) {
    await safe(async () => {
      const [{ data: pars }, { data: soh }] = await Promise.all([
        supabase.from('par_levels').select('product_id,target_qty,min_qty').limit(2000),
        supabase.from('stock_on_hand').select('product_id,qty_on_hand').limit(5000),
      ]);
      const onHand: Record<string, number> = {};
      (soh || []).forEach((s: any) => { onHand[s.product_id] = (onHand[s.product_id] || 0) + (Number(s.qty_on_hand) || 0); });
      const below = (pars || []).filter((p: any) => {
        const target = Number(p.target_qty ?? p.min_qty) || 0;
        return target > 0 && (onHand[p.product_id] || 0) < target;
      });
      return { count: below.length, examples: below.slice(0, 8) };
    }, 'below_par');
  }
  if (can(perms, 'yield_review')) {
    await safe(async () => {
      const { data } = await supabase.from('yield_records')
        .select('id,product_name,actual_yield_pct,status')
        .in('status', ['flagged_unusual', 'pending_review']).limit(50);
      return { count: data?.length || 0, examples: (data || []).slice(0, 8) };
    }, 'flagged_yields');
  }
  if (can(perms, 'po_view')) {
    await safe(async () => {
      const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
      const { data } = await supabase.from('supplier_price_histories')
        .select('supplier_name,product_name,change_pct,effective_date')
        .gte('effective_date', since).limit(200);
      const spikes = (data || []).filter((r: any) => Math.abs(Number(r.change_pct) || 0) >= 10);
      return { count: spikes.length, examples: spikes.slice(0, 8) };
    }, 'price_spikes');
  }
  return out;
}

// ── Tools (built per-request based on permissions) ──
function buildTools(perms: Record<string, boolean>): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'search_manual',
        description: 'Search the Lean Living system manual (how the system works, terminology, how-to). Use for any "how does X work / how do I" question.',
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'query_data',
        description: 'Read live operational data. Only whitelisted tables are allowed; cost/pricing fields are hidden unless the user has cost access.',
        parameters: {
          type: 'object',
          properties: {
            table: { type: 'string', description: 'Table name, e.g. sales_orders, purchase_orders, stock_on_hand, suppliers, products, supplier_shortages, packing_event_logs.' },
            filters: { type: 'object', description: 'key=value equality, or {col:{$gte,$lte,$ilike,...}}; dates are ISO strings.' },
            select: { type: 'string', description: 'Columns, default "*".' },
            order_by: { type: 'string' }, order_desc: { type: 'boolean' }, limit: { type: 'number', description: 'Max rows (<=200).' },
          },
          required: ['table'],
        },
      },
    },
  ];
  if (can(perms, 'reports_dispatch')) {
    tools.push({
      type: 'function',
      function: {
        name: 'get_dispatch_performance',
        description: 'Per-packer packing performance over a date range, including performance % vs team average. Numbers match the Dispatch Performance report.',
        parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
      },
    });
  }
  return tools;
}

async function runTool(name: string, args: any, supabase: any, perms: Record<string, boolean>) {
  if (name === 'search_manual') {
    const q = String(args.query || '').toLowerCase();
    const { data } = await supabase.from('knowledge_base').select('slug,title,category,content').limit(50);
    const rows = data || [];
    const scored = rows
      .map((r: any) => ({ r, hit: ((r.title + ' ' + r.content + ' ' + (r.category || '')).toLowerCase().includes(q) ? 1 : 0) }))
      .filter((x: any) => q.length < 3 || x.hit === 1)
      .slice(0, 6)
      .map((x: any) => x.r);
    return (scored.length ? scored : rows.slice(0, 6));
  }

  if (name === 'query_data') {
    const { table, filters, select, order_by, order_desc, limit } = args;
    const reqPerm = READ_TABLES[table];
    if (!reqPerm) return { error: `Table "${table}" is not available to Livi.` };
    if (reqPerm !== '*' && !can(perms, reqPerm)) return { error: `You don't have permission to view ${table}.` };
    let qy = supabase.from(table).select(select ?? '*');
    if (filters && typeof filters === 'object') qy = applyFilters(qy, filters);
    if (order_by) qy = qy.order(order_by, { ascending: order_desc === false });
    qy = qy.limit(Math.min(Number(limit) || 100, 200));
    const { data, error } = await qy;
    if (error) return { error: error.message };
    return stripCost(data || [], canSeeCost(perms));
  }

  if (name === 'get_dispatch_performance') {
    const { data } = await supabase.from('packing_event_logs')
      .select('member_id,member_name,sales_order_id,packed_items,active_seconds,timestamp')
      .eq('event_type', 'completed').gte('timestamp', args.from).lte('timestamp', args.to).limit(5000);
    const W = 2;
    const byMember: Record<string, any> = {};
    let teamTU = 0, teamSec = 0;
    for (const e of data || []) {
      const sec = Number(e.active_seconds) || 0; const tu = (Number(e.packed_items) || 0) + W;
      if (sec > 0) { teamTU += tu; teamSec += sec; }
      const m = (byMember[e.member_id] ||= { name: e.member_name, orders: new Set(), items: 0, sec: 0, tu: 0 });
      m.orders.add(e.sales_order_id); m.items += Number(e.packed_items) || 0; m.sec += sec; m.tu += tu;
    }
    const benchmark = teamSec > 0 ? teamTU / (teamSec / 3600) : 0;
    return Object.values(byMember).map((m: any) => {
      const hrs = m.sec / 3600; const tuH = hrs > 0 ? m.tu / hrs : 0;
      return {
        packer: m.name, orders: m.orders.size, items: m.items,
        active_minutes: Math.round(m.sec / 60),
        performance_pct: benchmark > 0 && hrs > 0 ? Math.min(200, Math.round((tuH / benchmark) * 100)) : null,
      };
    });
  }
  return { error: `Unknown tool ${name}` };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  try {
    const body = await req.json();
    const messages = body.messages;
    const perms: Record<string, boolean> = body.perms || {};
    const pageContext: string = body.pageContext || '';
    const mode: string = body.mode || 'chat';
    if (!Array.isArray(messages)) return json({ error: 'messages must be an array' }, 400);

    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) return json({ error: 'OPENAI_API_KEY not configured — set it in Supabase → Edge Functions → Secrets.' }, 500);

    const openai = new OpenAI({ apiKey });
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Load the manual (stable prefix → prompt caching).
    const { data: kb } = await supabase.from('knowledge_base').select('title,category,content').order('sort_order').limit(200);
    const manual = (kb || []).map((s: any) => `## ${s.category ? s.category + ' — ' : ''}${s.title}\n${s.content}`).join('\n\n');

    const SYSTEM = `You are Livi, the assistant for Lean Living (meal-prep + supplements, South Africa). Currency is ZAR ("R 1,234.56").

STRICT RULES:
- Answer ONLY from (a) the SYSTEM MANUAL below and (b) data returned by the tools. Use the search_manual tool for "how it works / how do I" questions and the data tools for live numbers.
- If something is not in the manual or the data, say: "That's not documented yet — ask an admin to add it." Do NOT use outside knowledge and NEVER guess or invent numbers.
- Briefly cite your source inline, e.g. "(Manual: Packing)" or "(from sales_orders)".
- Be concise and analytical; use markdown tables/bullets for comparisons. Only mention money if the data includes it.
${pageContext ? `\nThe user is currently on this screen: "${pageContext}".` : ''}
${mode === 'explain_screen' ? `\nTASK: Explain what this screen is for and what its key numbers/terms mean, using the manual.` : ''}
${mode === 'digest' ? `\nTASK: Greet the user and give today's operational digest from the DIGEST data provided, as short bullets grouped by area, calling out anything that needs attention. If a section is empty, skip it.` : ''}

=== SYSTEM MANUAL ===
${manual || '(manual is empty — tell the user to seed the knowledge base)'}`;

    const chat: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: 'system', content: SYSTEM }];

    if (mode === 'digest') {
      const digest = await buildDigest(supabase, perms);
      chat.push({ role: 'system', content: `DIGEST DATA (today):\n${JSON.stringify(digest)}` });
      chat.push({ role: 'user', content: 'Give me today\'s digest.' });
    } else {
      chat.push(...messages);
    }

    const tools = buildTools(perms);
    let response = await openai.chat.completions.create({ model: MODEL, temperature: 0, tools, messages: chat });

    let guard = 0;
    while (response.choices[0].finish_reason === 'tool_calls' && guard++ < 6) {
      const msg = response.choices[0].message;
      chat.push(msg);
      for (const call of msg.tool_calls ?? []) {
        let result: unknown;
        try {
          result = await runTool(call.function.name, JSON.parse(call.function.arguments || '{}'), supabase, perms);
        } catch (err: any) { result = { error: err?.message }; }
        chat.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 60000) });
      }
      response = await openai.chat.completions.create({ model: MODEL, temperature: 0, tools, messages: chat });
    }

    return json({ reply: response.choices[0].message.content ?? 'Sorry, I could not generate a response.' });
  } catch (err: any) {
    console.error('[ai-chat/livi] error:', err);
    return json({ error: err?.message ?? 'Internal error' }, 500);
  }
});
