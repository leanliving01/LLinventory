import React from 'react';
import { Truck, Tag, Gift } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { money } from './money';

// Display metadata for the non-inventory financial-line categories (refunds excluded — own tab).
export const FIN_SECTIONS = [
  { key: 'shipping',   label: 'Shipping / Delivery',     icon: Truck, categories: ['shipping'],                          border: 'border-sky-200',    bg: 'bg-sky-50/50',    text: 'text-sky-700' },
  { key: 'discount',   label: 'Discounts',               icon: Tag,   categories: ['discount'],                          border: 'border-amber-200',  bg: 'bg-amber-50/50',  text: 'text-amber-700' },
  { key: 'voucher',    label: 'Vouchers / Store Credit', icon: Gift,  categories: ['voucher', 'store_credit'],           border: 'border-violet-200', bg: 'bg-violet-50/50', text: 'text-violet-700' },
  { key: 'adjustment', label: 'Adjustments / Other',     icon: Tag,   categories: ['payment_adjustment', 'tip', 'other'], border: 'border-slate-200',  bg: 'bg-slate-50/50',  text: 'text-slate-700' },
];

/** Non-inventory order-level financial lines grouped by display section. */
export default function FinancialLinesSections({ financialLines = [] }) {
  const sections = FIN_SECTIONS.map((s) => ({
    ...s,
    lines: financialLines.filter((l) => s.categories.includes(l.category) && l.category !== 'refund'),
  })).filter((s) => s.lines.length > 0);

  if (sections.length === 0) {
    return (
      <p className="text-xs text-muted-foreground rounded-lg border bg-card p-3">
        No non-inventory order lines (shipping, discounts, vouchers, adjustments) on this order.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {sections.map((section) => {
        const Icon = section.icon;
        const total = section.lines.reduce((s, l) => s + (Number(l.amount) || 0) * (l.sign || 1), 0);
        return (
          <div key={section.key} className={`rounded-lg border ${section.border} ${section.bg} p-3`}>
            <p className={`text-xs font-semibold ${section.text} mb-2 flex items-center gap-1.5`}>
              <Icon className="w-3.5 h-3.5" /> {section.label}
              <Badge variant="outline" className="text-[10px] py-0 text-muted-foreground">no stock</Badge>
            </p>
            <div className="space-y-1">
              {section.lines.map((l) => (
                <div key={l.id} className="flex items-center justify-between text-xs">
                  <span className="truncate">{l.label}</span>
                  <span className={`font-medium ${l.sign < 0 ? 'text-rose-600' : ''}`}>
                    {l.sign < 0 ? '−' : ''}
                    {money(l.amount)}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between text-xs font-semibold border-t pt-1 mt-1">
                <span>Subtotal</span>
                <span className={total < 0 ? 'text-rose-600' : ''}>
                  {total < 0 ? '−' : ''}
                  {money(Math.abs(total))}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
