import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Package } from 'lucide-react';
import BOMLineEditor from './BOMLineEditor';
import CreateCustomSKU from './CreateCustomSKU';

export default function BOMTab() {
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const [showCreateSKU, setShowCreateSKU] = useState(false);

  const { data: packages = [] } = useQuery({
    queryKey: ['packageProducts'],
    queryFn: () => base44.entities.PackageProduct.list('-created_date', 100),
  });

  const { data: skus = [] } = useQuery({
    queryKey: ['skus'],
    queryFn: () => base44.entities.SKU.list('-sku_code', 200),
  });

  const activePackages = packages.filter(p => p.is_active !== false);
  const selectedPackage = packages.find(p => p.id === selectedPackageId);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={selectedPackageId} onValueChange={setSelectedPackageId}>
          <SelectTrigger className="w-[350px]">
            <SelectValue placeholder="Select a package product..." />
          </SelectTrigger>
          <SelectContent>
            {activePackages.map(pkg => (
              <SelectItem key={pkg.id} value={pkg.id}>
                {pkg.name} ({pkg.package_family} — {pkg.pack_size} meals)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" onClick={() => setShowCreateSKU(true)} className="gap-2">
          + Custom SKU
        </Button>
      </div>

      {showCreateSKU && (
        <CreateCustomSKU onClose={() => setShowCreateSKU(false)} />
      )}

      {selectedPackage ? (
        <BOMLineEditor packageProduct={selectedPackage} skus={skus} />
      ) : (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <Package className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Select a package product above to manage its Bill of Materials</p>
        </div>
      )}
    </div>
  );
}