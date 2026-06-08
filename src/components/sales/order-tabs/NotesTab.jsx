import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StickyNote, Plus, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatDateTimeSAST } from '@/lib/dateUtils';

const CATEGORIES = [
  { value: 'general',          label: 'General' },
  { value: 'customer_service', label: 'Customer Service' },
  { value: 'warehouse',        label: 'Warehouse' },
  { value: 'finance',          label: 'Finance' },
  { value: 'management',       label: 'Management' },
];

const CATEGORY_COLORS = {
  general:          'bg-slate-100 text-slate-700 border-slate-200',
  customer_service: 'bg-sky-100 text-sky-700 border-sky-200',
  warehouse:        'bg-amber-100 text-amber-700 border-amber-200',
  finance:          'bg-emerald-100 text-emerald-700 border-emerald-200',
  management:       'bg-violet-100 text-violet-700 border-violet-200',
};

export default function NotesTab({ order, notes = [] }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ note: '', category: 'general' });

  // Newest first.
  const sorted = [...notes].sort(
    (a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0)
  );

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.note.trim()) {
      toast.error('Enter a note');
      return;
    }
    setSaving(true);
    try {
      await base44.entities.SalesOrderNote.create({
        sales_order_id: order.id,
        shopify_order_id: order.shopify_order_id || null,
        order_number: order.order_number || null,
        note: form.note,
        category: form.category,
        author: 'manual',
      });
      toast.success('Note added');
      setForm({ note: '', category: 'general' });
      queryClient.invalidateQueries({ queryKey: ['salesOrderNotes', order.id] });
    } catch (err) {
      toast.error(err.message || 'Could not add note');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="text-sm font-semibold mb-3 flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Add Note
        </p>
        <form onSubmit={handleAdd} className="space-y-2">
          <Textarea
            placeholder="Write a note..."
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            rows={3}
          />
          <div className="flex items-center gap-2">
            <select
              className="text-sm border rounded-md px-2 py-2 bg-background"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <Button type="submit" disabled={saving} className="gap-1">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add note
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-4">
        <p className="text-sm font-semibold mb-3 flex items-center gap-1.5">
          <StickyNote className="w-4 h-4" /> Notes
        </p>
        {sorted.length === 0 ? (
          <p className="text-xs text-muted-foreground">No notes yet.</p>
        ) : (
          <div className="space-y-2">
            {sorted.map((n) => (
              <div key={n.id} className="border rounded-lg px-3 py-2">
                <div className="flex items-center justify-between mb-1">
                  <Badge
                    variant="outline"
                    className={`text-[10px] capitalize border ${CATEGORY_COLORS[n.category] || CATEGORY_COLORS.general}`}
                  >
                    {(n.category || 'general').replace(/_/g, ' ')}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {n.author ? `${n.author} · ` : ''}
                    {n.created_date ? formatDateTimeSAST(n.created_date) : ''}
                  </span>
                </div>
                <p className="text-sm text-slate-700 whitespace-pre-line">{n.note}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
