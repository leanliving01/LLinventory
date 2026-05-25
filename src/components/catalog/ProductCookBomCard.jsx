import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { ChefHat, ExternalLink, Plus, Loader2, Check } from 'lucide-react';

/**
 * Shows on the Product edit page whether a Cook BOM exists for this product.
 * If yes → links to Recipes. If no → offers to create one.
 * Only relevant for products that could be bulk-cooked (raw, wip_bulk, sauce).
 */
export default function ProductCookBomCard({ product, onTypeChanged }) {
  const [promoting, setPromoting] = React.useState(false);

  const { data: cookBom, isLoading } = useQuery({
    queryKey: ['product-cook-bom', product?.id],
    queryFn: async () => {
      const boms = await base44.entities.Bom.filter({
        product_id: product.id,
        bom_type: 'cook',
      });
      return boms[0] || null;
    },
    enabled: !!product?.id,
  });

  // Only show for types where a cook BOM makes sense
  const showableTypes = ['raw', 'wip_bulk', 'sauce'];
  if (!product || !showableTypes.includes(product.type)) return null;

  const isWip = product.type === 'wip_bulk';

  const handlePromoteToWip = async () => {
    setPromoting(true);
    await base44.entities.Product.update(product.id, { type: 'wip_bulk' });
    if (onTypeChanged) onTypeChanged('wip_bulk');
    setPromoting(false);
  };

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Checking Cook Recipe...
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-3">
      <div className="flex items-center gap-2">
        <ChefHat className="w-5 h-5 text-orange-500" />
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Cook Recipe</h3>
      </div>

      {cookBom ? (
        /* Cook BOM exists */
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
              <Check className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <p className="text-sm font-medium">Cook BOM exists</p>
              <p className="text-xs text-muted-foreground">
                Yield: {cookBom.yield_qty} {cookBom.yield_uom} · v{cookBom.version || 1}
              </p>
            </div>
          </div>
          <Link to={`/recipes?search=${encodeURIComponent(product.sku)}&layer=cook`}>
            <Button variant="outline" size="sm" className="gap-1.5">
              <ExternalLink className="w-3.5 h-3.5" /> View Recipe
            </Button>
          </Link>
        </div>
      ) : isWip ? (
        /* Product is wip_bulk but no BOM yet */
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              Marked as Bulk Cooked — no Cook Recipe yet
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Create the recipe so the system knows which raw ingredients are needed.
            </p>
          </div>
          <Link to={`/recipes?create=cook&productId=${product.id}`}>
            <Button size="sm" className="gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Create Recipe
            </Button>
          </Link>
        </div>
      ) : (
        /* Product is raw — offer to promote */
        <div className="bg-muted/50 rounded-lg p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            This item is currently typed as <Badge variant="outline" className="mx-1 text-[10px]">{product.type}</Badge>.
            If it's something you <strong>cook from raw ingredients</strong> during production (e.g. roasted vegetables, mixed sauces), 
            mark it as "Bulk Cooked" and create a Cook Recipe.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={handlePromoteToWip}
              disabled={promoting}
            >
              {promoting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChefHat className="w-3.5 h-3.5" />}
              Mark as Bulk Cooked
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}