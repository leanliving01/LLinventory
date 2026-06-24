import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChefHat, ExternalLink, Plus, Loader2, Check, Package } from 'lucide-react';
import CreateBomModal from '@/components/recipes/CreateBomModal';
import { canHaveProductionBom, canHavePackingBom, canHaveBom } from '@/lib/productClassification';

// Production layers, in the order work flows on the floor.
const LAYER_ORDER = ['prep', 'cook', 'portion', 'pack'];
const LAYER_LABELS = { prep: 'Prep', cook: 'Cook', portion: 'Portion', pack: 'Pack' };
const layerRank = (t) => { const i = LAYER_ORDER.indexOf(t); return i === -1 ? 99 : i; };

export default function ProductCookBomCard({ product, onTypeChanged }) {
  const [promoting, setPromoting] = React.useState(false);
  const [showCreate, setShowCreate] = React.useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Reflect ANY recipe/BOM for this product — cook, portion, prep or pack.
  // (The old query only looked at bom_type='cook', so finished meals with a
  // Portion BOM and packing products with a Pack BOM wrongly showed "no recipe".)
  const { data: boms = [], isLoading } = useQuery({
    queryKey: ['product-boms', product?.id],
    queryFn: () => base44.entities.Bom.filter({ product_id: product.id }),
    enabled: !!product?.id,
  });

  const hasBom = boms.length > 0;
  // Show the card when a BOM exists, for any BOM-capable category (production
  // OR packing — so packages/bundles can get a packing BOM), or for raw (which
  // gets a "promote to Bulk Cooked" affordance). Capability lives in
  // productClassification so a new produced-in-house type is enabled in one place.
  if (!product || (!hasBom && !canHaveBom(product.type) && product.type !== 'raw')) return null;

  // A package / bundle is assembled in-house from finished meals → packing BOM.
  const isPackingType = canHavePackingBom(product.type);
  // Types that can have a production (cook/portion) recipe without promotion.
  const canHaveRecipe = canHaveProductionBom(product.type) || isPackingType;

  // Class mirror — the BOM(s) are the single source of truth, so the product
  // and the recipe/BOM editor can never disagree. Packing only if every layer
  // is packing (pre-migration fallback: the 'pack' stage counts as packing).
  const isPacking = (b) => b.bom_class === 'packing' || b.bom_type === 'pack';
  const productClass = hasBom && boms.every(isPacking) ? 'packing' : 'production';

  const sortedBoms = [...boms].sort((a, b) => layerRank(a.bom_type) - layerRank(b.bom_type));
  const layersText = sortedBoms.map(b => LAYER_LABELS[b.bom_type] || b.bom_type).join(' → ');
  const activeBoms = boms.filter(b => b.is_active !== false);
  // Final output = the last layer's yield (portion → cook → …).
  const repBom = [...(activeBoms.length ? activeBoms : boms)]
    .sort((a, b) => layerRank(b.bom_type) - layerRank(a.bom_type))[0] || null;
  const maxVersion = hasBom ? Math.max(...boms.map(b => Number(b.version || 1))) : 1;

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
          <Loader2 className="w-4 h-4 animate-spin" /> Checking Recipe / BOM…
        </div>
      </div>
    );
  }

  const ClassBadge = () => (
    productClass === 'packing'
      ? <Badge className="text-[10px] bg-blue-100 text-blue-700 gap-1"><Package className="w-3 h-3" /> Packing BOM</Badge>
      : <Badge className="text-[10px] bg-orange-100 text-orange-700 gap-1"><ChefHat className="w-3 h-3" /> Production BOM</Badge>
  );

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ChefHat className="w-5 h-5 text-orange-500" />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Recipe / BOM</h3>
        </div>
        {hasBom && <ClassBadge />}
      </div>

      {hasBom ? (
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
              <Check className="w-4 h-4 text-green-600" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {productClass === 'packing' ? 'Packing BOM set up' : 'Recipe set up'}
                <span className="text-muted-foreground font-normal"> · {boms.length} layer{boms.length !== 1 ? 's' : ''}: {layersText}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {repBom ? `Yield: ${repBom.yield_qty} ${repBom.yield_uom || ''}`.trim() : ''}
                {repBom ? ' · ' : ''}v{maxVersion}
                {activeBoms.length === 0 ? ' · all layers inactive (draft)' : ''}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={() => navigate(`/recipes/product/${product.id}`)}
          >
            <ExternalLink className="w-3.5 h-3.5" /> Open Recipe / BOM
          </Button>
        </div>
      ) : canHaveRecipe ? (
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              {isPackingType ? 'No packing BOM set up yet' : 'No recipe / BOM set up yet'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isPackingType
                ? 'This box is produced in-house. Add a Packing BOM to set which meals go in it — the system keeps stock deduction in sync from it.'
                : 'Add a Production or Packing BOM so the system can calculate costs and production requirements.'}
            </p>
          </div>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => setShowCreate(true)}
          >
            <Plus className="w-3.5 h-3.5" /> {isPackingType ? 'Create Packing BOM' : 'Create BOM'}
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

      {/* Same creation flow as the Bill of Materials page — Production vs Packing,
          stage, yield — pre-selected to this product. */}
      {showCreate && (
        <CreateBomModal
          defaults={{ productId: product.id, bomType: isPackingType ? 'pack' : undefined }}
          onCancel={() => setShowCreate(false)}
          onCreated={(created) => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['product-boms', product.id] });
            queryClient.invalidateQueries({ queryKey: ['recipes-boms'] });
            if (created?.product_id) navigate(`/recipes/product/${created.product_id}`);
          }}
        />
      )}
    </div>
  );
}
