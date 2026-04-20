import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import AddPackageForm from './AddPackageForm';

export default function PackageProductsTab() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);

  const { data: packages = [] } = useQuery({
    queryKey: ['packageProducts'],
    queryFn: () => base44.entities.PackageProduct.list('-created_date', 50),
  });

  const familyColors = {
    MWL: 'bg-blue-100 text-blue-700',
    MLM: 'bg-green-100 text-green-700',
    WWL: 'bg-pink-100 text-pink-700',
    WLM: 'bg-orange-100 text-orange-700',
    LOW_CARB: 'bg-yellow-100 text-yellow-700',
    BYO: 'bg-amber-100 text-amber-700',
  };

  const handleToggleActive = async (pkg) => {
    const newActive = pkg.is_active === false;
    await base44.entities.PackageProduct.update(pkg.id, { is_active: newActive });
    queryClient.invalidateQueries({ queryKey: ['packageProducts'] });
    toast.success(`${pkg.name} ${newActive ? 'activated' : 'deactivated'}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => setShowAdd(true)} className="gap-2">
          <Plus className="w-3.5 h-3.5" />
          Add Package
        </Button>
      </div>

      {showAdd && <AddPackageForm onClose={() => setShowAdd(false)} />}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Product Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Family</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Pack Size</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Shopify SKU</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Shopify ID</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {packages.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">No package products configured yet</td>
              </tr>
            ) : packages.map(pkg => (
              <tr key={pkg.id} className={cn("hover:bg-muted/30 transition-colors", pkg.is_active === false && "opacity-50")}>
                <td className="px-4 py-2.5 text-sm font-medium">{pkg.name}</td>
                <td className="px-4 py-2.5">
                  <span className={cn("text-xs px-2 py-1 rounded-full font-medium", familyColors[pkg.package_family] || 'bg-gray-100 text-gray-700')}>
                    {pkg.package_family}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right text-sm tabular-nums">{pkg.pack_size}</td>
                <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">{pkg.shopify_sku || '—'}</td>
                <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">{pkg.shopify_product_id || '—'}</td>
                <td className="px-4 py-2.5 text-center">
                  <Switch
                    checked={pkg.is_active !== false}
                    onCheckedChange={() => handleToggleActive(pkg)}
                    className="mx-auto"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}