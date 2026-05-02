import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { X, ShieldCheck, AlertTriangle, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
// date-fns format removed — using toISOString for date-only strings

const QS_STYLES = {
  fresh: 'bg-green-100 text-green-700',
  use_today: 'bg-amber-100 text-amber-700',
  quarantine: 'bg-red-100 text-red-600',
  written_off: 'bg-gray-100 text-gray-500',
};

const QC_RESULT_OPTIONS = [
  { value: 'approved_full', label: 'Approved — Full Quality' },
  { value: 'approved_use_today', label: 'Approved — Use Today Only' },
  { value: 'quarantine', label: 'Quarantine' },
  { value: 'write_off', label: 'Write Off' },
];

export default function WipBatchDrawer({ batch, onClose, onUpdated }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const [saving, setSaving] = useState(false);
  const [qcResult, setQcResult] = useState('');
  const [qcNotes, setQcNotes] = useState('');
  const [writeOffQty, setWriteOffQty] = useState('');
  const [writeOffReason, setWriteOffReason] = useState('');
  const [writeOffNotes, setWriteOffNotes] = useState('');

  const { data: qcHistory = [] } = useQuery({
    queryKey: ['wip-qc', batch.id],
    queryFn: () => base44.entities.WipQualityCheck.filter({ wip_batch_id: batch.id }, '-check_date', 20),
  });

  const { data: writeOffs = [] } = useQuery({
    queryKey: ['wip-writeoffs', batch.id],
    queryFn: () => base44.entities.WipWriteOff.filter({ wip_batch_id: batch.id }, '-created_date', 20),
  });

  const handleQualityCheck = async () => {
    if (!qcResult) { toast.error('Select a result'); return; }
    setSaving(true);

    const today = new Date().toISOString().slice(0, 10);
    await base44.entities.WipQualityCheck.create({
      wip_batch_id: batch.id,
      check_date: today,
      check_time: new Date().toISOString(),
      checked_by_name: user?.full_name || '',
      result: qcResult,
      notes: qcNotes || null,
    });

    // Update batch status
    const statusMap = {
      approved_full: 'fresh',
      approved_use_today: 'use_today',
      quarantine: 'quarantine',
      write_off: 'written_off',
    };
    const newStatus = statusMap[qcResult] || batch.quality_status;
    const updateData = {
      quality_status: newStatus,
      last_qc_date: today,
      last_qc_by: user?.full_name || '',
    };

    // If write_off from QC, create WipWriteOff
    if (qcResult === 'write_off') {
      updateData.qty_kg = 0;
      updateData.total_carrying_value = 0;
      await base44.entities.WipWriteOff.create({
        wip_batch_id: batch.id,
        bulk_product_id: batch.bulk_product_id,
        bulk_product_name: batch.bulk_product_name,
        qty_kg: batch.qty_kg,
        carrying_cost_per_kg: batch.carrying_cost_per_kg || 0,
        total_value: (batch.qty_kg || 0) * (batch.carrying_cost_per_kg || 0),
        reason: 'quality_deterioration',
        notes: qcNotes || 'Written off via quality check',
        approved_by_name: user?.full_name || '',
        triggered_by: 'quality_check',
      });
    }

    await base44.entities.WipBatch.update(batch.id, updateData);
    toast.success('Quality check recorded');
    setSaving(false);
    setQcResult('');
    setQcNotes('');
    queryClient.invalidateQueries({ queryKey: ['wip-qc', batch.id] });
    onUpdated();
  };

  const handleWriteOff = async () => {
    const qty = Number(writeOffQty);
    if (!qty || qty <= 0) { toast.error('Enter quantity'); return; }
    if (!writeOffReason) { toast.error('Select reason'); return; }
    if (qty > batch.qty_kg) { toast.error('Cannot write off more than remaining quantity'); return; }

    setSaving(true);
    const costPerKg = batch.carrying_cost_per_kg || 0;
    const value = qty * costPerKg;

    await base44.entities.WipWriteOff.create({
      wip_batch_id: batch.id,
      bulk_product_id: batch.bulk_product_id,
      bulk_product_name: batch.bulk_product_name,
      qty_kg: qty,
      carrying_cost_per_kg: costPerKg,
      total_value: Math.round(value * 100) / 100,
      reason: writeOffReason,
      notes: writeOffNotes || null,
      approved_by_name: user?.full_name || '',
      triggered_by: 'manual',
    });

    const newQty = Math.round((batch.qty_kg - qty) * 100) / 100;
    const isFullWriteOff = newQty <= 0;
    await base44.entities.WipBatch.update(batch.id, {
      qty_kg: Math.max(0, newQty),
      total_carrying_value: Math.round(Math.max(0, newQty) * costPerKg * 100) / 100,
      quality_status: isFullWriteOff ? 'written_off' : batch.quality_status,
    });

    toast.success(`${qty} kg written off (R ${value.toFixed(2)})`);
    setSaving(false);
    setWriteOffQty('');
    setWriteOffReason('');
    setWriteOffNotes('');
    queryClient.invalidateQueries({ queryKey: ['wip-writeoffs', batch.id] });
    onUpdated();
  };

  const isWrittenOff = batch.quality_status === 'written_off';

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-card shadow-xl flex flex-col">
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-start justify-between z-10 shrink-0">
          <div>
            <Badge className={`text-[10px] mb-1 ${QS_STYLES[batch.quality_status]}`}>
              {batch.quality_status?.replace('_', ' ')}
            </Badge>
            <h2 className="text-lg font-bold font-mono">{batch.batch_number}</h2>
            <p className="text-sm text-muted-foreground">{batch.bulk_product_name}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-5 h-5" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Batch info */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-muted-foreground text-xs uppercase font-semibold">Remaining</span><p className="text-lg font-bold">{(batch.qty_kg || 0).toFixed(1)} kg</p></div>
            <div><span className="text-muted-foreground text-xs uppercase font-semibold">Original</span><p>{(batch.original_qty_kg || 0).toFixed(1)} kg</p></div>
            <div><span className="text-muted-foreground text-xs uppercase font-semibold">Cost/kg</span><p>R {(batch.carrying_cost_per_kg || 0).toFixed(2)}</p></div>
            <div><span className="text-muted-foreground text-xs uppercase font-semibold">Carrying Value</span><p>R {(batch.total_carrying_value || 0).toFixed(2)}</p></div>
            <div><span className="text-muted-foreground text-xs uppercase font-semibold">Produced</span><p>{batch.produced_date || '—'}</p></div>
            <div><span className="text-muted-foreground text-xs uppercase font-semibold">Supplier</span><p>{batch.supplier_name || '—'}</p></div>
          </div>

          {/* Quality Check */}
          {!isWrittenOff && perms.wip_manage && (
            <div className="border border-border rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" /> Record Quality Check
              </h3>
              <Select value={qcResult} onValueChange={setQcResult}>
                <SelectTrigger><SelectValue placeholder="Select result..." /></SelectTrigger>
                <SelectContent>
                  {QC_RESULT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input value={qcNotes} onChange={e => setQcNotes(e.target.value)} placeholder="Notes (optional)..." />
              <Button onClick={handleQualityCheck} disabled={saving || !qcResult} className="gap-2 w-full h-11">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                Save Quality Check
              </Button>
            </div>
          )}

          {/* Manual Write-Off */}
          {!isWrittenOff && perms.wip_manage && batch.qty_kg > 0 && (
            <div className="border border-border rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-destructive" /> Write Off Stock
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <Input type="number" min="0.01" step="0.01" max={batch.qty_kg} value={writeOffQty} onChange={e => setWriteOffQty(e.target.value)} placeholder="Qty (kg)" />
                <Select value={writeOffReason} onValueChange={setWriteOffReason}>
                  <SelectTrigger><SelectValue placeholder="Reason..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quality_deterioration">Quality Deterioration</SelectItem>
                    <SelectItem value="shelf_life_exceeded">Shelf Life Exceeded</SelectItem>
                    <SelectItem value="contamination">Contamination</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Input value={writeOffNotes} onChange={e => setWriteOffNotes(e.target.value)} placeholder="Notes..." />
              <Button onClick={handleWriteOff} disabled={saving} variant="destructive" className="gap-2 w-full h-11">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Confirm Write-Off
              </Button>
            </div>
          )}

          {/* QC History */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Quality Check History</h3>
            {qcHistory.length === 0 ? (
              <p className="text-xs text-muted-foreground">No checks recorded</p>
            ) : (
              <div className="space-y-2">
                {qcHistory.map(qc => (
                  <div key={qc.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium">{qc.result?.replace(/_/g, ' ')}</span>
                      <span className="text-muted-foreground ml-2">{qc.check_date}</span>
                      {qc.checked_by_name && <span className="text-muted-foreground ml-2">by {qc.checked_by_name}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Write-off History */}
          {writeOffs.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2">Write-Off History</h3>
              <div className="space-y-2">
                {writeOffs.map(wo => (
                  <div key={wo.id} className="bg-red-50 dark:bg-red-950/20 rounded-lg px-3 py-2 text-sm">
                    <span className="font-medium">{wo.qty_kg} kg</span>
                    <span className="text-muted-foreground ml-2">R {(wo.total_value || 0).toFixed(2)}</span>
                    <span className="text-muted-foreground ml-2">{wo.reason?.replace(/_/g, ' ')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}