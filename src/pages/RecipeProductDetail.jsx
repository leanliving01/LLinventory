import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ArrowLeft, Package, Utensils, Save, Loader2, BookOpen, FileText, Copy,
  ExternalLink, CheckCircle2, AlertTriangle, ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import AddComponentModal from '@/components/recipes/AddComponentModal';
import OperationsEditor from '@/components/recipes/OperationsEditor';
import RecipeFilesEditor from '@/components/recipes/RecipeFilesEditor';
import ConfirmActionModal from '@/components/recipes/ConfirmActionModal';
import RecipeComponentTable from '@/components/recipes/RecipeComponentTable';
import { getSubcategories, parseSubcategories, stringifySubcategories } from '@/lib/bomSubcategories';
import { getCategoryLabel } from '@/lib/productClassification';

// A BOM = a production layer. Ordered the way work flows on the floor.
const LAYER_ORDER = ['prep', 'cook', 'portion', 'pack'];
const LAYER_LABELS = { prep: 'Prep', cook: 'Cook', portion: 'Portion', pack: 'Pack' };
const LAYER_COLORS = {
  prep: 'bg-purple-100 text-purple-700',
  cook: 'bg-orange-100 text-orange-700',
  portion: 'bg-green-100 text-green-700',
  pack: 'bg-blue-100 text-blue-700',
};
const layerRank = (t) => { const i = LAYER_ORDER.indexOf(t); return i === -1 ? 99 : i; };

export default function RecipeProductDetail() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [saving, setSaving] = useState(false);
  const [editedQtys, setEditedQtys] = useState({});
  const [editedSteps, setEditedSteps] = useState({});
  const [bomEdits, setBomEdits] = useState({}); // { [bomId]: {yieldQty, yieldUom, chefNotes, notes, subcategory, files} }
  const [addModalBomId, setAddModalBomId] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);

  const { data: product, isLoading: loadingProduct } = useQuery({
    queryKey: ['recipe-product', productId],
    queryFn: async () => {
      const r = await base44.entities.Product.filter({ id: productId });
      return r[0] || null;
    },
    enabled: !!productId,
  });

  const { data: boms = [], isLoading: loadingBoms } = useQuery({
    queryKey: ['recipe-product-boms', productId],
    queryFn: () => base44.entities.Bom.filter({ product_id: productId }),
    enabled: !!productId,
  });

  const bomIds = useMemo(() => boms.map(b => b.id), [boms]);

  const { data: operations = [] } = useQuery({
    queryKey: ['recipe-product-operations', productId, bomIds.join(',')],
    queryFn: async () => {
      const results = await Promise.all(bomIds.map(id => base44.entities.BomOperation.filter({ bom_id: id })));
      return results.flat();
    },
    enabled: bomIds.length > 0,
  });

  const { data: components = [], isLoading: loadingComps } = useQuery({
    queryKey: ['recipe-product-components', productId, bomIds.join(',')],
    queryFn: async () => {
      const results = await Promise.all(bomIds.map(id => base44.entities.BomComponent.filter({ bom_id: id })));
      return results.flat();
    },
    enabled: bomIds.length > 0,
  });

  // All BOMs globally — to detect which ingredients have their own recipe.
  const { data: allBoms = [] } = useQuery({
    queryKey: ['recipes-boms'],
    queryFn: () => base44.entities.Bom.list('-created_date', 500),
  });
  const { data: productCategories = [] } = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => base44.entities.ProductCategory.list('sort_order', 500),
  });
  const catNameById = useMemo(
    () => Object.fromEntries(productCategories.map(c => [c.id, c.name])), [productCategories]);

  // ── Derived maps ──────────────────────────────────────────────────────────
  const sortedBoms = useMemo(() =>
    [...boms].sort((a, b) =>
      layerRank(a.bom_type) - layerRank(b.bom_type)
      || (a.is_active === false ? 1 : 0) - (b.is_active === false ? 1 : 0)),
  [boms]);

  const bomTypeById = useMemo(
    () => Object.fromEntries(boms.map(b => [b.id, b.bom_type])), [boms]);

  // Layers that exist for this product — the move-ingredient dropdown options.
  const availableLayers = useMemo(() => {
    const seen = [];
    sortedBoms.forEach(b => { if (b.bom_type && !seen.includes(b.bom_type)) seen.push(b.bom_type); });
    return seen.map(t => ({ value: t, label: LAYER_LABELS[t] || t }));
  }, [sortedBoms]);

  const operationsByBom = useMemo(() => {
    const m = {};
    operations.forEach(op => { (m[op.bom_id] ||= []).push(op); });
    Object.values(m).forEach(arr => arr.sort((a, b) => (a.step_no || 0) - (b.step_no || 0)));
    return m;
  }, [operations]);

  const componentsByBom = useMemo(() => {
    const m = {};
    components.forEach(c => { (m[c.bom_id] ||= []).push(c); });
    return m;
  }, [components]);

  const subRecipeProductIds = useMemo(() => {
    const s = new Set(allBoms.map(b => b.product_id).filter(Boolean));
    s.delete(productId);
    return s;
  }, [allBoms, productId]);

  const activeBoms = useMemo(() => boms.filter(b => b.is_active !== false), [boms]);
  const inactiveBoms = useMemo(() => boms.filter(b => b.is_active === false), [boms]);

  // The final output of the product = the last layer's yield (portion → cook → …).
  const repBom = useMemo(() => {
    const ordered = [...activeBoms].sort((a, b) => layerRank(b.bom_type) - layerRank(a.bom_type));
    return ordered[0] || boms[0] || null;
  }, [activeBoms, boms]);

  // Apply local component edits for display.
  const enrich = (c) => ({
    ...c,
    step_no: editedSteps[c.id] !== undefined ? editedSteps[c.id] : (c.step_no || 0),
    _layer: bomTypeById[c.bom_id] || null,
  });

  // ── Save (qty, step, bom fields) ──────────────────────────────────────────
  const hasUnsavedChanges =
    Object.keys(editedQtys).length > 0 ||
    Object.keys(editedSteps).length > 0 ||
    Object.keys(bomEdits).length > 0;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['recipe-product-boms', productId] });
    queryClient.invalidateQueries({ queryKey: ['recipe-product-operations', productId] });
    queryClient.invalidateQueries({ queryKey: ['recipe-product-components', productId] });
    queryClient.invalidateQueries({ queryKey: ['recipes-boms'] });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const [bomId, edits] of Object.entries(bomEdits)) {
        const update = {};
        if (edits.yieldQty !== undefined) update.yield_qty = Number(edits.yieldQty) || 1;
        if (edits.yieldUom !== undefined) update.yield_uom = edits.yieldUom;
        if (edits.chefNotes !== undefined) update.chef_notes = edits.chefNotes;
        if (edits.notes !== undefined) update.notes = edits.notes;
        if (edits.subcategory !== undefined) update.subcategory = edits.subcategory;
        if (edits.files !== undefined) update.files = edits.files;
        if (Object.keys(update).length) await base44.entities.Bom.update(bomId, update);
      }
      for (const [compId, newQty] of Object.entries(editedQtys)) {
        const val = Number(newQty);
        if (isNaN(val) || val < 0) continue;
        await base44.entities.BomComponent.update(compId, { qty: val });
      }
      for (const [compId, stepNo] of Object.entries(editedSteps)) {
        await base44.entities.BomComponent.update(compId, { step_no: stepNo || null });
      }
      setEditedQtys({}); setEditedSteps({}); setBomEdits({});
      invalidateAll();
      toast.success('Recipe saved');
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  // ── Move an ingredient to a different layer (= different BOM) ───────────────
  const handleLayerMove = async (comp, newType) => {
    const currentType = bomTypeById[comp.bom_id];
    if (newType === currentType) return;
    const target = boms.find(b => b.bom_type === newType);
    if (!target) {
      toast.error(`Create a ${LAYER_LABELS[newType] || newType} layer first.`);
      return;
    }
    setSaving(true);
    try {
      // Moving to another BOM means the old step pin no longer applies.
      await base44.entities.BomComponent.update(comp.id, { bom_id: target.id, step_no: null });
      setEditedSteps(prev => { const n = { ...prev }; delete n[comp.id]; return n; });
      invalidateAll();
      toast.success(`Moved to ${LAYER_LABELS[newType]} layer`);
    } catch (err) {
      toast.error('Move failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  // ── Bom field helpers ─────────────────────────────────────────────────────
  const bomField = (bom, key, fallback) => {
    const e = bomEdits[bom.id];
    if (e && e[key] !== undefined) return e[key];
    return fallback;
  };
  const setBomField = (bomId, key, value) =>
    setBomEdits(prev => ({ ...prev, [bomId]: { ...prev[bomId], [key]: value } }));

  // ── Validation for activation ─────────────────────────────────────────────
  const validateForActive = (bom) => {
    const issues = [];
    const ops = operationsByBom[bom.id] || [];
    const comps = (componentsByBom[bom.id] || []).filter(c => !c.is_consumable);
    if (ops.length === 0) issues.push('at least one step');
    if (comps.length === 0) issues.push('at least one ingredient');
    if (comps.some(c => !(Number(c.qty) > 0))) issues.push('every ingredient needs a quantity > 0');
    if (comps.some(c => !c.uom)) issues.push('every ingredient needs a UoM');
    if (!(Number(bomField(bom, 'yieldQty', bom.yield_qty)) > 0)) issues.push('a yield quantity');
    if (!bomField(bom, 'yieldUom', bom.yield_uom)) issues.push('a yield UoM');
    return issues;
  };

  const toggleActive = async (bom) => {
    if (bom.is_active === false) {
      const issues = validateForActive(bom);
      if (issues.length) { toast.error(`Cannot activate — needs: ${issues.join(', ')}.`); return; }
    }
    setSaving(true);
    try {
      await base44.entities.Bom.update(bom.id, { is_active: bom.is_active === false });
      invalidateAll();
      toast.success(bom.is_active === false ? 'Layer activated' : 'Layer set inactive');
    } catch (err) {
      toast.error('Update failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  // ── Duplicate / Delete ────────────────────────────────────────────────────
  const handleDuplicate = () => setConfirmAction({
    type: 'duplicate', title: 'Duplicate Full Recipe',
    message: <span>Create an inactive copy (version +1) of <strong>all {boms.length} layer(s)</strong> for <strong>{product?.name}</strong>, including every step, ingredient, note and yield?</span>,
    confirmLabel: 'Duplicate Everything', confirmVariant: 'default', icon: 'move',
  });

  const doDuplicate = async () => {
    for (const bom of boms) {
      const newBom = await base44.entities.Bom.create({
        product_id: bom.product_id, product_name: bom.product_name, product_sku: bom.product_sku,
        bom_type: bom.bom_type, subcategory: bom.subcategory || undefined,
        yield_qty: bom.yield_qty || 1, yield_uom: bom.yield_uom || undefined,
        chef_notes: bom.chef_notes || undefined,
        notes: bom.notes ? `(Copy) ${bom.notes}` : '(Copy)',
        pack_color_theme: bom.pack_color_theme || undefined,
        files: bom.files || [], version: (bom.version || 1) + 1, is_active: false,
      });
      const [comps, ops] = await Promise.all([
        base44.entities.BomComponent.filter({ bom_id: bom.id }),
        base44.entities.BomOperation.filter({ bom_id: bom.id }),
      ]);
      await Promise.all(ops.map(o => base44.entities.BomOperation.create({
        bom_id: newBom.id, step_no: o.step_no, name: o.name, station: o.station,
        equipment_id: o.equipment_id || undefined, cycle_time_min: o.cycle_time_min || undefined,
        notes: o.notes || undefined, output_qty: o.output_qty ?? undefined, output_uom: o.output_uom || undefined,
      })));
      await Promise.all(comps.map(c => base44.entities.BomComponent.create({
        bom_id: newBom.id, input_product_id: c.input_product_id,
        input_product_name: c.input_product_name, input_product_sku: c.input_product_sku,
        qty: c.qty, uom: c.uom, is_consumable: c.is_consumable || false,
        step_no: c.step_no ?? undefined, station: c.station || undefined, make_day: c.make_day || undefined,
      })));
    }
    invalidateAll();
    toast.success('Recipe duplicated as inactive draft (version +1)');
  };

  const handleDelete = () => setConfirmAction({
    type: 'delete', title: 'Delete Entire Recipe',
    message: <span>Permanently delete <strong>all {boms.length} layer(s)</strong> ({components.length} ingredients, {operations.length} steps) for <strong>{product?.name}</strong>? The product itself is not deleted.</span>,
    confirmLabel: 'Delete Permanently', icon: 'delete',
  });

  const doDelete = async () => {
    let failed = 0;
    for (const bom of boms) {
      try {
        const [comps, ops] = await Promise.all([
          base44.entities.BomComponent.filter({ bom_id: bom.id }),
          base44.entities.BomOperation.filter({ bom_id: bom.id }),
        ]);
        for (const c of comps) await base44.entities.BomComponent.delete(c.id);
        for (const o of ops) await base44.entities.BomOperation.delete(o.id);
        await base44.entities.Bom.delete(bom.id);
      } catch { failed++; }
    }
    queryClient.invalidateQueries({ queryKey: ['recipes-boms'] });
    if (failed) toast.error(`${failed} layer(s) could not be deleted (still referenced).`);
    else toast.success('Recipe deleted');
    navigate('/recipes');
  };

  const removeComponent = (comp) => setConfirmAction({
    type: 'delete_component', data: comp,
    title: 'Remove Ingredient',
    message: <span>Remove <strong>{comp.input_product_name}</strong> ({comp.input_product_sku})?</span>,
    confirmLabel: 'Remove Ingredient', icon: 'delete',
  });

  const handleConfirm = async () => {
    if (!confirmAction) return;
    setSaving(true);
    try {
      if (confirmAction.type === 'delete_component') {
        await base44.entities.BomComponent.delete(confirmAction.data.id);
        invalidateAll();
        toast.success('Ingredient removed');
      } else if (confirmAction.type === 'duplicate') {
        await doDuplicate();
      } else if (confirmAction.type === 'delete') {
        await doDelete();
      }
    } catch (err) {
      toast.error('Action failed: ' + (err.message || 'Unknown error'));
    }
    setSaving(false);
    setConfirmAction(null);
  };

  if (loadingProduct || loadingBoms) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  if (boms.length === 0) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate('/recipes')}>
          <ArrowLeft className="w-4 h-4" /> Back to BOMs
        </Button>
        <div className="text-center py-16 text-sm text-muted-foreground">
          No BOM exists for {product?.name || 'this product'} yet.
        </div>
      </div>
    );
  }

  const categoryLabel = product
    ? (catNameById[product.category_id] || getCategoryLabel(product.type) || product.category || '—')
    : '—';
  const subcategoriesText = [...new Set(boms.flatMap(b => parseSubcategories(b.subcategory)))].join(', ');
  const maxVersion = Math.max(...boms.map(b => Number(b.version || 1)));
  const anyActive = activeBoms.length > 0;

  const consolidatedIngredients = sortedBoms
    .flatMap(b => (componentsByBom[b.id] || []))
    .filter(c => !c.is_consumable)
    .map(enrich);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/recipes')} className="mt-0.5">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge variant="outline" className="text-[10px]">{categoryLabel}</Badge>
              {subcategoriesText && <Badge variant="outline" className="text-[10px]">{subcategoriesText}</Badge>}
              {anyActive
                ? <Badge className="text-[10px] bg-green-100 text-green-700">Active</Badge>
                : <Badge className="text-[10px] bg-gray-100 text-gray-500">Inactive</Badge>}
              <Badge variant="outline" className="text-[10px]">v{maxVersion}</Badge>
            </div>
            <button type="button" onClick={() => navigate(`/catalog/${productId}`)} className="text-left group">
              <h1 className="text-2xl font-bold group-hover:text-primary group-hover:underline transition-colors">{product?.name || repBom?.product_name}</h1>
              <p className="text-sm text-muted-foreground font-mono group-hover:text-primary">{product?.sku || repBom?.product_sku}</p>
            </button>
            <p className="text-xs text-muted-foreground mt-1">
              Full production process — {boms.length} layer{boms.length !== 1 ? 's' : ''}: {sortedBoms.map(b => LAYER_LABELS[b.bom_type]).join(' → ')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(`/catalog/${productId}`)}>
            <ExternalLink className="w-4 h-4" /> Open Product
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDuplicate} disabled={saving}>
            <Copy className="w-4 h-4" /> Duplicate
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={handleDelete}>
            <FileText className="w-4 h-4" /> Delete
          </Button>
        </div>
      </div>

      {/* Summary card */}
      <div className="bg-card border border-border rounded-xl p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Final Output / Yield</p>
          <p className="text-sm font-medium">{repBom ? `${repBom.yield_qty} ${repBom.yield_uom || ''}`.trim() : '—'}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Version</p>
          <p className="text-sm font-medium">v{maxVersion}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Layers</p>
          <p className="text-sm font-medium">{sortedBoms.map(b => LAYER_LABELS[b.bom_type]).join(' → ')}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Status</p>
          <p className="text-sm font-medium">{anyActive ? 'Active' : 'Inactive'}{inactiveBoms.length > 0 && activeBoms.length > 0 ? ` (+${inactiveBoms.length} draft)` : ''}</p>
        </div>
      </div>

      {/* Process Flow — one editable card per layer (= BOM), in flow order */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Package className="w-4 h-4 text-primary" /> Process Flow — Production Layers
        </h3>
        <p className="text-[11px] text-muted-foreground">Each layer is one BOM. Steps, ingredients and outputs below are exactly what runs on the floor for that layer.</p>

        {sortedBoms.map((bom, layerIdx) => {
          const bomComps = (componentsByBom[bom.id] || []);
          const ingredients = bomComps.filter(c => !c.is_consumable).map(enrich);
          const consumables = bomComps.filter(c => c.is_consumable).map(enrich);
          // ingredients grouped by step for inline display inside the steps editor
          const ingredientsByStep = {};
          ingredients.forEach(c => { (ingredientsByStep[c.step_no || 0] ||= []).push(c); });

          const nextBom = sortedBoms[layerIdx + 1] || null;
          const isFinal = layerIdx === sortedBoms.length - 1;
          const prevBom = layerIdx > 0 ? sortedBoms[layerIdx - 1] : null;
          const prevQty = prevBom ? bomField(prevBom, 'yieldQty', prevBom.yield_qty ?? '') : '';
          const prevUom = prevBom ? bomField(prevBom, 'yieldUom', prevBom.yield_uom || '') : '';

          return (
            <React.Fragment key={bom.id}>
              {layerIdx > 0 && (
                <div className="flex flex-col items-center text-muted-foreground py-0.5">
                  <ArrowRight className="w-4 h-4 rotate-90" />
                  {prevQty !== '' && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                      {prevQty} {prevUom} → {LAYER_LABELS[bom.bom_type]}
                    </span>
                  )}
                </div>
              )}
              <div className="bg-card border border-border rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Badge className={cn("text-[11px] px-2.5 py-0.5", LAYER_COLORS[bom.bom_type])}>{LAYER_LABELS[bom.bom_type]} Layer</Badge>
                    <span className="text-xs text-muted-foreground">v{bom.version || 1}</span>
                    {bom.is_active === false && <Badge className="text-[10px] bg-gray-100 text-gray-500">Inactive draft</Badge>}
                  </div>
                  <Button variant="outline" size="sm" className="gap-1.5"
                    onClick={() => toggleActive(bom)} disabled={saving}>
                    {bom.is_active === false
                      ? <><CheckCircle2 className="w-3.5 h-3.5" /> Activate</>
                      : <><AlertTriangle className="w-3.5 h-3.5" /> Set Inactive</>}
                  </Button>
                </div>

                {/* Subcategory */}
                {getSubcategories(bom.bom_type).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {getSubcategories(bom.bom_type).map(sub => {
                      const current = parseSubcategories(bomField(bom, 'subcategory', bom.subcategory || ''));
                      const active = current.includes(sub);
                      return (
                        <button key={sub} onClick={() => {
                          const next = active ? current.filter(s => s !== sub) : [...current, sub];
                          setBomField(bom.id, 'subcategory', stringifySubcategories(next));
                        }}
                          className={cn("text-[11px] px-2.5 py-1 rounded-full font-medium border transition-all",
                            active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/30')}>{sub}</button>
                      );
                    })}
                  </div>
                )}

                {/* Steps (editable, with per-step inputs + output) */}
                <div className="border border-border rounded-lg p-4">
                  <OperationsEditor bomId={bom.id} defaultStation={bom.bom_type} ingredientsByStep={ingredientsByStep} />
                </div>

                {/* Layer ingredients */}
                <RecipeComponentTable
                  title="Ingredients into this layer" icon={<Utensils className="w-4 h-4 text-primary" />}
                  components={ingredients}
                  loading={loadingComps}
                  editedQtys={editedQtys}
                  onQtyChange={(id, v) => setEditedQtys(prev => ({ ...prev, [id]: v }))}
                  onRemove={removeComponent}
                  onAdd={() => setAddModalBomId(bom.id)}
                  onStepChange={(id, stepNo) => setEditedSteps(prev => ({ ...prev, [id]: stepNo }))}
                  onLayerChange={handleLayerMove}
                  availableLayers={availableLayers}
                  operationsByBom={operationsByBom}
                  showLayer
                  subRecipeProductIds={subRecipeProductIds}
                  onOpenSubRecipe={(pid) => navigate(`/recipes/product/${pid}`)}
                />

                {consumables.length > 0 && (
                  <RecipeComponentTable
                    title="Packaging / Consumables" icon={<Package className="w-4 h-4 text-muted-foreground" />}
                    components={consumables}
                    loading={loadingComps}
                    editedQtys={editedQtys}
                    onQtyChange={(id, v) => setEditedQtys(prev => ({ ...prev, [id]: v }))}
                    onRemove={removeComponent}
                    onAdd={() => setAddModalBomId(bom.id)}
                    onStepChange={(id, stepNo) => setEditedSteps(prev => ({ ...prev, [id]: stepNo }))}
                    operationsByBom={operationsByBom}
                  />
                )}

                {/* Layer output → next layer (= this layer's yield) */}
                <div className="flex items-center gap-3 flex-wrap rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-900/10 px-4 py-3">
                  <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    {isFinal ? 'Final output (product yield)' : `Output → ${LAYER_LABELS[nextBom.bom_type]} layer`}
                  </span>
                  <Input type="number" step="any" min="0" className="w-24 h-8"
                    value={String(bomField(bom, 'yieldQty', bom.yield_qty ?? 1))}
                    onChange={e => setBomField(bom.id, 'yieldQty', e.target.value)} />
                  <Input className="w-24 h-8" placeholder="UoM"
                    value={bomField(bom, 'yieldUom', bom.yield_uom || '')}
                    onChange={e => setBomField(bom.id, 'yieldUom', e.target.value)} />
                  <span className="text-[10px] text-muted-foreground">
                    {isFinal ? 'feeds the next process (e.g. portioning)' : 'becomes the input to the next layer'}
                  </span>
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Consolidated ingredients overview */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Utensils className="w-4 h-4 text-primary" /> All Ingredients (across layers)
        </h3>
        <RecipeComponentTable
          title="Ingredients" icon={<Utensils className="w-4 h-4 text-primary" />}
          components={consolidatedIngredients}
          loading={loadingComps}
          editedQtys={editedQtys}
          onQtyChange={(id, v) => setEditedQtys(prev => ({ ...prev, [id]: v }))}
          onRemove={removeComponent}
          onStepChange={(id, stepNo) => setEditedSteps(prev => ({ ...prev, [id]: stepNo }))}
          onLayerChange={handleLayerMove}
          availableLayers={availableLayers}
          operationsByBom={operationsByBom}
          showLayer
          subRecipeProductIds={subRecipeProductIds}
          onOpenSubRecipe={(pid) => navigate(`/recipes/product/${pid}`)}
        />
      </div>

      {/* Notes — one set for the whole recipe */}
      {repBom && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="text-xs font-semibold flex items-center gap-2 mb-1.5"><BookOpen className="w-3.5 h-3.5 text-primary" /> Chef Notes</h4>
              <p className="text-[10px] text-muted-foreground mb-1.5">Shown to kitchen staff on the floor.</p>
              <Textarea className="min-h-[100px] text-sm" placeholder="e.g. Sear chicken at 180°C until internal temp hits 74°C…"
                value={bomField(repBom, 'chefNotes', repBom.chef_notes || '')}
                onChange={e => setBomField(repBom.id, 'chefNotes', e.target.value)} />
            </div>
            <div>
              <h4 className="text-xs font-semibold flex items-center gap-2 mb-1.5"><FileText className="w-3.5 h-3.5 text-muted-foreground" /> General Notes</h4>
              <p className="text-[10px] text-muted-foreground mb-1.5">Internal — not shown on the floor.</p>
              <Textarea className="min-h-[100px] text-sm" placeholder="Internal notes about this recipe…"
                value={bomField(repBom, 'notes', repBom.notes || '')}
                onChange={e => setBomField(repBom.id, 'notes', e.target.value)} />
            </div>
          </div>
          <RecipeFilesEditor files={bomField(repBom, 'files', repBom.files || [])} onChange={f => setBomField(repBom.id, 'files', f)} />
        </div>
      )}

      {/* Sticky save bar */}
      {hasUnsavedChanges && (
        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-3 -mx-6 flex justify-end">
          <Button onClick={handleSave} disabled={saving} className="gap-2 min-w-[200px]">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      )}

      {addModalBomId && (
        <AddComponentModal bomId={addModalBomId}
          existingProductIds={(componentsByBom[addModalBomId] || []).map(c => c.input_product_id)}
          onAdded={() => { invalidateAll(); setAddModalBomId(null); toast.success('Ingredient added'); }}
          onCancel={() => setAddModalBomId(null)} />
      )}

      {confirmAction && (
        <ConfirmActionModal title={confirmAction.title} message={confirmAction.message}
          confirmLabel={confirmAction.confirmLabel} confirmVariant={confirmAction.confirmVariant || 'destructive'}
          icon={confirmAction.icon} onConfirm={handleConfirm} onCancel={() => setConfirmAction(null)} loading={saving} />
      )}
    </div>
  );
}
