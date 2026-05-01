import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { format, differenceInDays } from 'date-fns';
import { Truck, Receipt, FileText, PackageCheck, AlertTriangle, TrendingUp, CheckCircle2, Clock, DollarSign, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import PageHelp from '@/components/help/PageHelp';
import PurchasingKPIStrip from '@/components/purchasing/PurchasingKPIStrip';
import PurchasingActivityFeed from '@/components/purchasing/PurchasingActivityFeed';
import PurchasingAgingChart from '@/components/purchasing/PurchasingAgingChart';

const HELP_ITEMS = [
  { title: 'Purchasing overview', text: 'This dashboard aggregates all procurement data — open POs, pending GRNs, unmatched invoices, shortages, price movements — into a single command center.' },
  { title: 'KPI cards', text: 'Each card shows a real-time count. Click the link below any card to navigate to the relevant detail page.' },
  { title: 'Aging & activity', text: 'The aging chart shows how long POs have been open. The activity feed shows recent receiving and invoice events.' },
];

export default function PurchasingDashboard() {
  const qOpts = { staleTime: 60000 };

  const { data: pos = [] } = useQuery({
    queryKey: ['pdash-pos'],
    queryFn: () => base44.entities.PurchaseOrder.list('-created_date', 2000),
    ...qOpts,
  });

  const { data: grns = [] } = useQuery({
    queryKey: ['pdash-grns'],
    queryFn: () => base44.entities.GoodsReceivedNote.list('-received_date', 500),
    ...qOpts,
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['pdash-invoices'],
    queryFn: () => base44.entities.PurchaseInvoice.list('-invoice_date', 500),
    ...qOpts,
  });

  const { data: shortages = [] } = useQuery({
    queryKey: ['pdash-shortages'],
    queryFn: () => base44.entities.SupplierShortage.filter({ status: 'open' }, '-created_date', 200),
    ...qOpts,
  });

  const { data: priceHistory = [] } = useQuery({
    queryKey: ['pdash-prices'],
    queryFn: () => base44.entities.SupplierPriceHistory.list('-created_date', 100),
    ...qOpts,
  });

  const { data: returns = [] } = useQuery({
    queryKey: ['pdash-returns'],
    queryFn: () => base44.entities.SupplierReturn.filter({ status: 'pending_return' }, '-created_date', 100),
    ...qOpts,
  });

  // Compute KPIs
  const kpis = useMemo(() => {
    const now = new Date();

    const openPOs = pos.filter(po => ['draft', 'confirmed', 'partially_received'].includes(po.status));
    const openPOValue = openPOs.reduce((s, po) => s + (po.total || 0), 0);

    const overduePOs = openPOs.filter(po => po.expected_date && new Date(po.expected_date) < now);

    const draftGRNs = grns.filter(g => g.status === 'draft');

    const unmatchedInvoices = invoices.filter(i => i.status === 'pending_match');
    const unmatchedLineCount = invoices.reduce((s, i) => s + (i.unmatched_line_count || 0), 0);

    const openShortageValue = shortages.reduce((s, sh) => s + (sh.shortage_value || 0), 0);

    const recentPriceIncreases = priceHistory.filter(h => (h.change_pct || 0) > 0).length;
    const flaggedPriceChanges = priceHistory.filter(h => Math.abs(h.change_pct || 0) > 10).length;

    const pendingReturns = returns.length;
    const pendingReturnValue = returns.reduce((s, r) => s + (r.total_return_value || 0), 0);

    // 3-way match summary
    const receivedPOs = pos.filter(po => !['cancelled', 'draft'].includes(po.status));
    const fullyMatched = receivedPOs.filter(po => {
      const hasGRN = grns.some(g => g.purchase_order_id === po.id && g.status === 'confirmed');
      const hasInv = invoices.some(i => i.purchase_order_id === po.id);
      return hasGRN && hasInv;
    }).length;

    return {
      openPOCount: openPOs.length,
      openPOValue,
      overduePOCount: overduePOs.length,
      draftGRNCount: draftGRNs.length,
      unmatchedInvoiceCount: unmatchedInvoices.length,
      unmatchedLineCount,
      openShortageCount: shortages.length,
      openShortageValue,
      recentPriceIncreases,
      flaggedPriceChanges,
      pendingReturns,
      pendingReturnValue,
      fullyMatchedCount: fullyMatched,
      totalActivePOs: receivedPOs.length,
    };
  }, [pos, grns, invoices, shortages, priceHistory, returns]);

  // Aging buckets
  const agingData = useMemo(() => {
    const now = new Date();
    const buckets = { '0-7d': 0, '8-14d': 0, '15-30d': 0, '31-60d': 0, '60d+': 0 };
    pos.filter(po => ['confirmed', 'partially_received'].includes(po.status)).forEach(po => {
      const days = differenceInDays(now, new Date(po.order_date || po.created_date));
      if (days <= 7) buckets['0-7d']++;
      else if (days <= 14) buckets['8-14d']++;
      else if (days <= 30) buckets['15-30d']++;
      else if (days <= 60) buckets['31-60d']++;
      else buckets['60d+']++;
    });
    return Object.entries(buckets).map(([name, count]) => ({ name, count }));
  }, [pos]);

  // Recent activity
  const recentActivity = useMemo(() => {
    const events = [];
    grns.filter(g => g.status === 'confirmed').slice(0, 10).forEach(g => {
      events.push({
        type: 'grn',
        date: g.received_date || g.created_date,
        text: `${g.grn_number} confirmed — R ${(g.total_received_value || 0).toFixed(0)} from ${g.supplier_name}`,
        icon: PackageCheck,
      });
    });
    invoices.slice(0, 10).forEach(inv => {
      events.push({
        type: 'invoice',
        date: inv.invoice_date || inv.created_date,
        text: `${inv.invoice_number} — R ${(inv.total || 0).toFixed(0)} from ${inv.supplier_name} (${inv.status})`,
        icon: FileText,
      });
    });
    priceHistory.slice(0, 5).forEach(h => {
      events.push({
        type: 'price',
        date: h.effective_date || h.created_date,
        text: `${h.product_name}: R${(h.previous_price || 0).toFixed(2)} → R${(h.price || 0).toFixed(2)} (${(h.change_pct || 0) > 0 ? '+' : ''}${(h.change_pct || 0).toFixed(1)}%)`,
        icon: TrendingUp,
      });
    });
    return events.sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 15);
  }, [grns, invoices, priceHistory]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Truck className="w-6 h-6 text-primary" /> Purchasing Command Center
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Procurement overview — {format(new Date(), 'd MMM yyyy')}
        </p>
      </div>

      <PageHelp items={HELP_ITEMS} />

      <PurchasingKPIStrip kpis={kpis} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PurchasingAgingChart data={agingData} />
        <PurchasingActivityFeed events={recentActivity} />
      </div>
    </div>
  );
}