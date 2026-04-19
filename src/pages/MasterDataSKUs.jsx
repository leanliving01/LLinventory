import React from 'react';
import SKUsTab from '@/components/master-data/SKUsTab';

export default function MasterDataSKUs() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">SKUs</h1>
        <p className="text-sm text-muted-foreground mt-0.5">View and manage SKU codes by meal</p>
      </div>
      <SKUsTab />
    </div>
  );
}