import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ShoppingCart, DollarSign, Package, Factory, Trash2, Calculator, ScrollText, ClipboardCheck } from 'lucide-react';
import HelpDrawer from '@/components/help/HelpDrawer';

import PurchaseReport from '@/components/reports/PurchaseReport';
import SalesReport from '@/components/reports/SalesReport';
import InventoryReport from '@/components/reports/InventoryReport';
import ProductionReport from '@/components/reports/ProductionReport';
import WastageReport from '@/components/reports/WastageReport';
import FoodCostReport from '@/components/reports/FoodCostReport';
import AuditTrailReport from '@/components/reports/AuditTrailReport';
import QualityCheckReport from '@/components/reports/QualityCheckReport';

const TABS = [
  { id: 'purchase', label: 'Purchase', icon: ShoppingCart },
  { id: 'sales', label: 'Sales', icon: DollarSign },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'production', label: 'Production', icon: Factory },
  { id: 'qc', label: 'Quality Check', icon: ClipboardCheck },
  { id: 'wastage', label: 'Wastage', icon: Trash2 },
  { id: 'food-cost', label: 'Food Cost', icon: Calculator },
  { id: 'audit', label: 'Audit Trail', icon: ScrollText },
];

export default function Reports() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reports</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Purchase, Sales, Inventory, Production, Quality Check, Wastage, Food Cost & Audit</p>
        </div>
        <HelpDrawer pageKey="reports" />
      </div>

      <Tabs defaultValue="purchase" className="space-y-4">
        <TabsList className="h-auto flex-wrap gap-1 bg-muted/50 p-1 rounded-lg">
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <TabsTrigger key={tab.id} value={tab.id} className="gap-1.5 text-xs data-[state=active]:bg-card data-[state=active]:shadow-sm px-3 py-2">
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="purchase"><PurchaseReport /></TabsContent>
        <TabsContent value="sales"><SalesReport /></TabsContent>
        <TabsContent value="inventory"><InventoryReport /></TabsContent>
        <TabsContent value="production"><ProductionReport /></TabsContent>
        <TabsContent value="qc"><QualityCheckReport /></TabsContent>
        <TabsContent value="wastage"><WastageReport /></TabsContent>
        <TabsContent value="food-cost"><FoodCostReport /></TabsContent>
        <TabsContent value="audit"><AuditTrailReport /></TabsContent>
      </Tabs>
    </div>
  );
}