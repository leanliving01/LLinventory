import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';

const FOLDERS = [
  { key: 'all_active',         label: 'All Active',            badge: null },
  { key: 'draft',              label: 'Drafts',                badge: null },
  { key: 'awaiting_approval',  label: 'Awaiting Approval',     badge: null },
  { key: 'approved',           label: 'Approved',              badge: null },
  { key: 'awaiting_grn',       label: 'Awaiting GRN',          badge: 'amber' },
  { key: 'partially_received',  label: 'Partially Received',   badge: 'amber' },
  { key: 'received',            label: 'Received',             badge: null },
  { key: 'awaiting_invoice',    label: 'Awaiting Invoice',     badge: 'amber' },
  { key: 'credit_note_pending', label: 'Credit Note Pending',  badge: 'red' },
  { key: 'invoiced',           label: 'Invoiced',              badge: null },
  { key: 'paid',               label: 'Paid',                  badge: null },
  { key: 'needs_review',       label: 'Needs Review',          badge: 'red' },
  { key: 'price_variance',     label: 'Price Variance',        badge: 'red' },
  { key: 'credit_notes',       label: 'Credit Notes Pending',  badge: 'red' },
  { key: 'returns_pending',    label: 'Returns Pending Credit',badge: 'red' },
];

function FolderItem({ label, count, badgeVariant, isActive, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors text-left',
        isActive
          ? 'bg-primary/10 text-primary font-semibold'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      <span className="truncate">{label}</span>
      {count > 0 && (
        <span className={cn(
          'text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center shrink-0 ml-1',
          badgeVariant === 'red'   ? 'bg-red-100 text-red-700' :
          badgeVariant === 'amber' ? 'bg-amber-100 text-amber-700' :
          'bg-muted text-muted-foreground'
        )}>
          {count}
        </span>
      )}
    </button>
  );
}

export default function SmartFolderNav({
  pos = [],
  grns = [],
  invoices = [],
  returns = [],
  creditNotes = [],
  posNeedingAttention = new Set(),
  activeFolder,
  onFolderSelect,
}) {
  const counts = useMemo(() => {
    const grnByPoId = {};
    grns.forEach(g => {
      if (!grnByPoId[g.purchase_order_id]) grnByPoId[g.purchase_order_id] = [];
      grnByPoId[g.purchase_order_id].push(g);
    });

    const invoiceByPoId = {};
    invoices.forEach(i => {
      if (!invoiceByPoId[i.purchase_order_id]) invoiceByPoId[i.purchase_order_id] = [];
      invoiceByPoId[i.purchase_order_id].push(i);
    });

    const approvedStatuses = ['approved', 'confirmed'];
    const postReceiveStatuses = ['received', 'invoiced'];

    return {
      all_active:         pos.filter(p => !['cancelled', 'paid'].includes(p.status)).length,
      draft:              pos.filter(p => p.status === 'draft').length,
      awaiting_approval:  pos.filter(p => p.status === 'awaiting_approval').length,
      approved:           pos.filter(p => approvedStatuses.includes(p.status)).length,
      awaiting_grn:       pos.filter(p =>
        approvedStatuses.includes(p.status) &&
        !(grnByPoId[p.id] || []).some(g => g.status === 'confirmed')
      ).length,
      partially_received: pos.filter(p => p.status === 'partially_received').length,
      received:           pos.filter(p => p.status === 'received').length,
      awaiting_invoice:   pos.filter(p =>
        postReceiveStatuses.includes(p.status) &&
        !(invoiceByPoId[p.id] || []).some(i => !i.is_credit_note)
      ).length,
      credit_note_pending: pos.filter(p => p.status === 'credit_note_pending').length,
      invoiced:           pos.filter(p => p.status === 'invoiced').length,
      paid:               pos.filter(p => p.status === 'paid').length,
      needs_review:       posNeedingAttention.size,
      price_variance:     grns.filter(g => g.has_price_variance).length,
      credit_notes:       creditNotes.filter(cn => cn.status === 'open').length,
      returns_pending:    returns.filter(r => ['pending_return', 'pending_credit'].includes(r.status)).length,
    };
  }, [pos, grns, invoices, returns, creditNotes, posNeedingAttention]);

  return (
    <nav className="w-52 shrink-0 space-y-0.5 pr-2 border-r border-border">
      <p className="text-[10px] uppercase font-semibold text-muted-foreground px-3 pb-1 pt-0.5 tracking-wide">
        Folders
      </p>
      {FOLDERS.map(folder => (
        <FolderItem
          key={folder.key}
          label={folder.label}
          count={counts[folder.key] || 0}
          badgeVariant={folder.badge}
          isActive={activeFolder === folder.key}
          onClick={() => onFolderSelect(activeFolder === folder.key ? null : folder.key)}
        />
      ))}
    </nav>
  );
}
