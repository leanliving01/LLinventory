import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import MealsTab from '../components/master-data/MealsTab';
import SKUsTab from '../components/master-data/SKUsTab';
import ParLevelsTab from '../components/master-data/ParLevelsTab';
import PackageProductsTab from '../components/master-data/PackageProductsTab';
import BOMTab from '../components/master-data/BOMTab';

export default function MasterData() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Master Data</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage meals, SKUs, packages, par levels, and bill of materials</p>
      </div>

      <Tabs defaultValue="meals" className="space-y-4">
        <TabsList className="bg-muted">
          <TabsTrigger value="meals">Meals</TabsTrigger>
          <TabsTrigger value="skus">SKUs</TabsTrigger>
          <TabsTrigger value="par-levels">Par Levels</TabsTrigger>
          <TabsTrigger value="packages">Package Products</TabsTrigger>
          <TabsTrigger value="bom">Bill of Materials</TabsTrigger>
        </TabsList>

        <TabsContent value="meals"><MealsTab /></TabsContent>
        <TabsContent value="skus"><SKUsTab /></TabsContent>
        <TabsContent value="par-levels"><ParLevelsTab /></TabsContent>
        <TabsContent value="packages"><PackageProductsTab /></TabsContent>
        <TabsContent value="bom"><BOMTab /></TabsContent>
      </Tabs>
    </div>
  );
}