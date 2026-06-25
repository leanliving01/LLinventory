// Shared supplier-invoice extraction: send a PDF/image to OpenAI, parse the
// line items, and reconcile each line's arithmetic so the per-unit price is the
// true unit price (line_total ÷ qty), not the line total. Used by both
// scan-invoice (live native scans) and reprice-from-attachments (backfill from
// Xero-attached PDFs).

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_MODEL = 'gpt-4.1'; // vision-capable, large context — matches ai-chat

export const EXTRACT_PROMPT = `You are an invoice data extraction assistant. Extract the invoice data from the attached document and return it as a single JSON object with this exact structure:

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

/** Coerce a possibly-stringy money/qty value to a finite number, or null. */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Make qty / unit_price / line_total internally consistent on one line.
 * A unit price is the line total divided by the quantity; when we have qty and
 * line_total we trust them and derive unit_price, overriding the extracted
 * unit_price only when it disagrees beyond a small tolerance.
 */
export function reconcileLine(line: any) {
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
    line_total = round4(unit_price * qty);
  }

  return { ...line, qty, unit_price, line_total };
}

export interface ExtractResult {
  data?: any;
  error?: string;
  status?: number;
}

/**
 * Run a base64-encoded invoice file through OpenAI and return reconciled data.
 * Never throws — returns { error } on failure.
 */
export async function extractInvoiceData(fileBase64: string, mimeType: string): Promise<ExtractResult> {
  if (!OPENAI_API_KEY) {
    return { error: 'OPENAI_API_KEY not configured', status: 500 };
  }

  // OpenAI takes images as an image_url data-URL and PDFs as a `file` part.
  const dataUrl = `data:${mimeType};base64,${fileBase64}`;
  const filePart = mimeType === 'application/pdf'
    ? { type: 'file', file: { filename: 'invoice.pdf', file_data: dataUrl } }
    : { type: 'image_url', image_url: { url: dataUrl } };

  let openaiRes: Response;
  try {
    openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'user', content: [{ type: 'text', text: EXTRACT_PROMPT }, filePart] },
        ],
      }),
    });
  } catch (err) {
    return { error: 'OpenAI request failed: ' + String(err), status: 502 };
  }

  if (!openaiRes.ok) {
    const errText = await openaiRes.text();
    return { error: `OpenAI API error ${openaiRes.status}: ${errText.slice(0, 300)}`, status: 502 };
  }

  const openaiData = await openaiRes.json();
  const rawContent = openaiData?.choices?.[0]?.message?.content || '';
  const cleaned = rawContent.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

  let extracted: any;
  try {
    extracted = JSON.parse(cleaned);
  } catch {
    return { error: 'Failed to parse OpenAI response as JSON', status: 422 };
  }

  if (extracted && Array.isArray(extracted.lines)) {
    extracted.lines = extracted.lines.map(reconcileLine);
  }

  return { data: extracted };
}

/** Build a base64 string from raw bytes in chunks (avoids call-stack overflow). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
