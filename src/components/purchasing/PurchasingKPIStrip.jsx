import React from 'react';
import { Link } from 'react-router-dom';
import { Receipt, PackageCheck, FileText, AlertTriangle, TrendingUp, ArrowLeftRight, CheckCircle2, Clock } from 'lucide-react';

function KPICard({ icon: Icon, label, value, subValue, color, linkTo, linkLabel }) {
  return (
    <div className="bg-card border border-border rounded-xl px-4 py-3.5 flex flex-col">
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">{label}</span>
      </div>
      <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      {subValue && <p className="text-[11px] text-muted-foreground mt-0.5">{subValue}</p>}
      {linkTo && (
        <Link to={linkTo} className="text-[11px] text-primary hover:underline mt-auto pt-2 flex items-center gap-1">
          {linkLabel || 'View →'}
        </Link>
      )}
    </div>
  );
}

export default function PurchasingKPIStrip({ kpis }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      <KPICard
        icon={Receipt}
        label="Open POs"
        value={kpis.openPOCount}
        subValue={`R ${(kpis.openPOValue || 0).toLocaleString('en-ZA', { minimumFractionDigits: 0 })} outstanding`}
        color="text-blue-600"
        linkTo="/purchasing/orders"
        linkLabel="Purchase Orders →"
      />
      <KPICard
        icon={Clock}
        label="Overdue POs"
        value={kpis.overduePOCount}
        subValue={kpis.overduePOCount > 0 ? 'Past expected delivery' : 'All on schedule'}
        color={kpis.overduePOCount > 0 ? 'text-red-600' : 'text-green-600'}
        linkTo="/purchasing/orders"
        linkLabel="View overdue →"
      />
      <KPICard
        icon={PackageCheck}
        label="Draft GRNs"
        value={kpis.draftGRNCount}
        subValue="Awaiting confirmation"
        color={kpis.draftGRNCount > 0 ? 'text-amber-600' : 'text-green-600'}
        linkTo="/purchasing/grn"
        linkLabel="Goods Received →"
      />
      <KPICard
        icon={FileText}
        label="Unmatched Invoices"
        value={kpis.unmatchedInvoiceCount}
        subValue={kpis.unmatchedLineCount > 0 ? `${kpis.unmatchedLineCount} lines to match` : 'All matched'}
        color={kpis.unmatchedInvoiceCount > 0 ? 'text-purple-600' : 'text-green-600'}
        linkTo="/purchasing/invoices"
        linkLabel="Invoices →"
      />
      <KPICard
        icon={AlertTriangle}
        label="Open Shortages"
        value={kpis.openShortageCount}
        subValue={`R ${(kpis.openShortageValue || 0).toLocaleString('en-ZA', { minimumFractionDigits: 0 })} value`}
        color={kpis.openShortageCount > 0 ? 'text-amber-600' : 'text-green-600'}
        linkTo="/purchasing/shortages"
        linkLabel="Shortages →"
      />
      <KPICard
        icon={TrendingUp}
        label="Price Alerts"
        value={kpis.flaggedPriceChanges}
        subValue={`${kpis.recentPriceIncreases} increases in last 100`}
        color={kpis.flaggedPriceChanges > 0 ? 'text-red-600' : 'text-green-600'}
        linkTo="/purchasing/price-variance"
        linkLabel="Price Variance →"
      />
      <KPICard
        icon={ArrowLeftRight}
        label="Pending Returns"
        value={kpis.pendingReturns}
        subValue={kpis.pendingReturns > 0 ? `R ${(kpis.pendingReturnValue || 0).toLocaleString('en-ZA', { minimumFractionDigits: 0 })}` : 'None pending'}
        color={kpis.pendingReturns > 0 ? 'text-amber-600' : 'text-green-600'}
        linkTo="/purchasing/returns"
        linkLabel="Returns →"
      />
      <KPICard
        icon={CheckCircle2}
        label="3-Way Matched"
        value={`${kpis.fullyMatchedCount}/${kpis.totalActivePOs}`}
        subValue="PO + GRN + Invoice"
        color="text-green-600"
        linkTo="/purchasing/three-way-match"
        linkLabel="Reconciliation →"
      />
    </div>
  );
}