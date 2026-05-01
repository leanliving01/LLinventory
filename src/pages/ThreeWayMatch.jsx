import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Search, X, CheckCircle2, AlertTriangle, Clock, FileText, Truck, Receipt, ChevronDown, ChevronUp } from 'lucide-react';
import PageHelp from '@/components/help/PageHelp';
import ThreeWayMatchRow from '@/components/purchasing/ThreeWayMatchRow';

const HELP_ITEMS = [
  { title: 'What is 3-way matching?', text: 'Every purchase should have a Purchase Order (what you ordered), a GRN (what arrived), and an Invoice (what you were charged). This page shows each PO and its match status across all three documents.' },
  { title: 'Match status', text: 'Fully matched = PO + GRN + Invoice all present and values align within 2%. Partial = some documents missing. Variance = values differ by more than 2%.' },
  { title: 'Actions', text: 'Click any row to expand and see the breakdown. From there you can navigate to the PO, GRN, or Invoice detail.' },
];

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'fully_matched', label: 'Fully Matched' },
  { key: 'partial', label: 'Partial Match' },
  { key: 'variance', label: 'Variance' },
  { key: 'no_grn', label: 'Missing GRN' },
  { key: 'no_invoice', label: 'Missing Invoice' },
];

export default function ThreeWayMatch() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  // Fetch all POs (excluding cancelled/draft)
  const { data: pos = [], isLoading: loadingPOs } = useQuery({
    queryKey: ['3way-pos'],
    queryFn: () => base44.entities.PurchaseOrder.list('-order_date', 2000),
  });

  const { data: grns = [] } = useQuery({
    queryKey: ['3way-grns'],
    queryFn: () => base44.entities.GoodsReceivedNote.list('-received_date', 2000),
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['3way-invoices'],
    queryFn: () => base44.entities.PurchaseInvoice.list('-invoice_date', 2000),
  });

  // Build reconciliation data keyed by PO
  const matchData = useMemo(() => {
    // Index GRNs by PO id
    const grnByPO = {};
    grns.forEach(g => {
      if (g.purchase_order_id) {
        if (!grnByPO[g.purchase_order_id]) grnByPO[g.purchase_order_id] = [];
        grnByPO[g.purchase_order_id].push(g);
      }
    });

    // Index invoices by PO id
    const invByPO = {};
    invoices.forEach(inv => {
      if (inv.purchase_order_id) {
        if (!invByPO[inv.purchase_order_id]) invByPO[inv.purchase_order_id] = [];
        invByPO[inv.purchase_order_id].push(inv);
      }
    });

    return pos
      .filter(po => !['cancelled', 'draft'].includes(po.status))
      .map(po => {
        const poGRNs = grnByPO[po.id] || [];
        const poInvs = invByPO[po.id] || [];
        const confirmedGRNs = poGRNs.filter(g => g.status === 'confirmed');

        const poTotal = po.total || 0;
        const grnTotal = confirmedGRNs.reduce((s, g) => s + (g.total_received_value || 0), 0);
        const invTotal = poInvs.reduce((s, i) => s + (i.total || 0), 0);

        const hasGRN = confirmedGRNs.length > 0;
        const hasInvoice = poInvs.length > 0;
        
        // Check value variance (2% tolerance)
        const grnVariancePct = poTotal > 0 && hasGRN ? Math.abs((grnTotal - poTotal) / poTotal) * 100 : 0;
        const invVariancePct = poTotal > 0 && hasInvoice ? Math.abs((invTotal - poTotal) / poTotal) * 100 : 0;
        const hasVariance = (hasGRN && grnVariancePct > 2) || (hasInvoice && invVariancePct > 2);

        let matchStatus;
        if (hasGRN && hasInvoice && !hasVariance) {
          matchStatus = 'fully_matched';
        } else if (hasVariance) {
          matchStatus = 'variance';
        } else if (!hasGRN) {
          matchStatus = 'no_grn';
        } else if (!hasInvoice) {
          matchStatus = 'no_invoice';
        } else {
          matchStatus = 'partial';
        }

        return {
          po,
          grns: confirmedGRNs,
          draftGRNs: poGRNs.filter(g => g.status === 'draft'),
          invoices: poInvs,
          poTotal,
          grnTotal,
          invTotal,
          grnVariancePct,
          invVariancePct,
          hasGRN,
          hasInvoice,
          hasVariance,
          matchStatus,
        };
      });
  }, [pos, grns, invoices]);

  // Filter
  const filtered = useMemo(() => {
    return matchData.filter(m => {
      if (filter !== 'all' && m.matchStatus !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(m.po.po_number || '').toLowerCase().includes(q) &&
            !(m.po.supplier_name || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [matchData, filter, search]);

  // Stats
  const stats = useMemo(() => {
    const s = { fully_matched: 0, partial: 0, variance: 0, no_grn: 0, no_invoice: 0 };
    matchData.forEach(m => { s[m.matchStatus] = (s[m.matchStatus] || 0) + 1; });
    return s;
  }, [matchData]);

  const isLoading = loadingPOs;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CheckCircle2 className="w-6 h-6 text-primary" /> Three-Way Matching
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          PO ↔ GRN ↔ Invoice reconciliation
        </p>
      </div>

      <PageHelp items={HELP_ITEMS} />

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-card border border-border rounded-xl px-4 py-3">
          <p className="text-[10px] text-green-600 uppercase font-semibold">Fully Matched</p>
          <p className="text-lg font-bold text-green-600">{stats.fully_matched}</p>
        </div>
        <div className="bg-card border border-border rounded-xl px-4 py-3">
          <p className="text-[10px] text-amber-600 uppercase font-semibold">Variance</p>
          <p className="text-lg font-bold text-amber-600">{stats.variance}</p>
        </div>
        <div className="bg-card border border-border rounded-xl px-4 py-3">
          <p className="text-[10px] text-blue-600 uppercase font-semibold">Missing GRN</p>
          <p className="text-lg font-bold text-blue-600">{stats.no_grn}</p>
        </div>
        <div className="bg-card border border-border rounded-xl px-4 py-3">
          <p className="text-[10px] text-purple-600 uppercase font-semibold">Missing Invoice</p>
          <p className="text-lg font-bold text-purple-600">{stats.no_invoice}</p>
        </div>
        <div className="bg-card border border-border rounded-xl px-4 py-3">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Total POs</p>
          <p className="text-lg font-bold">{matchData.length}</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {STATUS_FILTERS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
              filter === tab.key
                ? 'bg-primary/10 text-primary ring-2 ring-primary/30'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {tab.label} {tab.key !== 'all' ? `(${stats[tab.key] || 0})` : ''}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search PO # or supplier..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch('')} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading reconciliation data...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          {matchData.length === 0 ? 'No confirmed purchase orders to reconcile.' : 'No results match your filter.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.slice(0, 50).map(match => (
            <ThreeWayMatchRow key={match.po.id} match={match} />
          ))}
          {filtered.length > 50 && (
            <p className="text-xs text-muted-foreground text-center py-2">
              Showing 50 of {filtered.length} — use search to narrow
            </p>
          )}
        </div>
      )}
    </div>
  );
}