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
- Descriptions should be verbatim from the invoice`;

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

  let extracted: unknown;
  try {
    extracted = JSON.parse(cleaned);
  } catch {
    return json({ error: 'Failed to parse Gemini response as JSON', raw: rawContent.slice(0, 500) }, 422);
  }

  return json({ data: extracted });
});
