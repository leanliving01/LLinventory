import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Award, Search, X } from 'lucide-react';
import PageHelp from '@/components/help/PageHelp';
import SupplierScoreKPIStrip from '@/components/supplier-scorecard/SupplierScoreKPIStrip';
import SupplierScoreTable from '@/components/supplier-scorecard/SupplierScoreTable';
import SupplierScoreDetail from '@/components/supplier-scorecard/SupplierScoreDetail';

const HELP_ITEMS = [
  { title: 'Overall score', text: 'Each supplier gets a weighted score: Delivery 30% + Quality 25% + Price Stability 25% + Shortage 20%. Scores range 0–100.' },
  { title: 'Delivery', text: 'Compares PO expected_date vs GRN received_date. On-time or early = full marks. Late POs reduce the score.' },
  { title: 'Quality', text: 'Based on GRN line rejection rates. 0% rejected = 100 score. Higher rejection % lowers the score.' },
  { title: 'Price stability', text: 'Tracks how often prices change by >10%. Fewer flagged changes = higher score.' },
];

export default function SupplierScorecard() {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const qOpts = { staleTime: 60000 };

  const { data: suppliers = [] } = useQuery({
    queryKey: ['sc-suppliers'],
    queryFn: () => base44.entities.Supplier.filter({ status: 'active' }, 'name', 200),
    ...qOpts,
  });

  const { data: pos = [] } = useQuery({
    queryKey: ['sc-pos'],
    queryFn: () => base44.entities.PurchaseOrder.list('-created_date', 2000),
    ...qOpts,
  });

  const { data: grns = [] } = useQuery({
    queryKey: ['sc-grns'],
    queryFn: () => base44.entities.GoodsReceivedNote.list('-received_date', 1000),
    ...qOpts,
  });

  const { data: grnLines = [] } = useQuery({
    queryKey: ['sc-grn-lines'],
    queryFn: () => base44.entities.GRNLine.list('-created_date', 5000),
    ...qOpts,
  });

  const { data: shortages = [] } = useQuery({
    queryKey: ['sc-shortages'],
    queryFn: () => base44.entities.SupplierShortage.list('-created_date', 1000),
    ...qOpts,
  });

  const { data: priceHistory = [] } = useQuery({
    queryKey: ['sc-prices'],
    queryFn: () => base44.entities.SupplierPriceHistory.list('-created_date', 2000),
    ...qOpts,
  });

  // Build GRN lookup by ID
  const grnMap = useMemo(() => {
    const m = {};
    grns.forEach(g => { m[g.id] = g; });
    return m;
  }, [grns]);

  // Compute scorecards
  const scorecards = useMemo(() => {
    return suppliers.map(supplier => {
      const sid = supplier.id;

      // --- Delivery score ---
      const supplierPOs = pos.filter(po => po.supplier_id === sid && !['cancelled', 'draft'].includes(po.status));
      const supplierGRNs = grns.filter(g => g.supplier_id === sid && g.status === 'confirmed');
      const totalPOs = supplierPOs.length;

      let onTimePOs = 0;
      let latePOs = 0;
      supplierPOs.forEach(po => {
        if (!po.expected_date) { onTimePOs++; return; }
        const grn = supplierGRNs.find(g => g.purchase_order_id === po.id);
        if (!grn) return; // not yet received
        const expected = new Date(po.expected_date);
        const received = new Date(grn.received_date);
        if (received <= new Date(expected.getTime() + 86400000)) { onTimePOs++; } // 1 day grace
        else { latePOs++; }
      });
      const deliveredPOs = onTimePOs + latePOs;
      const deliveryScore = deliveredPOs > 0 ? Math.round((onTimePOs / deliveredPOs) * 100) : 100;

      // --- Quality score ---
      const supplierGRNIds = new Set(supplierGRNs.map(g => g.id));
      const supplierLines = grnLines.filter(l => supplierGRNIds.has(l.grn_id));
      const totalLines = supplierLines.length;
      const rejectedLines = supplierLines.filter(l => l.condition === 'rejected' || l.condition === 'damaged').length;
      const qualityScore = totalLines > 0 ? Math.round(((totalLines - rejectedLines) / totalLines) * 100) : 100;

      // --- Price stability score ---
      const supplierPrices = priceHistory.filter(h => {
        // Match by supplier name (denormalized)
        return (h.supplier_name || '').toLowerCase() === (supplier.name || '').toLowerCase();
      });
      const flaggedPrices = supplierPrices.filter(h => Math.abs(h.change_pct || 0) > 10).length;
      const totalPriceChanges = supplierPrices.length;
      const priceScore = totalPriceChanges > 0 ? Math.round(((totalPriceChanges - flaggedPrices) / totalPriceChanges) * 100) : 100;

      // --- Shortage score ---
      const supplierShortages = shortages.filter(s => s.supplier_id === sid);
      const openShortages = supplierShortages.filter(s => s.status === 'open').length;
      const totalShortages = supplierShortages.length;
      // Score: penalize open shortages relative to total POs
      const shortageRate = totalPOs > 0 ? totalShortages / totalPOs : 0;
      const shortageScore = Math.max(0, Math.round((1 - shortageRate) * 100));

      // --- Overall weighted score ---
      const overall = Math.round(
        deliveryScore * 0.30 +
        qualityScore * 0.25 +
        priceScore * 0.25 +
        shortageScore * 0.20
      );

      return {
        supplierId: sid,
        name: supplier.name,
        overall,
        deliveryScore,
        qualityScore,
        priceScore,
        shortageScore,
        totalPOs,
        deliveredPOs,
        onTimePOs,
        latePOs,
        totalGRNs: supplierGRNs.length,
        totalLines,
        rejectedLines,
        totalPriceChanges,
        flaggedPrices,
        totalShortages,
        openShortages,
        outstandingBalance: supplier.outstanding_balance || 0,
      };
    }).sort((a, b) => b.overall - a.overall);
  }, [suppliers, pos, grns, grnLines, shortages, priceHistory]);

  // KPI summary
  const kpis = useMemo(() => {
    const count = scorecards.length;
    const avgScore = count > 0 ? Math.round(scorecards.reduce((s, c) => s + c.overall, 0) / count) : 0;
    const topPerformers = scorecards.filter(s => s.overall >= 80).length;
    const atRisk = scorecards.filter(s => s.overall < 60).length;
    return { count, avgScore, topPerformers, atRisk };
  }, [scorecards]);

  const filtered = useMemo(() => {
    if (!search) return scorecards;
    const q = search.toLowerCase();
    return scorecards.filter(s => s.name.toLowerCase().includes(q));
  }, [scorecards, search]);

  const selectedCard = selectedId ? scorecards.find(s => s.supplierId === selectedId) : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Award className="w-6 h-6 text-primary" /> Supplier Scorecard
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Performance rating across delivery, quality, pricing & shortages
        </p>
      </div>

      <PageHelp items={HELP_ITEMS} />

      <SupplierScoreKPIStrip kpis={kpis} />

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search supplier..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch('')} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      <SupplierScoreTable items={filtered} onSelect={setSelectedId} selectedId={selectedId} />

      {selectedCard && (
        <SupplierScoreDetail card={selectedCard} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}