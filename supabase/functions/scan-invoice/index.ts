import { corsHeaders, json } from '../_shared/shopify.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_MODEL = 'gemini-2.0-flash';

const EXTRACT_PROMPT = `You are an invoice data extraction assistant. Extract the invoice data from the attached document and return it as a single JSON object with this exact structure:

{
  "supplier_name": "string or null",
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "subtotal": number or null,
  "vat_amount": number or null,
  "total": number or null,
  "lines": [
    {
      "item_code": "the supplier's product/stock/item code for this line, or null",
      "description": "product description as written on the invoice",
      "qty": number or null,
      "unit": "unit of measure (kg, L, pcs, case, box, etc.) or null",
      "unit_price": number or null,
      "line_total": number or null
    }
  ]
}

Rules:
- Return ONLY the JSON object, no markdown code fences, no explanation
- All monetary values must be numbers (not strings)
- If a field cannot be determined, use null
- Include every line item, even if some fields are null
- Descriptions should be verbatim from the invoice
- item_code is the supplier's own product/stock code. Look for a column labelled
  "Item Code", "Item No", "Code", "Product Code", "Stock Code", "SKU", "Part No",
  "Cat No", or a short alphanumeric code printed alongside the description. This is
  often the FIRST column of each line. Capture it verbatim (keep letters, digits,
  dashes, slashes). Use null only when the line genuinely has no code.

Unit price vs line total — read carefully, this is the most common mistake:
- unit_price is the price of ONE unit. line_total is what the whole line costs.
  They are related by: line_total = qty × unit_price.
- The LARGEST money figure on a line is almost always the line_total (the amount
  billed for that row), NOT the unit_price. Do not copy the line total into unit_price.
- If the invoice has a dedicated per-unit column ("Unit Price", "Price", "Price/kg",
  "Price per Unit", "Rate", "@"), use THAT value as unit_price.
- If a line shows a quantity and a line amount but no explicit per-unit price,
  set unit_price = line_total ÷ qty.
- Sanity check every line: qty × unit_price should equal line_total (allowing for
  rounding/discounts). If it doesn't, the per-unit figure is wrong — recompute
  unit_price as line_total ÷ qty.
- "unit" is how the item is sold/measured on this line: kg, g, L, ml, each, pcs,
  head, bunch, punnet, tray, case, box, bag, etc. For weight- or volume-priced
  items, qty is the amount (e.g. 20 for 20 kg) and unit_price is the price per that
  unit (e.g. per kg). Capture the unit verbatim where shown.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  if (!GEMINI_API_KEY) {
    return json({ error: 'GEMINI_API_KEY not configured — run: supabase secrets set GEMINI_API_KEY=<your-key>' }, 500);
  }

  let fileBase64: string;
  let mimeType: string;

  try {
    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      if (!file) return json({ error: 'No file provided' }, 400);

      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      // Build base64 in chunks to avoid call stack overflow on large files
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      fileBase64 = btoa(binary);
      mimeType = file.type || 'image/jpeg';
    } else {
      const body = await req.json();
      fileBase64 = body.fileBase64;
      mimeType = body.mimeType || 'image/jpeg';
      if (!fileBase64) return json({ error: 'No fileBase64 provided' }, 400);
    }
  } catch (err) {
    return json({ error: 'Failed to parse request: ' + String(err) }, 400);
  }

  // Gemini natively handles images AND PDFs via inline_data
  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: EXTRACT_PROMPT },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: fileBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,       // deterministic extraction
          maxOutputTokens: 2000,
          responseMimeType: 'application/json', // ask Gemini to return JSON directly
        },
      }),
    },
  );

  if (!geminiRes.ok) {
    const errText = await geminiRes.text();
    return json({ error: `Gemini API error ${geminiRes.status}: ${errText.slice(0, 300)}` }, 502);
  }

  const geminiData = await geminiRes.json();
  const rawContent = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Strip markdown code fences if Gemini adds them despite responseMimeType
  const cleaned = rawContent.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

  let extracted: any;
  try {
    extracted = JSON.parse(cleaned);
  } catch {
    return json({ error: 'Failed to parse Gemini response as JSON', raw: rawContent.slice(0, 500) }, 422);
  }

  // Reconcile each line's arithmetic. Extractors frequently misread the per-unit
  // price (often copying the line total into unit_price). The invariant
  // unit_price × qty = line_total lets us recover the true unit price, which is
  // what feeds product costing downstream.
  if (extracted && Array.isArray(extracted.lines)) {
    extracted.lines = extracted.lines.map(reconcileLine);
  }

  return json({ data: extracted });
});

/** Coerce a possibly-stringy money/qty value to a finite number, or null. */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Make qty / unit_price / line_total internally consistent on one line.
 *
 * Primary rule (matches how a human reads an invoice): a unit price is the line
 * total divided by the quantity. When we have qty and line_total we trust them
 * and derive unit_price — overriding the extracted unit_price only when it
 * disagrees beyond a small tolerance (so a correct extraction is left untouched,
 * but a line total mistakenly placed in the unit-price slot is corrected, e.g.
 * 20 × R660 → R660 total becomes 20 × R33 → R660).
 */
function reconcileLine(line: any) {
  const qty = num(line?.qty);
  let unit_price = num(line?.unit_price);
  let line_total = num(line?.line_total);

  if (qty && qty !== 0 && line_total != null) {
    const derived = line_total / qty;
    const tol = Math.max(0.02 * Math.abs(derived), 0.01);
    if (unit_price == null || Math.abs(unit_price - derived) > tol) {
      unit_price = round4(derived);
    }
  } else if (unit_price != null && qty && qty !== 0 && line_total == null) {
    // Only the per-unit price is known — fill in the line total.
    line_total = round4(unit_price * qty);
  }

  return { ...line, qty, unit_price, line_total };
}
