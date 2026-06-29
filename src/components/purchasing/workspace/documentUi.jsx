import React from 'react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Shared formatters
// ---------------------------------------------------------------------------
export const fmtMoney = (n) =>
  `R ${(parseFloat(n) || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Qty for display: up to 2 decimals, no trailing zeros.
export const fmtQty = (n) => {
  const v = parseFloat(n);
  if (!isFinite(v) || v === 0) return '0';
  return String(Math.round(v * 100) / 100);
};

// ---------------------------------------------------------------------------
// DocSheet — a printable-looking "paper" sheet that gives content room to
// breathe. This is the container that makes a tab read like a real document.
// ---------------------------------------------------------------------------
export function DocSheet({ children, className }) {
  return (
    <div className={cn('bg-card border border-border rounded-2xl shadow-sm p-6 md:p-10', className)}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DocTitle — large document heading: "TAX INVOICE" / "PURCHASE ORDER" plus the
// document number and status, with generous spacing.
// ---------------------------------------------------------------------------
export function DocTitle({ kicker, number, right }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 pb-6 border-b border-border">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">{kicker}</h2>
        {number && <p className="text-base font-mono text-muted-foreground mt-1">{number}</p>}
      </div>
      {right && <div className="text-right">{right}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Party — a "from / to / deliver to" address block.
// ---------------------------------------------------------------------------
export function Party({ label, name, lines = [], extra }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</p>
      <p className="text-base font-semibold text-foreground">{name || '—'}</p>
      {lines.filter(Boolean).map((l, i) => (
        <p key={i} className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">{l}</p>
      ))}
      {extra}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MetaField — a labelled value used in the document meta strip. Roomy by design.
// ---------------------------------------------------------------------------
export function MetaField({ label, value, mono }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</p>
      <p className={cn('text-sm font-medium', mono && 'font-mono', !value && 'text-muted-foreground')}>
        {value || '—'}
      </p>
    </div>
  );
}

export function MetaGrid({ children }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-8 gap-y-5">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DocTable — table chrome with comfortable spacing. Pass <Th>/<Td> children.
// ---------------------------------------------------------------------------
export function DocTable({ head, children }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/60 border-b border-border">{head}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ children, align = 'left', className }) {
  return (
    <th className={cn(
      'px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground',
      align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
      className,
    )}>
      {children}
    </th>
  );
}

export function Td({ children, align = 'left', className }) {
  return (
    <td className={cn(
      'px-4 py-3 align-middle',
      align === 'right' ? 'text-right tabular-nums' : align === 'center' ? 'text-center' : 'text-left',
      className,
    )}>
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// TotalsBox — right-aligned money summary with clear label/amount columns so
// the currency and figure never crowd each other.
// ---------------------------------------------------------------------------
export function TotalsBox({ rows = [], grand }) {
  return (
    <div className="w-full sm:w-80 ml-auto rounded-xl border border-border bg-muted/30 p-5 space-y-2.5">
      {rows.map((r, i) => (
        <div key={i} className={cn('flex items-center justify-between gap-6', r.tone === 'amber' && 'text-amber-700 font-medium')}>
          <span className="text-sm text-muted-foreground">{r.label}</span>
          <span className="text-sm font-medium tabular-nums">{r.value}</span>
        </div>
      ))}
      {grand && (
        <div className="flex items-center justify-between gap-6 pt-3 mt-1 border-t border-border">
          <span className="text-base font-bold">{grand.label}</span>
          <span className="text-lg font-bold tabular-nums">{grand.value}</span>
        </div>
      )}
    </div>
  );
}
