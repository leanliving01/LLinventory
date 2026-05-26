import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ArrowLeftRight, CreditCard, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { nextDocNumber } from '@/lib/docNumbering';

function ShortageRow({ shortage, onRequestCredit }) {
  return (
    <div className="flex items-start gap-3 p-3 border border-border rounded-lg bg-card">
      <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{shortage.product_name}</p>
        <p className="text-xs text-muted-foreground">
          Short: {shortage.shortage_qty} {shortage.purchase_uom} · R {(shortage.shortage_value || 0).toFixed(2)}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <Badge className={`text-[10px] ${shortage.status === 'open' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
          {shortage.status}
        </Badge>
        {shortage.status === 'open' && (
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onRequestCredit(shortage)}>
            Request Credit
          </Button>
        )}
      </div>
    </div>
  );
}

function ReturnRow({ supplierReturn }) {
  return (
    <div className="flex items-start gap-3 p-3 border border-border rounded-lg bg-card">
      <ArrowLeftRight className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium font-mono">{supplierReturn.return_number || 'RTN'}</p>
        <p className="text-xs text-muted-foreground">
          Supplier: {supplierReturn.supplier_name} · R {(supplierReturn.total_return_value || 0).toFixed(2)}
        </p>
      </div>
      <Badge className="text-[10px] shrink-0">
        {supplierReturn.status}
      </Badge>
    </div>
  );
}

function CreditNoteRow({ creditNote }) {
  const remaining = (creditNote.total || 0) - (creditNote.matched_amount || 0);
  return (
    <div className="flex items-start gap-3 p-3 border border-border rounded-lg bg-card">
      <CreditCard className="w-4 h-4 text-purple-500 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium font-mono">{creditNote.scn_number || creditNote.supplier_credit_note_number}</p>
        <p className="text-xs text-muted-foreground">
          R {(creditNote.total || 0).toFixed(2)} · Remaining: R {remaining.toFixed(2)}
        </p>
      </div>
      <Badge className={`text-[10px] shrink-0 ${creditNote.status === 'fully_matched' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`}>
        {creditNote.status}
      </Badge>
    </div>
  );
}

export default function WorkspaceCreditReturnsTab({ po, shortages = [], returns = [], creditNotes = [], onDataChanged }) {
  const qc = useQueryClient();

  const handleRequestCredit = async (shortage) => {
    // Mark shortage as "credit_requested" — create a note
    try {
      await base44.entities.SupplierShortage.update(shortage.id, { status: 'credit_requested' });
      toast.success('Credit request noted');
      qc.invalidateQueries({ queryKey: ['workspace-shortages', po.id] });
      onDataChanged && onDataChanged();
    } catch (err) {
      toast.error(`Failed: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Shortages */}
      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" /> Shortages ({shortages.length})
        </h3>
        {shortages.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3">No shortages on this PO.</p>
        ) : (
          <div className="space-y-2">
            {shortages.map(s => <ShortageRow key={s.id} shortage={s} onRequestCredit={handleRequestCredit} />)}
          </div>
        )}
      </section>

      {/* Returns */}
      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <ArrowLeftRight className="w-4 h-4 text-blue-500" /> Returns ({returns.length})
        </h3>
        {returns.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3">No returns on this PO.</p>
        ) : (
          <div className="space-y-2">
            {returns.map(r => <ReturnRow key={r.id} supplierReturn={r} />)}
          </div>
        )}
      </section>

      {/* Credit Notes */}
      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-purple-500" /> Credit Notes ({creditNotes.length})
        </h3>
        {creditNotes.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3">No credit notes for this supplier.</p>
        ) : (
          <div className="space-y-2">
            {creditNotes.map(cn => <CreditNoteRow key={cn.id} creditNote={cn} />)}
          </div>
        )}
      </section>
    </div>
  );
}
