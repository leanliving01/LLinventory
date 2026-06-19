import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChefHat, ExternalLink, Plus, Loader2, Check } from 'lucide-react';

export default function ProductCookBomCard({ product, onTypeChanged }) {
  const [promoting, setPromoting] = React.useState(false);
  const navigate = useNavigate();

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

  const showableTypes = ['raw', 'wip_bulk', 'sauce', 'finished_meal'];
  if (!product || !showableTypes.includes(product.type)) return null;

  // Types that can have a cook BOM without needing promotion
  const canHaveRecipe = ['wip_bulk', 'sauce', 'finished_meal'].includes(product.type);

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
          <Loader2 className="w-4 h-4 animate-spin" /> Checking Recipe...
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-3">
      <div className="flex items-center gap-2">
        <ChefHat className="w-5 h-5 text-orange-500" />
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Recipe / BOM</h3>
      </div>
      {cookBom ? (
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
              <Check className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <p className="text-sm font-medium">Recipe exists</p>
              <p className="text-xs text-muted-foreground">
                Yield: {cookBom.yield_qty} {cookBom.yield_uom} · v{cookBom.version || 1}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => navigate(`/recipes/product/${product.id}`)}
          >
            <ExternalLink className="w-3.5 h-3.5" /> Open Recipe Editor
          </Button>
        </div>
      ) : canHaveRecipe ? (
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              No recipe set up yet
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Add ingredients so the system can calculate costs and production requirements.
            </p>
          </div>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => navigate(`/recipes/product/${product.id}`)}
          >
            <Plus className="w-3.5 h-3.5" /> Create Recipe
          </Button>
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
