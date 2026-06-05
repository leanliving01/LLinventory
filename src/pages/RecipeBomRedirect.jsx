import React from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2 } from 'lucide-react';

/**
 * Back-compat redirect for old per-BOM links (`/recipes/:bomId`).
 * The BOM detail is now consolidated per output product, so we look up the
 * BOM's product_id and forward to `/recipes/product/:productId`.
 */
export default function RecipeBomRedirect() {
  const { bomId } = useParams();

  const { data: bom, isLoading } = useQuery({
    queryKey: ['bom-redirect', bomId],
    queryFn: async () => {
      const results = await base44.entities.Bom.filter({ id: bomId });
      return results[0] || null;
    },
    enabled: !!bomId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (bom?.product_id) {
    return <Navigate to={`/recipes/product/${bom.product_id}`} replace />;
  }
  return <Navigate to="/recipes" replace />;
}
