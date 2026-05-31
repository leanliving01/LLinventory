import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ArrowLeftRight, CreditCard, Plus } from 'lucide-react';
import { shortageStatusLabel, shortageKind } from '@/lib/shortageEngine';
import CreditNoteEditor from '@/components/purchasing/CreditNoteEditor';
import CreateReturnModal from '@/components/returns/CreateReturnModal';

const TONE_CLASSES = {
  amber: 'bg-amber-100 text-amber-700',
  blue:  'bg-blue-100 text-blue-700',
  green: 'bg-green-100 text-green-700',
  gray:  'bg-gray-100 text-gray-600',
};

function ShortageRow({ shortage, onAllocate }) {
  const { label, tone } = shortageStatusLabel(shortage);
  const canAllocate = shortageKind(shortage.decision) === 'credit'
    && !['resolved', 'cancelled', 'credit_received'].includes(shortage.status);
  const variance = shortage.credit_variance;
  return (
    <div className="flex items-start gap-3 p-3 border border-border rounded-lg bg-card">
      <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{shortage.product_name}</p>
        <p className="text-xs text-muted-foreground">
          Short: {shortage.shortage_qty} {shortage.purchase_uom} · R {(shortage.shortage_value || 0).toFixed(2)}
          {shortage.credit_note_number && <> · CN: <span className="font-mono">{shortage.credit_note_number}</span></>}
        </p>
        {shortage.status === 'partially_credited' && shortage.resolution_notes && (
          <p className="text-[11px] text-amber-700 mt-0.5">{shortage.resolution_notes}</p>
        )}
        {shortage.status !== 'partially_credited' && variance != null && Math.abs(variance) > 0.001 && (
          <p className="text-[11px] text-amber-700 mt-0.5">Credit variance: R {variance.toFixed(2)}</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <Badge className={`text-[10px] ${TONE_CLASSES[tone] || TONE_CLASSES.amber}`}>{label}</Badge>
        {canAllocate && (
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => onAllocate(shortage)}>
            <CreditCard className="w-3 h-3" /> Allocate Credit Note
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
      <Badge className="text-[10px] shrink-0">{supplierReturn.status}</Badge>
    </div>
  );
}

function CreditNoteRow({ creditNote, onOpen }) {
  const variance = creditNote.total_variance;
  return (
    <button
      className="w-full flex items-start gap-3 p-3 border border-border rounded-lg bg-card text-left hover:bg-muted/30 transition-colors"
      onClick={() => onOpen(creditNote)}
    >
      <CreditCard className="w-4 h-4 text-purple-500 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium font-mono">{creditNote.supplier_credit_note_number || creditNote.scn_number}</p>
        <p className="text-xs text-muted-foreground">
          {creditNote.credit_note_date || '—'} · Total: R {(creditNote.total || 0).toFixed(2)}
          {variance != null && Math.abs(variance) > 0.001 && <> · <span className="text-amber-700">variance R {variance.toFixed(2)}</span></>}
        </p>
      </div>
      <Badge className={`text-[10px] shrink-0 ${creditNote.status === 'fully_matched' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`}>
        {(creditNote.status || '').replace(/_/g, ' ')}
      </Badge>
    </button>
  );
}

export default function WorkspaceCreditReturnsTab({ po, shortages = [], returns = [], creditNotes = [], onDataChanged }) {
  const qc = useQueryClient();
  const [showCreditEditor, setShowCreditEditor] = useState(false);
  const [viewCreditNote, setViewCreditNote] = useState(null);
  const [showCreateReturn, setShowCreateReturn] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['workspace-shortages', po.id] });
    qc.invalidateQueries({ queryKey: ['workspace-returns', po.id] });
    qc.invalidateQueries({ queryKey: ['workspace-credit-notes', po.id] });
    qc.invalidateQueries({ queryKey: ['po', po.id] });
    onDataChanged && onDataChanged();
  };

  const hasOpenCreditShortage = shortages.some(s =>
    shortageKind(s.decision) === 'credit' && !['resolved', 'cancelled', 'credit_received'].includes(s.status)
  );

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
            {shortages.map(s => <ShortageRow key={s.id} shortage={s} onAllocate={() => setShowCreditEditor(true)} />)}
          </div>
        )}
      </section>

      {/* Returns */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4 text-blue-500" /> Returns ({returns.length})
          </h3>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowCreateReturn(true)}>
            <Plus className="w-3.5 h-3.5" /> Create Return
          </Button>
        </div>
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
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-purple-500" /> Credit Notes ({creditNotes.length})
          </h3>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowCreditEditor(true)}>
            <Plus className="w-3.5 h-3.5" /> Raise Credit Note
          </Button>
        </div>
        {creditNotes.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3">No credit notes for this supplier.</p>
        ) : (
          <div className="space-y-2">
            {creditNotes.map(cn => <CreditNoteRow key={cn.id} creditNote={cn} onOpen={setViewCreditNote} />)}
          </div>
        )}
      </section>

      {showCreditEditor && (
        <CreditNoteEditor
          po={po}
          shortages={shortages}
          onCreated={() => { setShowCreditEditor(false); refresh(); }}
          onCancel={() => setShowCreditEditor(false)}
        />
      )}

      {viewCreditNote && (
        <CreditNoteEditor
          po={po}
          shortages={shortages}
          existingCreditNote={viewCreditNote}
          onCreated={() => setViewCreditNote(null)}
          onCancel={() => setViewCreditNote(null)}
        />
      )}

      {showCreateReturn && (
        <CreateReturnModal
          po={po}
          onCreated={() => { setShowCreateReturn(false); refresh(); }}
          onCancel={() => setShowCreateReturn(false)}
        />
      )}
    </div>
  );
}
