import React from 'react';
import MealsTab from '@/components/master-data/MealsTab';

export default function MasterDataMeals() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Meals</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage meal definitions and activation status</p>
      </div>
      <MealsTab />
    </div>
  );
}