import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import StatCard from '../components/dashboard/StatCard';
import ShortageTable from '../components/dashboard/ShortageTable';
import { 
  Package, 
  AlertTriangle, 
  Factory, 
  Warehouse, 
  ShoppingCart,
  Clock,
  TrendingDown
} from 'lucide-react';
import { format } from 'date-fns';

export default function Dashboard() {
  const { data: skus = [] } = useQuery({
    queryKey: ['skus'],
    queryFn: () => base44.entities.SKU.list('-created_date', 100),
  });

  const { data: parLevels = [] } = useQuery({
    queryKey: ['parLevels'],
    queryFn: () => base44.entities.ParLevel.list('-created_date', 100),
  });

  const { data: stockSnapshots = [] } = useQuery({
    queryKey: ['latestStock'],
    queryFn: () => base44.entities.StockSnapshot.list('-created_date', 200),
  });

  const { data: committedDemand = [] } = useQuery({
    queryKey: ['committedDemand'],
    queryFn: () => base44.entities.CommittedDemand.list('-created_date', 500),
  });

  const { data: shopifyOrders = [] } = useQuery({
    queryKey: ['shopifyOrders'],
    queryFn: () => base44.entities.ShopifyOrder.filter({ paid_status: 'paid', fulfilment_status: 'unfulfilled' }, '-created_date', 100),
  });

  const { data: productionRuns = [] } = useQuery({
    queryKey: ['productionRuns'],
    queryFn: () => base44.entities.ProductionRun.list('-created_date', 5),
  });

  // Calculate latest stock by SKU (most recent entry per SKU)
  const latestStockBySkuId = {};
  stockSnapshots.forEach(snap => {
    if (!latestStockBySkuId[snap.sku_id] || new Date(snap.created_date) > new Date(latestStockBySkuId[snap.sku_id].created_date)) {
      latestStockBySkuId[snap.sku_id] = snap;
    }
  });

  // Par levels by SKU
  const parBySkuId = {};
  parLevels.forEach(p => { parBySkuId[p.sku_id] = p.par_level; });

  // Committed demand by SKU
  const demandBySkuId = {};
  committedDemand.forEach(d => {
    demandBySkuId[d.sku_id] = (demandBySkuId[d.sku_id] || 0) + d.quantity;
  });

  // Production calculations
  let totalStockOnHand = 0;
  let totalCommitted = 0;
  let totalToProduce = 0;
  let skusBelowPar = 0;
  const shortages = [];

  skus.forEach(sku => {
    const soh = latestStockBySkuId[sku.id]?.stock_on_hand || 0;
    const committed = demandBySkuId[sku.id] || 0;
    const par = parBySkuId[sku.id] || 0;
    const available = soh - committed;
    const needed = Math.max(0, par - available);
    const production = needed < 10 ? 0 : needed;

    totalStockOnHand += soh;
    totalCommitted += committed;
    totalToProduce += production;

    if (available < par && par > 0) {
      skusBelowPar++;
      shortages.push({
        meal_name: sku.meal_name,
        package_type: sku.package_type,
        shortage: par - available,
        sku_code: sku.sku_code,
      });
    }
  });

  shortages.sort((a, b) => b.shortage - a.shortage);

  const unfulfilled = shopifyOrders.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Production Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {format(new Date(), 'EEEE, d MMMM yyyy')}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="w-3.5 h-3.5" />
          Last updated: {format(new Date(), 'HH:mm')}
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
        <StatCard
          title="SKUs Below Par"
          value={skusBelowPar}
          icon={AlertTriangle}
          variant={skusBelowPar > 0 ? 'danger' : 'success'}
        />
        <StatCard
          title="Total Stock"
          value={totalStockOnHand.toLocaleString()}
          icon={Warehouse}
          variant="info"
        />
        <StatCard
          title="Committed"
          value={totalCommitted.toLocaleString()}
          icon={ShoppingCart}
          variant="warning"
        />
        <StatCard
          title="To Produce"
          value={totalToProduce.toLocaleString()}
          icon={Factory}
          variant={totalToProduce > 0 ? 'warning' : 'success'}
        />
        <StatCard
          title="Unfulfilled Orders"
          value={unfulfilled}
          icon={Package}
          variant="default"
        />
        <StatCard
          title="Active SKUs"
          value={skus.filter(s => s.is_active).length}
          icon={Package}
          variant="default"
        />
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ShortageTable items={shortages} />

        {/* Recent Production Runs */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">Recent Production Runs</h3>
          {productionRuns.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <Factory className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
              No production runs yet
            </div>
          ) : (
            <div className="space-y-3">
              {productionRuns.map(run => (
                <div key={run.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div>
                    <p className="text-sm font-medium">{format(new Date(run.run_date), 'dd MMM yyyy')}</p>
                    <p className="text-xs text-muted-foreground">{run.total_units_to_produce || 0} units</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                    run.status === 'finalized' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {run.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}