import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Package, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { PACKAGE_COLORS } from '@/lib/mealGrouping';
import { cn } from '@/lib/utils';
import PackageFamilyCard from './PackageFamilyCard';
import AddPackageForm from './AddPackageForm';

export default function BOMTab() {
  const queryClient = useQueryClient();
  const [showAddPackage, setShowAddPackage] = useState(false);
  const [syncingSkus, setSyncingSkus] = useState(false);

  const { data: packages = [], isLoading } = useQuery({
    queryKey: ['packageProducts'],
    queryFn: () => base44.entities.PackageProduct.list('-created_date', 100),
  });

  // Group packages by family
  const familyGroups = packages
    .filter(p => p.is_active !== false)
    .reduce((acc, pkg) => {
      const family = pkg.package_family;
      if (!acc[family]) acc[family] = { family, packages: [] };
      acc[family].packages.push(pkg);
      return acc;
    }, {});

  // Sort variants within each family by pack_size
  Object.values(familyGroups).forEach(group => {
    group.packages.sort((a, b) => a.pack_size - b.pack_size);
  });

  const familyOrder = ['MWL', 'MLM', 'WWL', 'WLM', 'LOW_CARB'];
  const sortedFamilies = familyOrder
    .filter(f => familyGroups[f])
    .map(f => familyGroups[f])
    .concat(
      Object.values(familyGroups).filter(g => !familyOrder.includes(g.family))
    );

  const handleSyncShopifySkus = async () => {
    setSyncingSkus(true);
    const res = await base44.functions.invoke('syncShopifyProducts', {});
    queryClient.invalidateQueries({ queryKey: ['skus'] });
    toast.success(`Synced from Shopify: ${res.data.created} new, ${res.data.updated} updated SKUs`);
    setSyncingSkus(false);
  };

  const FAMILY_NAMES = {
    MWL: "Men's Weight Loss",
    MLM: "Men's Lean Muscle",
    WWL: "Women's Weight Loss",
    WLM: "Women's Lean Muscle",
    LOW_CARB: "Low Carb",
    BYO: "Build Your Own",
  };

  if (isLoading) {
    return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => setShowAddPackage(true)} className="gap-2">
          <Plus className="w-3.5 h-3.5" />
          Add Package
        </Button>
        <Button variant="outline" size="sm" onClick={handleSyncShopifySkus} disabled={syncingSkus} className="gap-2">
          <RefreshCw className={cn("w-3.5 h-3.5", syncingSkus && "animate-spin")} />
          {syncingSkus ? 'Syncing...' : 'Sync SKUs from Shopify'}
        </Button>
      </div>

      {showAddPackage && (
        <AddPackageForm onClose={() => setShowAddPackage(false)} />
      )}

      {sortedFamilies.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <Package className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No packages found. Add a package to get started.</p>
        </div>
      ) : (
        sortedFamilies.map(group => (
          <PackageFamilyCard
            key={group.family}
            familyName={FAMILY_NAMES[group.family] || group.family}
            familyCode={group.family}
            variants={group.packages}
            colors={PACKAGE_COLORS[group.family] || PACKAGE_COLORS.MWL}
          />
        ))
      )}
    </div>
  );
}