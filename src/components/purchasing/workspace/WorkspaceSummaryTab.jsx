import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Clock, AlertTriangle, FileText, PackageCheck, CreditCard, ChevronRight } from 'lucide-react';

function InfoRow({ label, value, mono }) {
  return (
    <div>
      <dt className="text-[10px] uppercase font-semibold text-muted-foreground">{label}</dt>
      <dd className={`text-sm font-medium mt-0.5 ${mono ? 'font-mono' : ''} ${value ? '' : 'text-muted-foreground'}`}>
        {value || '—'}
      </dd>
    </div>
  );
}

function InfoSection({ title, children, faded, badge }) {
  return (
    <div className={`space-y-3 ${faded ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <p className="text-xs font-semibold uppercase text-muted-foreground">{title}</p>
        {badge && <Badge className="text-[10px] py-0">{badge}</Badge>}
      </div>
      <dl className="space-y-2.5">{children}</dl>
    </div>
  );
}

function StatusCard({ icon: Icon, title, value, color, detail }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
      <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${color}`} />
      <div className="min-w-0">
        <p className="text-[10px] uppercase font-semibold text-muted-foreground">{title}</p>
        <p className={`text-sm font-semibold ${color}`}>{value}</p>
        {detail && <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>}
      </div>
    </div>
  );
}

function deriveNextAction(po, invoice, grns, shortages) {
  if (!po) return null;
  const isBlind = po.type === 'blind_receipt';
  const hasConfirmedGRN = grns.some(g => g.status === 'confirmed');
  const hasDraftGRN = grns.some(g => g.status === 'draft');

  if (!isBlind && po.status === 'draft') {
    return { tab: null, label: 'Approve this PO before proceeding', action: null };
  }
  if (!hasConfirmedGRN && !hasDraftGRN && ['approved', 'confirmed', 'received'].includes(po.status)) {
    return { tab: 'grn', label: 'No GRN yet — confirm receipt of goods', action: 'Create GRN' };
  }
  if (hasDraftGRN) {
    return { tab: 'grn', label: 'A GRN is in draft — confirm it to update stock', action: 'Confirm GRN' };
  }
  if (!invoice) {
    return { tab: 'lines', label: 'No invoice yet — add the supplier invoice', action: 'Add Invoice' };
  }
  if (invoice.status === 'pending_match') {
    return { tab: 'lines', label: 'Invoice awaiting authorisation', action: 'Authorise Invoice' };
  }
  if (invoice.payment_status === 'unpaid' && invoice.status === 'approved') {
    return { tab: null, label: 'Invoice approved — record payment when due', action: null };
  }
  if (shortages.length > 0) {
    return { tab: 'credits', label: `${shortages.length} outstanding shortage(s) — follow up for credit`, action: 'View Shortages' };
  }
  return { tab: null, label: 'All steps complete', action: null };
}

export default function WorkspaceSummaryTab({ po, invoice, grns = [], shortages = [], returns = [], onTabChange }) {
  if (!po) return null;

  const isBlind = po.type === 'blind_receipt';
  const hasConfirmedGRN = grns.some(g => g.status === 'confirmed');
  const hasPriceVariance = grns.some(g => g.has_price_variance);
  const nextAction = deriveNextAction(po, invoice, grns, shortages);
  const grnTotal = grns.filter(g => g.status === 'confirmed').reduce((s, g) => s + (g.total_received_value || 0), 0);
  const confirmedGRNs = grns.filter(g => g.status === 'confirmed').sort((a, b) => (b.received_date || '').localeCompare(a.received_date || ''));
  const latestGRN = confirmedGRNs[0] || null;

  return (
    <div className="space-y-4">

      {/* ── Document Info Panel ── */}
      <div className="bg-muted/30 border border-border rounded-xl p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 divide-y md:divide-y-0 md:divide-x divide-border">

          {/* PO Section */}
          <InfoSection
            title={isBlind ? 'Blind Receipt' : 'Purchase Order'}
            badge={isBlind ? 'Blind Receipt' : null}
          >
            {!isBlind && <InfoRow label="PO Number" value={po.po_number} mono />}
            <InfoRow label="Order Date" value={po.order_date} />
            <InfoRow label="Supplier" value={po.supplier_name} />
            <InfoRow label="Payment Terms" value={po.payment_terms} />
            <InfoRow label="Expected Delivery" value={po.expected_delivery_date} />
            <InfoRow label="Delivery Location" value={po.location_name} />
          </InfoSection>

          {/* Invoice Section */}
          <div className="pt-4 md:pt-0 md:pl-6">
            <InfoSection title="Invoice" faded={!invoice}>
              <InfoRow label="Invoice #" value={invoice?.invoice_number} mono />
              <InfoRow label="Invoice Date" value={invoice?.invoice_date} />
              <InfoRow label="Due Date" value={invoice?.due_date_calculated} />
            </InfoSection>
          </div>

          {/* GRN Section */}
          <div className="pt-4 md:pt-0 md:pl-6">
            <InfoSection
              title="Goods Received"
              faded={!latestGRN}
              badge={confirmedGRNs.length > 1 ? `${confirmedGRNs.length} GRNs` : null}
            >
              <InfoRow label="GRN Number" value={latestGRN?.grn_number} mono />
              <InfoRow label="Received Date" value={latestGRN?.received_date} />
              <InfoRow label="Received At" value={latestGRN?.location_name} />
              <InfoRow
                label="Total Received"
                value={latestGRN ? `R ${(latestGRN.total_received_value || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null}
              />
            </InfoSection>
          </div>

        </div>
      </div>

      {/* ── Status summary grid ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatusCard
          icon={FileText}
          title="Purchase Order"
          value={po.status}
          color={['received', 'invoiced', 'paid'].includes(po.status) ? 'text-green-700' : 'text-blue-600'}
          detail={po.po_number}
        />
        <StatusCard
          icon={PackageCheck}
          title="GRN"
          value={hasConfirmedGRN ? 'Confirmed' : grns.length > 0 ? 'Draft' : 'None'}
          color={hasConfirmedGRN ? 'text-green-700' : grns.length > 0 ? 'text-amber-600' : 'text-muted-foreground'}
          detail={hasConfirmedGRN ? `R ${grnTotal.toFixed(2)} received` : 'No stock received yet'}
        />
        <StatusCard
          icon={FileText}
          title="Invoice"
          value={invoice ? invoice.status : 'None'}
          color={invoice?.status === 'approved' ? 'text-green-700' : invoice ? 'text-amber-600' : 'text-muted-foreground'}
          detail={invoice ? invoice.invoice_number : 'No invoice yet'}
        />
        <StatusCard
          icon={CreditCard}
          title="Payment"
          value={invoice ? (invoice.payment_status || 'unpaid') : '—'}
          color={invoice?.payment_status === 'paid' ? 'text-green-700' : invoice?.payment_status === 'overdue' ? 'text-red-600' : 'text-muted-foreground'}
          detail={invoice?.due_date_calculated ? `Due: ${invoice.due_date_calculated}` : undefined}
        />
      </div>

      {/* ── Flags ── */}
      {(hasPriceVariance || shortages.length > 0 || returns.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {hasPriceVariance && (
            <div className="flex items-center gap-1.5 text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Price variance on GRN lines
            </div>
          )}
          {shortages.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> {shortages.length} shortage(s) open
            </div>
          )}
          {returns.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> {returns.length} return(s) pending
            </div>
          )}
        </div>
      )}

      {/* ── Next recommended action ── */}
      {nextAction && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-primary uppercase mb-0.5">Next Action</p>
            <p className="text-sm text-foreground">{nextAction.label}</p>
          </div>
          {nextAction.action && nextAction.tab && (
            <Button size="sm" className="gap-2 shrink-0" onClick={() => onTabChange && onTabChange(nextAction.tab)}>
              {nextAction.action} <ChevronRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
