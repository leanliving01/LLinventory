import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link, useNavigate } from 'react-router-dom';
import { format, differenceInDays, isBefore, parseISO, startOfToday } from 'date-fns';
import { Truck, Receipt, FileText, AlertTriangle, TrendingUp, CheckCircle2, Clock, DollarSign, ArrowRight, Plus, RefreshCw, ArrowLeftRight, Upload, PackageCheck } from 'lucide-react';
import SyncHealthIndicator from '@/components/shared/SyncHealthIndicator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import PageHelp from '@/components/help/PageHelp';
import PurchasingKPIStrip from '@/components/purchasing/PurchasingKPIStrip';
import PurchasingActivityFeed from '@/components/purchasing/PurchasingActivityFeed';
import PurchasingAgingChart from '@/components/purchasing/PurchasingAgingChart';
import InvoiceScanDialog from '@/components/purchasing/InvoiceScanDialog';
import ScanDraftsBanner from '@/components/purchasing/ScanDraftsBanner';
import PaymentsDueWidget from '@/components/purchasing/PaymentsDueWidget';
import { toast } from 'sonner';

const HELP_ITEMS = [
  { title: 'Purchasing overview', text: 'This dashboard aggregates all procurement data — open POs, pending GRNs, unmatched invoices, shortages, price movements — into a single command center.' },
  { title: 'KPI cards', text: 'Each card shows a real-time count. Click the link below any card to navigate to the relevant detail page.' },
  { title: 'Aging & activity', text: 'The aging chart shows how long POs have been open. The activity feed shows recent receiving and invoice events.' },
];

export default function PurchasingDashboard() {
  const qOpts = { staleTime: 60000 };
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [showInvoiceScan, setShowInvoiceScan] = useState(false);
  const [resumeDraft, setResumeDraft] = useState(null);
  const [syncingXero, setSyncingXero] = useState(false);

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

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-active'],
    queryFn: () => base44.entities.Supplier.filter({ status: 'active' }, 'name', 200),
    ...qOpts,
  });

  // Compute KPIs
  const kpis = useMemo(() => {
    const openPOs = pos.filter(po => ['draft', 'awaiting_approval', 'approved', 'partially_received'].includes(po.status));
    const openPOValue = openPOs.reduce((s, po) => s + (po.total || 0), 0);

    const overduePOs = openPOs.filter(po => po.expected_date && isBefore(parseISO(po.expected_date), startOfToday()));

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
      const grnsForPO = grns.filter(g => g.purchase_order_id === po.id && g.status === 'confirmed');
      const invoicesForPO = invoices.filter(i => i.purchase_order_id === po.id);
      const hasGRN = grnsForPO.length > 0;
      const hasInvoice = invoicesForPO.length > 0;
      const grnTotal = grnsForPO.reduce((sum, g) => sum + (g.total_received_value || 0), 0);
      const variance = po.total > 0 ? Math.abs(grnTotal - po.total) / po.total : 0;
      return hasGRN && hasInvoice && variance <= 0.02;
    }).length;

    const today = new Date().toISOString().slice(0, 10);
    const overdueInvoices = invoices.filter(i =>
      !['paid', 'credit_applied'].includes(i.payment_status) &&
      i.due_date_calculated && i.due_date_calculated < today
    );

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
      overdueInvoiceCount: overdueInvoices.length,
    };
  }, [pos, grns, invoices, shortages, priceHistory, returns]);

  // Aging buckets
  const agingData = useMemo(() => {
    const now = new Date();
    const buckets = { '0-7d': 0, '8-14d': 0, '15-30d': 0, '31-60d': 0, '60d+': 0 };
    pos.filter(po => ['approved', 'partially_received'].includes(po.status)).forEach(po => {
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
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Truck className="w-6 h-6 text-primary" /> Purchasing Command Center
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Procurement overview — {format(new Date(), 'd MMM yyyy')}
          </p>
        </div>
        <SyncHealthIndicator compact />
      </div>

      <PageHelp items={HELP_ITEMS} />

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => navigate('/purchasing/purchase-orders/new')} className="gap-2">
          <Plus className="w-4 h-4" /> New Purchase Order
        </Button>
        <Button variant="outline" onClick={() => setShowInvoiceScan(true)} className="gap-2">
          <Upload className="w-4 h-4" /> Upload Invoice
        </Button>
        <Button variant="outline" asChild>
          <Link to="/purchasing/grn" className="gap-2 flex items-center">
            <Truck className="w-4 h-4" /> Receive Against PO
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/purchasing/returns?new=1" className="gap-2 flex items-center">
            <ArrowLeftRight className="w-4 h-4" /> New Return
          </Link>
        </Button>
        <Button
          variant="outline"
          className="gap-2"
          disabled={syncingXero}
          onClick={async () => {
            setSyncingXero(true);
            try {
              const res = await base44.functions.invoke('syncXeroPurchaseOrders', {});
              if (res.data?.error) throw new Error(res.data.error);
              queryClient.invalidateQueries({ queryKey: ['pdash-pos'] });
              queryClient.invalidateQueries({ queryKey: ['pdash-grns'] });
              toast.success('Xero sync triggered');
            } catch (err) {
              toast.error(`Xero sync failed: ${err.message}`);
            } finally {
              setSyncingXero(false);
            }
          }}
        >
          <RefreshCw className={`w-4 h-4 ${syncingXero ? 'animate-spin' : ''}`} /> Sync from Xero
        </Button>
      </div>

      <ScanDraftsBanner onResume={(d) => { setResumeDraft(d); setShowInvoiceScan(true); }} />

      <PurchasingKPIStrip kpis={kpis} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <PurchasingAgingChart data={agingData} />
          <PurchasingActivityFeed events={recentActivity} />
        </div>
        <div>
          <PaymentsDueWidget suppliers={suppliers} />
        </div>
      </div>

      {showInvoiceScan && (
        <InvoiceScanDialog
          resumeDraft={resumeDraft}
          onSaved={() => { setShowInvoiceScan(false); setResumeDraft(null); queryClient.invalidateQueries({ queryKey: ['pdash-invoices'] }); }}
          onClose={() => { setShowInvoiceScan(false); setResumeDraft(null); }}
        />
      )}
    </div>
  );
}