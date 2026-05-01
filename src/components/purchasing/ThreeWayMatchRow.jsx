import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp, Receipt, Truck, FileText, CheckCircle2, AlertTriangle, Clock, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';

const STATUS_CONFIG = {
  fully_matched: { label: 'Fully Matched', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  variance: { label: 'Variance', color: 'bg-amber-100 text-amber-700', icon: AlertTriangle },
  no_grn: { label: 'Missing GRN', color: 'bg-blue-100 text-blue-700', icon: Clock },
  no_invoice: { label: 'Missing Invoice', color: 'bg-purple-100 text-purple-700', icon: Clock },
  partial: { label: 'Partial', color: 'bg-gray-100 text-gray-600', icon: Clock },
};

function DocCard({ icon: Icon, label, exists, items, totalValue, variancePct }) {
  return (
    <div className={`flex-1 min-w-[180px] rounded-lg border p-3 ${exists ? 'border-border bg-card' : 'border-dashed border-border bg-muted/30'}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${exists ? 'text-primary' : 'text-muted-foreground'}`} />
        <span className="text-xs font-semibold uppercase text-muted-foreground">{label}</span>
        {exists ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 ml-auto" />
        ) : (
          <Clock className="w-3.5 h-3.5 text-muted-foreground ml-auto" />
        )}
      </div>
      {exists ? (
        <div>
          <p className="text-sm font-bold tabular-nums">R {totalValue.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</p>
          {variancePct > 0 && (
            <p className={`text-[10px] font-medium mt-0.5 ${variancePct > 2 ? 'text-amber-600' : 'text-green-600'}`}>
              {variancePct > 2 ? `⚠ ${variancePct.toFixed(1)}% variance` : `✓ ${variancePct.toFixed(1)}% variance`}
            </p>
          )}
          <div className="mt-1.5 space-y-0.5">
            {items.map((item, idx) => (
              <p key={idx} className="text-[11px] text-muted-foreground truncate">
                {item.number} — {item.status}
              </p>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">Not yet received</p>
      )}
    </div>
  );
}

export default function ThreeWayMatchRow({ match }) {
  const [expanded, setExpanded] = useState(false);
  const { po, grns, draftGRNs, invoices, poTotal, grnTotal, invTotal, grnVariancePct, invVariancePct, hasGRN, hasInvoice, matchStatus } = match;
  const config = STATUS_CONFIG[matchStatus];
  const StatusIcon = config.icon;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors"
      >
        <StatusIcon className={`w-5 h-5 shrink-0 ${matchStatus === 'fully_matched' ? 'text-green-500' : matchStatus === 'variance' ? 'text-amber-500' : 'text-muted-foreground'}`} />
        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono font-semibold">{po.po_number}</span>
            <Badge className={`text-[10px] ${config.color}`}>{config.label}</Badge>
          </div>
          <p className="text-xs text-muted-foreground truncate">{po.supplier_name} · {po.order_date || '—'}</p>
        </div>
        <div className="text-right shrink-0 mr-2">
          <p className="text-sm font-bold tabular-nums">R {poTotal.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</p>
          <div className="flex items-center gap-1.5 justify-end mt-0.5">
            <span className={`w-2 h-2 rounded-full ${hasGRN ? 'bg-green-500' : 'bg-gray-300'}`} title={hasGRN ? 'GRN ✓' : 'GRN missing'} />
            <span className={`w-2 h-2 rounded-full ${hasInvoice ? 'bg-green-500' : 'bg-gray-300'}`} title={hasInvoice ? 'Invoice ✓' : 'Invoice missing'} />
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-4 space-y-3">
          {/* Three columns for PO / GRN / Invoice */}
          <div className="flex gap-3 flex-wrap">
            <DocCard
              icon={Receipt}
              label="Purchase Order"
              exists={true}
              totalValue={poTotal}
              variancePct={0}
              items={[{ number: po.po_number, status: po.status }]}
            />
            <DocCard
              icon={Truck}
              label="Goods Received"
              exists={hasGRN}
              totalValue={grnTotal}
              variancePct={grnVariancePct}
              items={grns.map(g => ({ number: g.grn_number, status: g.status }))}
            />
            <DocCard
              icon={FileText}
              label="Invoice"
              exists={hasInvoice}
              totalValue={invTotal}
              variancePct={invVariancePct}
              items={invoices.map(i => ({ number: i.invoice_number, status: i.status }))}
            />
          </div>

          {/* Draft GRNs note */}
          {draftGRNs.length > 0 && (
            <p className="text-xs text-amber-600 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {draftGRNs.length} draft GRN{draftGRNs.length !== 1 ? 's' : ''} pending confirmation
            </p>
          )}

          {/* Quick links */}
          <div className="flex gap-2 flex-wrap pt-1">
            <Link to="/purchasing/orders" className="text-xs text-primary hover:underline flex items-center gap-1">
              <ExternalLink className="w-3 h-3" /> View PO
            </Link>
            {hasGRN && (
              <Link to="/purchasing/grn" className="text-xs text-primary hover:underline flex items-center gap-1">
                <ExternalLink className="w-3 h-3" /> View GRN
              </Link>
            )}
            {hasInvoice && (
              <Link to="/purchasing/invoices" className="text-xs text-primary hover:underline flex items-center gap-1">
                <ExternalLink className="w-3 h-3" /> View Invoice
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}