import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import SKUsTab from '@/components/master-data/SKUsTab';

export default function MasterDataSKUs() {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const handleSyncBYO = async () => {
    setSyncing(true);
    const res = await base44.functions.invoke('syncShopifyProducts', {});
    const d = res.data;
    queryClient.invalidateQueries({ queryKey: ['skus'] });
    toast.success(`BYO sync complete: ${d.created} created, ${d.updated} updated, ${d.skipped} unmatched out of ${d.byo_products_found} BYO products`);
    if (d.unmatched?.length > 0) {
      console.log('Unmatched BYO products:', d.unmatched);
    }
    setSyncing(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">SKUs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">View and manage SKU codes by meal</p>
        </div>
        <Button variant="outline" className="gap-2" onClick={handleSyncBYO} disabled={syncing}>
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Sync BYO from Shopify'}
        </Button>
      </div>
      <SKUsTab />
    </div>
  );
}