import { corsHeaders, json } from '../_shared/shopify.ts';
import { extractInvoiceData, bytesToBase64 } from '../_shared/invoice-extract.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  let fileBase64: string;
  let mimeType: string;

  try {
    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      if (!file) return json({ error: 'No file provided' }, 400);

      const bytes = new Uint8Array(await file.arrayBuffer());
      fileBase64 = bytesToBase64(bytes);
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

  // OpenAI extraction + per-line arithmetic reconciliation live in the shared
  // module so the Xero-attachment backfill uses the exact same logic.
  const result = await extractInvoiceData(fileBase64, mimeType);
  if (result.error) return json({ error: result.error }, result.status || 502);

  return json({ data: result.data });
});
