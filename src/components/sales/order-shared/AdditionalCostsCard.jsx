import React, { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { money, rand } from './money';

export const COST_TYPES = [
  { value: 'courier_actual', label: 'Actual courier cost' },
  { value: 'packaging',      label: 'Extra packaging' },
  { value: 'resend',         label: 'Re-send cost' },
  { value: 'write_off',      label: 'Write-off' },
  { value: 'handling',       label: 'Handling' },
  { value: 'other',          label: 'Other' },
];

/** Additional manual order-level costs: list + add form. */
export default function AdditionalCostsCard({ order, costs = [] }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    cost_type: 'courier_actual', description: '', reference: '',
    amount: '', cost_date: new Date().toISOString().slice(0, 10), notes: '',
  });

  const handleAdd = async (e) => {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a cost amount');
      return;
    }
    setSaving(true);
    try {
      await base44.entities.SalesOrderCost.create({
        id: rand(),
        sales_order_id: order.id,
        shopify_order_id: order.shopify_order_id || null,
        order_number: order.order_number || null,
        cost_type: form.cost_type,
        description: form.description || null,
        reference: form.reference || null,
        amount,
        cost_date: form.cost_date,
        notes: form.notes || null,
      });
      toast.success('Cost added to order');
      setForm({ cost_type: 'courier_actual', description: '', reference: '', amount: '', cost_date: new Date().toISOString().slice(0, 10), notes: '' });
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ['salesOrderCosts', order.id] });
      queryClient.invalidateQueries({ queryKey: ['salesOrderProfit', order.id] });
    } catch (err) {
      toast.error(err.message || 'Could not add cost');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50/50 p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-orange-700 flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Additional Order Costs
          <Badge variant="outline" className="text-[10px] py-0 text-muted-foreground">not product cost</Badge>
        </p>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="text-[11px] border rounded-md px-2 py-1 hover:bg-muted"
        >
          {showForm ? 'Cancel' : 'Add cost'}
        </button>
      </div>
      {costs.length > 0 ? (
        <div className="space-y-1 mb-2">
          {costs.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-xs">
              <span className="truncate">
                <span className="capitalize">{(c.cost_type || '').replace(/_/g, ' ')}</span>
                {c.description ? ` — ${c.description}` : ''}
                {c.reference ? <span className="text-muted-foreground"> · ref {c.reference}</span> : ''}
                {c.cost_date ? <span className="text-muted-foreground"> · {c.cost_date}</span> : ''}
              </span>
              <span className="font-medium text-rose-600">−{money(c.amount)}</span>
            </div>
          ))}
        </div>
      ) : (
        !showForm && <p className="text-xs text-muted-foreground">No additional costs recorded.</p>
      )}
      {showForm && (
        <form onSubmit={handleAdd} className="grid grid-cols-2 gap-2 mt-1">
          <select
            className="text-xs border rounded-md px-2 py-1 bg-background"
            value={form.cost_type}
            onChange={(e) => setForm((f) => ({ ...f, cost_type: e.target.value }))}
          >
            {COST_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <input
            type="number" step="0.01" min="0" placeholder="Amount (R)"
            className="text-xs border rounded-md px-2 py-1 bg-background"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          />
          <input
            type="text" placeholder="Description"
            className="text-xs border rounded-md px-2 py-1 bg-background"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
          <input
            type="text" placeholder="Reference (optional)"
            className="text-xs border rounded-md px-2 py-1 bg-background"
            value={form.reference}
            onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
          />
          <input
            type="date"
            className="text-xs border rounded-md px-2 py-1 bg-background"
            value={form.cost_date}
            onChange={(e) => setForm((f) => ({ ...f, cost_date: e.target.value }))}
          />
          <button
            type="submit" disabled={saving}
            className="text-xs bg-orange-600 text-white rounded-md px-2 py-1 hover:bg-orange-700 disabled:opacity-60 inline-flex items-center justify-center gap-1"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Save cost
          </button>
        </form>
      )}
    </div>
  );
}
