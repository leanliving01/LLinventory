import React from 'react';
import ParLevelsTab from '@/components/master-data/ParLevelsTab';

export default function MasterDataParLevels() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Par Levels</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Set minimum stock thresholds for each SKU</p>
      </div>
      <ParLevelsTab />
    </div>
  );
}