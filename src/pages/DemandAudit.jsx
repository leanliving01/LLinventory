import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Eye, Play, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import DemandSummaryCards from '@/components/demand/DemandSummaryCards';
import OrderDemandTable from '@/components/demand/OrderDemandTable';
import SkuDemandTable from '@/components/demand/SkuDemandTable';
import DemandWarnings from '@/components/demand/DemandWarnings';

export default function DemandAudit() {
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [previewData, setPreviewData] = useState(null);

  const handlePreview = async () => {
    setLoading(true);
    setPreviewData(null);
    const res = await base44.functions.invoke('recalcCommittedDemand', { action: 'preview' });
    setPreviewData(res.data);
    setLoading(false);
  };

  const handleCommit = async () => {
    if (!confirm('This will recalculate committed stock from all paid & unfulfilled orders. Continue?')) return;
    setCommitting(true);
    const res = await base44.functions.invoke('recalcCommittedDemand', { action: 'commit', refresh_audit: true });
    toast.success(`Committed stock updated: ${res.data.skus_committed} SKUs from ${res.data.orders_with_demand} orders`);
    setCommitting(false);
    // Re-run preview to show committed state
    handlePreview();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Demand Audit</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Preview and recalculate committed demand from Shopify orders × BOM
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={handlePreview} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
            Preview
          </Button>
          <Button
            className="gap-2"
            onClick={handleCommit}
            disabled={committing || !previewData}
          >
            {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {committing ? 'Updating stock...' : 'Recalculate & Save'}
          </Button>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
        <strong>How it works:</strong> Scans all paid & unfulfilled orders and their decomposed line items
        (from Shopify sync). Aggregates component quantities by SKU to calculate committed stock.
        Click <strong>Preview</strong> to see the calculation, then <strong>Recalculate & Save</strong> to update StockOnHand.
      </div>

      {previewData && (
        <>
          <DemandSummaryCards
            demandByFamily={previewData.demand_by_family}
            totalOrders={previewData.total_orders}
            ordersWithDemand={previewData.orders_with_demand}
            totalRecords={previewData.total_demand_records}
          />

          <DemandWarnings warnings={previewData.warnings} />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <OrderDemandTable breakdowns={previewData.order_breakdowns} />
            <SkuDemandTable demandBySku={previewData.demand_by_sku} />
          </div>
        </>
      )}

      {!previewData && !loading && (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <Eye className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Click <strong>Preview</strong> to see the demand calculation</p>
        </div>
      )}
    </div>
  );
}