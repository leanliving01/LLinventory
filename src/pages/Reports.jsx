import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ShoppingCart, DollarSign, Package, Factory, Trash2, Calculator, ScrollText, ClipboardCheck, TrendingUp, BarChart2, Layers } from 'lucide-react';
import HelpDrawer from '@/components/help/HelpDrawer';

import PurchaseReport from '@/components/reports/PurchaseReport';
import SalesReport from '@/components/reports/SalesReport';
import InventoryReport from '@/components/reports/InventoryReport';
import ProductionReport from '@/components/reports/ProductionReport';
import WastageReport from '@/components/reports/WastageReport';
import FoodCostReport from '@/components/reports/FoodCostReport';
import AuditTrailReport from '@/components/reports/AuditTrailReport';
import QualityCheckReport from '@/components/reports/QualityCheckReport';

// New reports
import SupplierSpendAnalysisReport from '@/components/reports/SupplierSpendAnalysisReport';
import PurchasePriceVarianceReport from '@/components/reports/PurchasePriceVarianceReport';
import OutstandingPOReport from '@/components/reports/OutstandingPOReport';
import GRNvsInvoiceReconciliationReport from '@/components/reports/GRNvsInvoiceReconciliationReport';
import StockValuationReport from '@/components/reports/StockValuationReport';
import StockAgeReport from '@/components/reports/StockAgeReport';
import DeadStockReport from '@/components/reports/DeadStockReport';
import YieldEfficiencyReport from '@/components/reports/YieldEfficiencyReport';
import StationThroughputReport from '@/components/reports/StationThroughputReport';
import LabourCostEstimateReport from '@/components/reports/LabourCostEstimateReport';

const TOP_TABS = [
  { id: 'purchasing', label: 'Purchasing', icon: ShoppingCart },
  { id: 'sales', label: 'Sales', icon: DollarSign },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'production', label: 'Production', icon: Factory },
  { id: 'qc', label: 'Quality Check', icon: ClipboardCheck },
  { id: 'wastage', label: 'Wastage', icon: Trash2 },
  { id: 'food-cost', label: 'Food Cost', icon: Calculator },
  { id: 'audit', label: 'Audit Trail', icon: ScrollText },
];

const PURCHASING_SUBTABS = [
  { id: 'summary', label: 'Summary' },
  { id: 'spend', label: 'Supplier Spend' },
  { id: 'variance', label: 'Price Variance' },
  { id: 'outstanding', label: 'Outstanding POs' },
  { id: 'reconciliation', label: 'GRN vs Invoice' },
];

const INVENTORY_SUBTABS = [
  { id: 'summary', label: 'Stock Summary' },
  { id: 'valuation', label: 'Valuation' },
  { id: 'age', label: 'Stock Age' },
  { id: 'dead', label: 'Dead Stock' },
];

const PRODUCTION_SUBTABS = [
  { id: 'summary', label: 'Summary' },
  { id: 'yield', label: 'Yield Efficiency' },
  { id: 'station', label: 'Station Throughput' },
  { id: 'labour', label: 'Labour Cost' },
];

function SubTabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 border-b border-border mb-4 overflow-x-auto">
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${active === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export default function Reports() {
  const [purchasingTab, setPurchasingTab] = useState('summary');
  const [inventoryTab, setInventoryTab] = useState('summary');
  const [productionTab, setProductionTab] = useState('summary');

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reports</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Purchasing, Sales, Inventory, Production, Quality, Wastage, Food Cost & Audit</p>
        </div>
        <HelpDrawer pageKey="reports" />
      </div>

      <Tabs defaultValue="purchasing" className="space-y-4">
        <TabsList className="h-auto flex-wrap gap-1 bg-muted/50 p-1 rounded-lg">
          {TOP_TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <TabsTrigger key={tab.id} value={tab.id} className="gap-1.5 text-xs data-[state=active]:bg-card data-[state=active]:shadow-sm px-3 py-2">
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="purchasing">
          <SubTabs tabs={PURCHASING_SUBTABS} active={purchasingTab} onChange={setPurchasingTab} />
          {purchasingTab === 'summary' && <PurchaseReport />}
          {purchasingTab === 'spend' && <SupplierSpendAnalysisReport />}
          {purchasingTab === 'variance' && <PurchasePriceVarianceReport />}
          {purchasingTab === 'outstanding' && <OutstandingPOReport />}
          {purchasingTab === 'reconciliation' && <GRNvsInvoiceReconciliationReport />}
        </TabsContent>

        <TabsContent value="sales"><SalesReport /></TabsContent>

        <TabsContent value="inventory">
          <SubTabs tabs={INVENTORY_SUBTABS} active={inventoryTab} onChange={setInventoryTab} />
          {inventoryTab === 'summary' && <InventoryReport />}
          {inventoryTab === 'valuation' && <StockValuationReport />}
          {inventoryTab === 'age' && <StockAgeReport />}
          {inventoryTab === 'dead' && <DeadStockReport />}
        </TabsContent>

        <TabsContent value="production">
          <SubTabs tabs={PRODUCTION_SUBTABS} active={productionTab} onChange={setProductionTab} />
          {productionTab === 'summary' && <ProductionReport />}
          {productionTab === 'yield' && <YieldEfficiencyReport />}
          {productionTab === 'station' && <StationThroughputReport />}
          {productionTab === 'labour' && <LabourCostEstimateReport />}
        </TabsContent>

        <TabsContent value="qc"><QualityCheckReport /></TabsContent>
        <TabsContent value="wastage"><WastageReport /></TabsContent>
        <TabsContent value="food-cost"><FoodCostReport /></TabsContent>
        <TabsContent value="audit"><AuditTrailReport /></TabsContent>
      </Tabs>
    </div>
  );
}
