/**
 * Supplier purchasing-unit evidence helpers for the Review Queue.
 *
 * The rich inputs a reviewer needs to set a purchasing unit — the supplier's
 * UoM, full description, item code (SKU) and true unit price — do NOT come from
 * the Xero line (Xero ACCPAY lines carry no unit and usually no item code). They
 * live in the original supplier PDF. These helpers read that PDF via the
 * `scan-invoice` edge function and distil the matching line into a single
 * evidence object the UI can show and pre-fill from.
 */

import { base44 } from '@/api/base44Client';

// Parse a pack ("Bale of 10 × 2kg", "800g", "5L") into the conversion factor for
// a given stock unit (1 purchase unit = X stock units).
const _MASS = { kg: 1000, kgs: 1000, g: 1, gr: 1, gram: 1, grams: 1 };
const _VOL = { l: 1000, lt: 1000, litre: 1000, liter: 1000, ml: 1 };
export function packToConversion(text, stockUom) {
  if (!text || !stockUom) return null;
  const t = String(text).toLowerCase();
  let qty = null, unit = null;
  let m = t.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|kgs|g|gr|gram|grams|ml|l|lt|litre|liter)\b/)
       || t.match(/(?:case|bale|bag|box|carton|pack|crate)\s*of\s*(\d+)\D*?(\d+(?:\.\d+)?)\s*(kg|kgs|g|gr|gram|grams|ml|l|lt|litre|liter)\b/);
  if (m) { qty = parseFloat(m[1]) * parseFloat(m[2]); unit = m[3]; }
  else { m = t.match(/(\d+(?:\.\d+)?)\s*(kg|kgs|g|gr|gram|grams|ml|l|lt|litre|liter)\b/); if (m) { qty = parseFloat(m[1]); unit = m[2]; } }
  if (qty == null) return null;
  const su = stockUom.toLowerCase();
  if (unit in _MASS) { const g = qty * _MASS[unit]; if (su === 'g') return g; if (su === 'kg') return g / 1000; }
  if (unit in _VOL) { const ml = qty * _VOL[unit]; if (su === 'ml') return ml; if (su === 'l') return ml / 1000; }
  return null;
}

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const tok = s => (s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);

/**
 * Read the supplier PDF stored against an invoice and return the evidence for a
 * single line (best match by item code, else description tokens).
 *
 * @param {object} args
 * @param {string} args.invoiceId        PurchaseInvoice id whose PDF to read
 * @param {object} args.line             the unmatched line ({ xero_item_code, xero_description })
 * @param {string} [args.stockUom]       product stock UoM, to derive the conversion
 * @returns {Promise<{ ok: boolean, reason?: string, evidence?: object }>}
 *   evidence = { sku, description, uom, unitPrice, qty, lineTotal, conversion }
 */
export async function analyzeInvoiceLine({ invoiceId, line, stockUom }) {
  if (!invoiceId) return { ok: false, reason: 'no-invoice' };

  // The PDF is scanned ONCE per invoice and cached server-side (extract-invoice),
  // so opening a line is instant after the first read — no browser PDF download,
  // no re-scanning the whole invoice for every line.
  const res = await base44.functions.invoke('extract-invoice', { invoiceId });
  const payload = res?.data || {};
  if (payload.status !== 'ok') {
    const err = payload.error || 'no-lines';
    const reason = err === 'no-pdf' ? 'no-pdf'
      : String(err).toUpperCase().includes('OPENAI') ? 'no-key'
      : String(err);
    return { ok: false, reason };
  }

  const exLines = payload.lines || [];
  if (!exLines.length) return { ok: false, reason: 'no-lines' };

  // Find the line in the PDF that corresponds to this queue line.
  const want = norm(line?.xero_item_code);
  const wantToks = new Set(tok(line?.xero_description));
  let best = null, bestScore = 0;
  for (const el of exLines) {
    if (want && norm(el.item_code) === want) { best = el; break; }
    const b = tok(el.description);
    const hits = b.filter(t => wantToks.has(t)).length;
    const sc = wantToks.size && b.length ? hits / Math.max(wantToks.size, b.length) : 0;
    if (sc > bestScore) { bestScore = sc; best = el; }
  }
  if (!best) return { ok: false, reason: 'no-match' };

  const unitPrice = best.unit_price != null ? best.unit_price : (best.qty ? (best.line_total / best.qty) : null);
  const conversion = packToConversion(`${best.unit || ''} ${best.description || ''}`, stockUom);

  return {
    ok: true,
    evidence: {
      sku: best.item_code || '',
      description: best.description || '',
      uom: best.unit || '',
      unitPrice: unitPrice != null ? unitPrice : null,
      qty: best.qty != null ? best.qty : null,
      lineTotal: best.line_total != null ? best.line_total : null,
      conversion: conversion != null ? conversion : null,
    },
  };
}

// A human reason string for when evidence cannot be pulled (kept short for toasts).
export const EVIDENCE_REASONS = {
  'no-invoice': 'No invoice linked to this line.',
  'no-pdf': 'No invoice PDF stored yet — run Settings → Fetch Xero documents.',
  'no-key': 'Add the OpenAI API key to enable AI analysis.',
  'no-lines': 'No lines could be read from the invoice PDF.',
  'no-match': 'Could not find this line in the invoice PDF.',
};
