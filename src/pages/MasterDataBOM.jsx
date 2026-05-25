import React from 'react';
import BOMTab from '@/components/master-data/BOMTab';

export default function MasterDataBOM() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Bill of Materials</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Configure which SKUs make up each package</p>
      </div>
      <BOMTab />
    </div>
  );
}