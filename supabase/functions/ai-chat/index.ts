import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import OpenAI from 'npm:openai';

const corsHeaders = () => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
});

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });

const SYSTEM_PROMPT = `You are an intelligent business analyst assistant for Lean Living, a meal prep and supplement company in South Africa.

You have access to the full operations database. Use the query_data tool to fetch any data you need before answering questions. Always look up real data — never guess or fabricate numbers.

KEY TABLES AVAILABLE:
- suppliers — supplier master data (id, name, category, status, email, phone)
- purchase_invoices — supplier invoices (id, supplier_id, invoice_number, invoice_date, total, status, due_date)
- purchase_invoice_lines — invoice line items (id, invoice_id, product_id, description, quantity, unit_price, line_total)
- purchase_orders — purchase orders (id, supplier_id, order_date, total, status)
- purchase_order_lines — PO line items (id, po_id, product_id, quantity, unit_price)
- goods_received_notes — delivery receipts (id, supplier_id, received_date, status)
- grn_lines — GRN line items (id, grn_id, product_id, quantity_received, unit_cost)
- products — product catalogue (id, sku, name, type, status, cost_avg, stock_uom)
- stock_on_hand — current stock (id, product_id, location_id, qty_on_hand, cost_avg)
- stock_movements — stock history (id, product_id, movement_type, quantity, created_date)
- supplier_price_histories — historical unit prices per supplier/product
- sales_orders — customer orders (id, customer_id, order_date, total, status)
- sales_order_lines — sales line items (id, order_id, product_id, quantity, unit_price)
- production_runs — production batches (id, status, scheduled_date, completed_date)
- production_run_lines — production line items (id, run_id, product_id, qty_planned, qty_actual)
- wastage_logs — wastage events (id, product_id, quantity, reason, created_date)
- wastage_lines — wastage line details
- customers — customer records (id, name, email, status)
- locations — warehouse locations (id, name, type)
- pack_boms — meal package BOMs (id, name, type, multiplier, portion_weight_g)
- skus — individual meal SKUs (id, sku_code, meal_name, package_type)

RULES:
- For invoice comparisons: fetch purchase_invoices filtered by date range AND supplier, then fetch purchase_invoice_lines for those invoices, then join to products for descriptions.
- For supplier lookups: filter suppliers by name using the $ilike operator if you only know part of the name.
- For date filtering: dates are stored as ISO strings (e.g. "2025-10-01"). Use $gte and $lte operators.
- Amounts are in South African Rand (ZAR). Format currency as "R X,XXX.XX".
- Be concise and analytical. Use bullet points or markdown tables for comparisons.
- If data is not found, say so clearly — don't make up numbers.
- Always fetch line-item detail when comparing costs or prices, not just header totals.`;

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'query_data',
      description: 'Query any table in the Lean Living operations database. Use this to fetch real data before answering any question.',
      parameters: {
        type: 'object',
        properties: {
          table: {
            type: 'string',
            description: 'The database table name (e.g. purchase_invoices, suppliers, products)',
          },
          filters: {
            type: 'object',
            description: 'Filter conditions as key-value pairs. Use plain values for equality (e.g. {status: "active"}). For date ranges use objects: {invoice_date: {$gte: "2025-10-01", $lte: "2025-10-31"}}. For partial name match: {name: {$ilike: "supplier name"}}.',
          },
          select: {
            type: 'string',
            description: 'Columns to return. Default "*" returns all. Use "id,name,total" style for specific columns.',
          },
          order_by: {
            type: 'string',
            description: 'Column name to sort by (e.g. "invoice_date" or "created_date")',
          },
          order_desc: {
            type: 'boolean',
            description: 'Sort descending (newest first). Default true.',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of rows to return. Default 100.',
          },
        },
        required: ['table'],
      },
    },
  },
];

function applyFilters(query: any, filters: Record<string, any>) {
  for (const [key, value] of Object.entries(filters)) {
    if (value === null || value === undefined) {
      query = query.is(key, null);
    } else if (Array.isArray(value)) {
      query = query.in(key, value);
    } else if (typeof value === 'object') {
      if (value.$lt !== undefined) query = query.lt(key, value.$lt);
      if (value.$lte !== undefined) query = query.lte(key, value.$lte);
      if (value.$gt !== undefined) query = query.gt(key, value.$gt);
      if (value.$gte !== undefined) query = query.gte(key, value.$gte);
      if (value.$ne !== undefined) query = query.neq(key, value.$ne);
      if (value.$in !== undefined) query = query.in(key, value.$in);
      if (value.$ilike !== undefined) query = query.ilike(key, `%${value.$ilike}%`);
    } else {
      query = query.eq(key, value);
    }
  }
  return query;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  try {
    const { messages } = await req.json();
    if (!Array.isArray(messages)) return json({ error: 'messages must be an array' }, 400);

    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages,
    ];

    let response = await openai.chat.completions.create({
      model: 'gpt-4o',
      tools: TOOLS,
      messages: chatMessages,
    });

    // Tool-call loop — GPT may call query_data multiple times before answering
    while (response.choices[0].finish_reason === 'tool_calls') {
      const assistantMessage = response.choices[0].message;
      chatMessages.push(assistantMessage);

      for (const call of assistantMessage.tool_calls ?? []) {
        let toolResult: unknown = [];
        try {
          const args = JSON.parse(call.function.arguments);
          const { table, filters, select, order_by, order_desc, limit } = args;

          let q = supabase.from(table).select(select ?? '*');
          if (filters && typeof filters === 'object') q = applyFilters(q, filters);
          if (order_by) q = q.order(order_by, { ascending: order_desc === false });
          q = q.limit(limit ?? 100);

          const { data, error } = await q;
          if (error) {
            toolResult = { error: error.message };
          } else {
            toolResult = data ?? [];
          }
        } catch (err: any) {
          toolResult = { error: err.message };
        }

        chatMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(toolResult),
        });
      }

      response = await openai.chat.completions.create({
        model: 'gpt-4o',
        tools: TOOLS,
        messages: chatMessages,
      });
    }

    const reply = response.choices[0].message.content ?? 'Sorry, I could not generate a response.';
    return json({ reply });
  } catch (err: any) {
    console.error('[ai-chat] error:', err);
    return json({ error: err.message ?? 'Internal error' }, 500);
  }
});
