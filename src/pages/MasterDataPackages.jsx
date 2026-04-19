import React from 'react';
import PackageProductsTab from '@/components/master-data/PackageProductsTab';

export default function MasterDataPackages() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Package Products</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage package product definitions</p>
      </div>
      <PackageProductsTab />
    </div>
  );
}