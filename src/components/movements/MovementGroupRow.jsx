import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, ChevronDown, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDateTimeSAST } from '@/lib/dateUtils';
import { supabase } from '@/api/supabaseClient';

const REASON_LABELS = {
  receipt:                'Receipt',
  transfer:               'Transfer',
  production_consume:     'Production Use',
  production_yield:       'Production Output',
  sale_fulfillment:       'Order Fulfilled',
  wastage_usable:         'Wastage (Usable)',
  wastage_unusable:       'Wastage (Unusable)',
  stocktake_adjustment:   'Stock Count Adj.',
  return:                 'Return',
  write_off:              'Write Off',
  packing_material:       'Packing Material',
  cancellation_reversal:  'Cancellation Reversal',
  production_pick:        'Pick → Production',
  production_return:      'Return from Production',
  supplier_return:        'Supplier Return',
};

const REASON_COLORS = {
  receipt:               'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  production_yield:      'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  return:                'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  transfer:              'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  sale_fulfillment:      'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  production_consume:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  wastage_usable:        'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  wastage_unusable:      'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  stocktake_adjustment:  'bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-400',
  write_off:             'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  packing_material:      'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  cancellation_reversal: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  production_pick:       'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  production_return:     'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  supplier_return:       'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
};

// Reasons that represent stock going OUT
const OUT_REASONS = [
  'sale_fulfillment', 'production_consume', 'production_pick',
  'wastage_usable', 'wastage_unusable', 'write_off', 'packing_material', 'supplier_return',
];

function getSign(reason) {
  if (OUT_REASONS.includes(reason)) return '-';
  if (reason === 'cancellation_reversal') return '+';
  return '+';
}

// ── Qty summary shown on the collapsed group row ─────────────────────────────

function QtyDisplay({ group }) {
  const { reason, order_lines, movement_count, total_qty } = group;

  // Order events: show the packs that were sold
  if (['sale_fulfillment', 'cancellation_reversal'].includes(reason)) {
    const lines = order_lines || [];
    if (lines.length === 0) {
      return (
        <span className="text-xs text-muted-foreground">{movement_count} SKUs</span>
      );
    }
    const totalPacks = lines.reduce((s, l) => s + (l.qty || 0), 0);
    if (lines.length === 1) {
      const l = lines[0];
      const shortName = (l.name || l.sku || '').replace(/\s+(WLM|MLM|WLM\d+|Pack|pack).*$/i, '').trim();
      return (
        <span className="text-xs">
          <span className="font-semibold">{l.qty}×</span>{' '}
          <span className="text-muted-foreground" title={l.name}>
            {shortName.length > 28 ? shortName.slice(0, 28) + '…' : shortName}
          </span>
        </span>
      );
    }
    return (
      <span className="text-xs">
        <span className="font-semibold">{totalPacks} packs</span>{' '}
        <span className="text-muted-foreground">({lines.length} types)</span>
      </span>
    );
  }

  // Receipts, production output, returns: show total qty
  if (['receipt', 'production_yield', 'return', 'production_return'].includes(reason)) {
    return (
      <span className="tabular-nums font-semibold text-green-600 text-xs">
        +{total_qty}
      </span>
    );
  }

  // Wastage, write-offs, supplier returns: show total qty out
  if (['wastage_usable', 'wastage_unusable', 'write_off', 'packing_material', 'supplier_return'].includes(reason)) {
    return (
      <span className="tabular-nums font-semibold text-red-600 text-xs">
        -{total_qty}
      </span>
    );
  }

  // Production picks/consumes, adjustments, transfers: show count
  return (
    <span className="text-xs text-muted-foreground">{movement_count} items</span>
  );
}

// ── Reference display (order link + customer, or plain text) ─────────────────

function ReferenceDisplay({ group }) {
  const { ref_type, ref_id, ref_number, customer_name, reason } = group;

  if (ref_type === 'sales_order' && ref_id) {
    return (
      <div className="min-w-0">
        <Link
          to={`/sales/orders/${ref_id}`}
          className="font-medium text-primary hover:underline text-sm"
          onClick={e => e.stopPropagation()}
        >
          #{ref_number}
        </Link>
        {customer_name && (
          <div className="text-xs text-muted-foreground truncate max-w-[200px]">{customer_name}</div>
        )}
      </div>
    );
  }

  if (ref_number) {
    return <span className="font-medium text-sm">{ref_number}</span>;
  }

  return <span className="text-xs text-muted-foreground italic">{REASON_LABELS[reason] || reason}</span>;
}

// ── Individual movement row (shown in the expanded detail section) ────────────

function DetailRow({ m }) {
  const isOut = OUT_REASONS.includes(m.reason);
  const sign  = m.reason === 'stocktake_adjustment'
    ? (m.from_location_id ? '-' : '+')
    : (isOut ? '-' : '+');
  const color = sign === '-' ? 'text-red-600' : 'text-green-600';

  return (
    <tr className="border-b border-dashed border-border/30 last:border-0 hover:bg-muted/10">
      <td className="w-6 px-2 py-1.5 text-center">
        {sign === '-'
          ? <ArrowUpRight className="w-3 h-3 text-red-400 mx-auto" />
          : <ArrowDownRight className="w-3 h-3 text-green-400 mx-auto" />}
      </td>
      <td className="px-3 py-1.5">
        <span className="font-mono text-[10px] text-muted-foreground">{m.product_sku}</span>
      </td>
      <td className="px-3 py-1.5 text-xs text-foreground">{m.product_name}</td>
      <td className={`px-3 py-1.5 text-right tabular-nums text-xs font-semibold ${color}`}>
        {m.qty === 0 ? '0' : `${sign}${m.qty}`} {m.uom}
      </td>
      {m.notes && (
        <td className="px-3 py-1.5 text-xs text-muted-foreground truncate max-w-[200px]">{m.notes}</td>
      )}
    </tr>
  );
}

// ── Main grouped row component ────────────────────────────────────────────────

export default function MovementGroupRow({ group }) {
  const [expanded, setExpanded]   = useState(false);
  const [movements, setMovements] = useState(null);
  const [loading, setLoading]     = useState(false);

  const toggle = async () => {
    if (!expanded && movements === null) {
      setLoading(true);
      let q = supabase
        .from('stock_movements')
        .select('*')
        .eq('reason', group.reason)
        .order('created_date', { ascending: true });

      if (group.ref_id) {
        q = q.eq('ref_id', group.ref_id);
      } else if (group.ref_number) {
        q = q.eq('ref_number', group.ref_number);
      }

      const { data } = await q;
      setMovements(data || []);
      setLoading(false);
    }
    setExpanded(e => !e);
  };

  const hasDetail = group.movement_count > 0;

  return (
    <>
      <tr
        className={`border-b border-border transition-colors ${hasDetail ? 'cursor-pointer hover:bg-muted/20' : ''}`}
        onClick={hasDetail ? toggle : undefined}
      >
        {/* Expand chevron */}
        <td className="w-8 px-2 py-3 text-center text-muted-foreground">
          {hasDetail && (
            expanded
              ? <ChevronDown className="w-3.5 h-3.5 inline" />
              : <ChevronRight className="w-3.5 h-3.5 inline" />
          )}
        </td>

        {/* Date */}
        <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
          {formatDateTimeSAST(group.event_date)}
        </td>

        {/* Reference */}
        <td className="px-3 py-3">
          <ReferenceDisplay group={group} />
        </td>

        {/* Reason badge */}
        <td className="px-3 py-3">
          <Badge className={`text-[10px] ${REASON_COLORS[group.reason] || 'bg-gray-100 text-gray-700'}`}>
            {REASON_LABELS[group.reason] || group.reason}
          </Badge>
        </td>

        {/* Qty summary */}
        <td className="px-3 py-3 text-right">
          <QtyDisplay group={group} />
        </td>
      </tr>

      {/* Expanded detail rows */}
      {expanded && (
        <tr className="border-b border-border">
          <td colSpan={5} className="px-0 py-0">
            {loading ? (
              <div className="px-8 py-3 text-xs text-muted-foreground">Loading...</div>
            ) : movements?.length === 0 ? (
              <div className="px-8 py-3 text-xs text-muted-foreground">No individual movements found.</div>
            ) : (
              <div className="bg-muted/5 border-t border-dashed border-border/50">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-dashed border-border/30 bg-muted/10">
                      <th className="w-6 px-2 py-1"></th>
                      <th className="text-left px-3 py-1 text-[10px] font-medium text-muted-foreground">SKU</th>
                      <th className="text-left px-3 py-1 text-[10px] font-medium text-muted-foreground">Product</th>
                      <th className="text-right px-3 py-1 text-[10px] font-medium text-muted-foreground">Qty</th>
                      <th className="px-3 py-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map(m => (
                      <DetailRow key={m.id} m={m} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
