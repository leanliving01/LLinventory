import React from 'react';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ArrowLeftRight, CreditCard } from 'lucide-react';
import { shortageStatusLabel } from '@/lib/shortageEngine';

const TONE_CLASSES = {
  amber: 'bg-amber-100 text-amber-700',
  blue:  'bg-blue-100 text-blue-700',
  green: 'bg-green-100 text-green-700',
  gray:  'bg-gray-100 text-gray-600',
};

function ShortageRow({ shortage }) {
  const { label, tone } = shortageStatusLabel(shortage);
  return (
    <div className="flex items-start gap-3 p-3 border border-border rounded-lg bg-card">
      <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{shortage.product_name}</p>
        <p className="text-xs text-muted-foreground">
          Short: {shortage.shortage_qty} {shortage.purchase_uom} · R {(shortage.shortage_value || 0).toFixed(2)}
        </p>
      </div>
      <Badge className={`text-[10px] shrink-0 ${TONE_CLASSES[tone] || TONE_CLASSES.amber}`}>
        {label}
      </Badge>
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
            {shortages.map(s => <ShortageRow key={s.id} shortage={s} />)}
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
