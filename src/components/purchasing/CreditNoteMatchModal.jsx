import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, CreditCard, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import ValidationErrorBanner from './ValidationErrorBanner';

export default function CreditNoteMatchModal({ supplierId, onCreated, onCancel }) {
  const qc = useQueryClient();
  const [creditNoteId, setCreditNoteId] = useState('');
  const [matchTarget, setMatchTarget] = useState(''); // shortageId or returnId
  const [matchType, setMatchType] = useState('shortage'); // 'shortage' | 'return'
  const [matchedAmount, setMatchedAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);

  const { data: creditNotes = [] } = useQuery({
    queryKey: ['credit-notes-supplier', supplierId],
    queryFn: () => base44.entities.SupplierCreditNote.filter({ supplier_id: supplierId, status: ['open', 'partially_matched'] }, '-created_date', 50),
    enabled: !!supplierId,
  });
  const { data: shortages = [] } = useQuery({
    queryKey: ['shortages-supplier', supplierId],
    queryFn: () => base44.entities.SupplierShortage.filter({ supplier_id: supplierId, status: ['open', 'credit_requested'] }, '-created_date', 50),
    enabled: !!supplierId,
  });
  const { data: returns = [] } = useQuery({
    queryKey: ['returns-supplier', supplierId],
    queryFn: () => base44.entities.SupplierReturn.filter({ supplier_id: supplierId }, '-created_date', 50),
    enabled: !!supplierId,
  });

  const selectedCN = useMemo(() => creditNotes.find(cn => cn.id === creditNoteId), [creditNotes, creditNoteId]);

  const validate = () => {
    const errs = [];
    if (!creditNoteId) errs.push('Select a credit note to match.');
    if (!matchTarget) errs.push('Select the shortage or return to match against.');
    const amt = parseFloat(matchedAmount);
    if (!amt || amt <= 0) errs.push('Matched amount must be greater than zero.');
    if (selectedCN) {
      const remaining = (selectedCN.total || 0) - (selectedCN.matched_amount || 0);
      if (amt > remaining + 0.005) errs.push(`Matched amount (R ${amt.toFixed(2)}) exceeds remaining balance (R ${remaining.toFixed(2)}).`);
    }
    return errs;
  };

  const handleMatch = async () => {
    const errs = validate();
    if (errs.length > 0) { setErrors(errs); return; }
    setErrors([]);
    setSaving(true);

    try {
      const amt = parseFloat(matchedAmount);
      await base44.entities.SupplierCreditNoteMatch.create({
        credit_note_id: creditNoteId,
        shortage_id: matchType === 'shortage' ? matchTarget : null,
        return_id: matchType === 'return' ? matchTarget : null,
        matched_amount: Math.round(amt * 100) / 100,
        match_date: new Date().toISOString().slice(0, 10),
        notes: notes || null,
      });

      // Update credit note matched_amount and status
      const newMatched = (selectedCN.matched_amount || 0) + amt;
      const newTotal = selectedCN.total || 0;
      const newStatus = newMatched >= newTotal - 0.005 ? 'fully_matched' : 'partially_matched';
      await base44.entities.SupplierCreditNote.update(creditNoteId, {
        matched_amount: Math.round(newMatched * 100) / 100,
        status: newStatus,
      });

      // Update shortage/return status
      if (matchType === 'shortage') {
        await base44.entities.SupplierShortage.update(matchTarget, { status: 'credit_received' });
      } else {
        await base44.entities.SupplierReturn.update(matchTarget, { status: 'credit_received' });
      }

      toast.success('Credit note matched successfully');
      qc.invalidateQueries({ queryKey: ['credit-notes-supplier', supplierId] });
      onCreated && onCreated();
    } catch (err) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4">
      <div className="bg-card w-full max-w-lg rounded-xl shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-bold">Match Credit Note</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <ValidationErrorBanner errors={errors} />

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Credit Note *</label>
            <Select value={creditNoteId} onValueChange={setCreditNoteId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select credit note..." /></SelectTrigger>
              <SelectContent>
                {creditNotes.map(cn => (
                  <SelectItem key={cn.id} value={cn.id}>
                    {cn.scn_number || cn.supplier_credit_note_number} — R {(cn.total || 0).toFixed(2)}
                    {cn.status === 'partially_matched' && ` (R ${((cn.total||0)-(cn.matched_amount||0)).toFixed(2)} remaining)`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Match Against *</label>
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => setMatchType('shortage')}
                className={`text-xs px-3 py-1.5 rounded-full border transition-all ${matchType === 'shortage' ? 'bg-primary/10 text-primary border-primary/30' : 'border-border text-muted-foreground'}`}
              >
                Shortage
              </button>
              <button
                onClick={() => setMatchType('return')}
                className={`text-xs px-3 py-1.5 rounded-full border transition-all ${matchType === 'return' ? 'bg-primary/10 text-primary border-primary/30' : 'border-border text-muted-foreground'}`}
              >
                Return
              </button>
            </div>
            <Select value={matchTarget} onValueChange={setMatchTarget}>
              <SelectTrigger className="mt-2"><SelectValue placeholder={`Select ${matchType}...`} /></SelectTrigger>
              <SelectContent>
                {(matchType === 'shortage' ? shortages : returns).map(item => (
                  <SelectItem key={item.id} value={item.id}>
                    {matchType === 'shortage'
                      ? `${item.product_name} — R ${(item.shortage_value || 0).toFixed(2)}`
                      : `${item.return_number || 'RTN'} — R ${(item.total_return_value || 0).toFixed(2)}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Matched Amount (R) *</label>
            <Input type="number" value={matchedAmount} onChange={e => setMatchedAmount(e.target.value)} className="mt-1" min="0.01" step="0.01" placeholder="0.00" />
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Notes</label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} className="mt-1" placeholder="Optional notes" />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button className="flex-1 gap-2" onClick={handleMatch} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
            Confirm Match
          </Button>
        </div>
      </div>
    </div>
  );
}
