import React from 'react';
import { FileSearch, Loader2, Sparkles } from 'lucide-react';
import { formatZAR } from '@/lib/utils';

/**
 * Read-only "what the supplier actually says" panel for the purchasing-unit
 * editor. Shows the inputs used to determine the yield / conversion — the
 * supplier's UoM, description, SKU and true unit price pulled from the invoice
 * PDF — plus the derived conversion, so a reviewer can sanity-check before
 * saving. `evidence` is the object returned by analyzeInvoiceLine().
 */
export default function SupplierEvidencePanel({ evidence, loading, error, stockUom = 'stock', onRetry }) {
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase font-semibold text-primary flex items-center gap-1.5">
          <FileSearch className="w-3.5 h-3.5" /> Supplier evidence (from invoice PDF)
        </p>
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
        {!loading && onRetry && (
          <button onClick={onRetry} className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> Re-analyze
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Reading the invoice PDF…</p>
      ) : error ? (
        <p className="text-xs text-amber-700">{error}</p>
      ) : !evidence ? (
        <p className="text-xs text-muted-foreground">No supplier evidence available for this line.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <EvidenceCell label="UoM" value={evidence.uom || '—'} />
            <EvidenceCell label="SKU" value={evidence.sku || '—'} mono />
            <EvidenceCell label="Description" value={evidence.description || '—'} span />
            <EvidenceCell
              label="Unit price"
              value={evidence.unitPrice != null ? `${formatZAR(evidence.unitPrice)} excl` : '—'}
            />
            <EvidenceCell
              label="Qty × line total"
              value={
                evidence.qty != null || evidence.lineTotal != null
                  ? `${evidence.qty ?? '—'} × ${evidence.lineTotal != null ? formatZAR(evidence.lineTotal) : '—'}`
                  : '—'
              }
            />
          </div>
          {evidence.conversion != null ? (
            <p className="text-[11px] text-primary border-t border-primary/20 pt-1.5">
              Derived: 1 {evidence.uom || 'purchase unit'} = <strong>{evidence.conversion} {stockUom}</strong>
              {evidence.unitPrice != null && evidence.conversion > 0 && (
                <> → <strong>{formatZAR(evidence.unitPrice / evidence.conversion)}/{stockUom}</strong></>
              )}
              <span className="text-muted-foreground"> — verify below.</span>
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground border-t border-primary/20 pt-1.5">
              Could not auto-derive a conversion from the pack — read the UoM / description above and set it manually.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function EvidenceCell({ label, value, mono, span }) {
  return (
    <div className={span ? 'col-span-2' : ''}>
      <span className="text-muted-foreground">{label}: </span>
      <span className={`font-medium ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
