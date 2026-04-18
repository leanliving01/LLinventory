import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';

export default function PackageProductsTab() {
  const { data: packages = [] } = useQuery({
    queryKey: ['packageProducts'],
    queryFn: () => base44.entities.PackageProduct.list('-created_date', 50),
  });

  const familyColors = {
    MWL: 'bg-blue-100 text-blue-700',
    MLM: 'bg-indigo-100 text-indigo-700',
    WWL: 'bg-pink-100 text-pink-700',
    WLM: 'bg-purple-100 text-purple-700',
    LOW_CARB: 'bg-emerald-100 text-emerald-700',
    BYO: 'bg-amber-100 text-amber-700',
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-muted/50 border-b border-border">
            <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Product Name</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Family</th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Pack Size</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Shopify ID</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {packages.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">No package products configured yet</td>
            </tr>
          ) : packages.map(pkg => (
            <tr key={pkg.id} className="hover:bg-muted/30 transition-colors">
              <td className="px-4 py-2.5 text-sm font-medium">{pkg.name}</td>
              <td className="px-4 py-2.5">
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${familyColors[pkg.package_family] || 'bg-gray-100 text-gray-700'}`}>
                  {pkg.package_family}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right text-sm tabular-nums">{pkg.pack_size}</td>
              <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">{pkg.shopify_product_id || '—'}</td>
              <td className="px-4 py-2.5">
                <span className={`text-xs px-2 py-1 rounded-full ${pkg.is_active !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                  {pkg.is_active !== false ? 'Active' : 'Inactive'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}