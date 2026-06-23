import React, { useState, useMemo, useEffect } from 'react';
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
  ExternalLink, CheckCircle2, AlertTriangle, ArrowRight, Trash2, Pencil, X,
  ChefHat, Plus, Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import AddComponentModal from '@/components/recipes/AddComponentModal';
import OperationsEditor from '@/components/recipes/OperationsEditor';
import RecipeFilesEditor from '@/components/recipes/RecipeFilesEditor';
import ConfirmActionModal from '@/components/recipes/ConfirmActionModal';
import RecipeComponentTable from '@/components/recipes/RecipeComponentTable';
import ProductEquipmentTab from '@/components/catalog/ProductEquipmentTab';
import { parseSubcategories } from '@/lib/bomSubcategories';
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
  const [activeTab, setActiveTab] = useState('recipe'); // 'recipe' | 'equipment'
  const [editedQtys, setEditedQtys] = useState({});
  const [editedSteps, setEditedSteps] = useState({});
  const [bomEdits, setBomEdits] = useState({}); // { [bomId]: {yieldQty, yieldUom, chefNotes, notes, subcategory, files} }
  const [addModalBomId, setAddModalBomId] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkForm, setBulkForm] = useState({ layer: '', step: '', qty: '', uom: '' });
  const [pendingNav, setPendingNav] = useState(null);
  const [pendingLayerDeletes, setPendingLayerDeletes] = useState(() => new Set()); // bomIds staged for delete, committed on Save

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

  // Top-level class for this product: packing only if every BOM is packing
  // (pre-migration fallback: the 'pack' stage counts as packing). Empty = production.
  const isPackingBom = (b) => b.bom_class === 'packing' || b.bom_type === 'pack';
  const productClass = boms.length && boms.every(isPackingBom) ? 'packing' : 'production';
  // Layers you can add depend on the class (keeps the Production/Packing split coherent).
  const allowedAddLayers = productClass === 'packing' ? ['pack'] : ['prep', 'cook', 'portion'];

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
    Object.keys(bomEdits).length > 0 ||
    pendingLayerDeletes.size > 0;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['recipe-product-boms', productId] });
    queryClient.invalidateQueries({ queryKey: ['recipe-product-operations', productId] });
    queryClient.invalidateQueries({ queryKey: ['recipe-product-components', productId] });
    queryClient.invalidateQueries({ queryKey: ['recipes-boms'] });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Layers staged for deletion — any field/qty/step edits on them are moot.
      const deletingBomIds = new Set(pendingLayerDeletes);
      const deletingCompIds = new Set(
        components.filter(c => deletingBomIds.has(c.bom_id)).map(c => c.id));

      for (const [bomId, edits] of Object.entries(bomEdits)) {
        if (deletingBomIds.has(bomId)) continue;
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
        if (deletingCompIds.has(compId)) continue;
        const val = Number(newQty);
        if (isNaN(val) || val < 0) continue;
        await base44.entities.BomComponent.update(compId, { qty: val });
      }
      for (const [compId, stepNo] of Object.entries(editedSteps)) {
        if (deletingCompIds.has(compId)) continue;
        await base44.entities.BomComponent.update(compId, { step_no: stepNo || null });
      }

      // Commit staged layer deletions (the BOM + all its components and steps).
      const failedDeletes = [];
      for (const bomId of deletingBomIds) {
        try {
          const [comps, ops] = await Promise.all([
            base44.entities.BomComponent.filter({ bom_id: bomId }),
            base44.entities.BomOperation.filter({ bom_id: bomId }),
          ]);
          for (const c of comps) await base44.entities.BomComponent.delete(c.id);
          for (const o of ops) await base44.entities.BomOperation.delete(o.id);
          await base44.entities.Bom.delete(bomId);
        } catch {
          failedDeletes.push(bomId);
        }
      }

      setEditedQtys({}); setEditedSteps({}); setBomEdits({});
      setPendingLayerDeletes(new Set(failedDeletes)); // keep any that couldn't be deleted
      if (deletingCompIds.size) {
        setSelectedIds(prev => {
          const n = new Set(prev);
          deletingCompIds.forEach(id => n.delete(id));
          return n;
        });
      }
      invalidateAll();
      if (failedDeletes.length) {
        toast.error(`${failedDeletes.length} layer(s) could not be deleted (still referenced elsewhere).`);
      } else {
        toast.success('Recipe saved');
      }
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

  // ── Bulk selection / edit / delete of ingredients ─────────────────────────
  const toggleSelect = (id) => setSelectedIds(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const toggleSelectAll = (ids, checked) => setSelectedIds(prev => {
    const n = new Set(prev);
    ids.forEach(id => checked ? n.add(id) : n.delete(id));
    return n;
  });
  const clearSelection = () => setSelectedIds(new Set());
  const selectedComps = useMemo(
    () => components.filter(c => selectedIds.has(c.id)), [components, selectedIds]);

  const dropLocalEdits = (ids) => {
    setEditedQtys(prev => { const n = { ...prev }; ids.forEach(id => delete n[id]); return n; });
    setEditedSteps(prev => { const n = { ...prev }; ids.forEach(id => delete n[id]); return n; });
  };

  const handleBulkDelete = () => setConfirmAction({
    type: 'bulk_delete', title: 'Delete Selected Ingredients',
    message: <span>Remove <strong>{selectedComps.length}</strong> selected ingredient{selectedComps.length !== 1 ? 's' : ''} from this recipe?</span>,
    confirmLabel: 'Delete Selected', icon: 'delete',
  });

  const doBulkDelete = async () => {
    const ids = selectedComps.map(c => c.id);
    for (const id of ids) await base44.entities.BomComponent.delete(id);
    dropLocalEdits(ids);
    clearSelection();
    invalidateAll();
    toast.success(`Removed ${ids.length} ingredient${ids.length !== 1 ? 's' : ''}`);
  };

  const applyBulkEdit = async () => {
    const { layer, step, qty, uom } = bulkForm;
    if (!layer && step === '' && qty === '' && uom === '') {
      toast.error('Choose at least one thing to change.');
      return;
    }
    setSaving(true);
    try {
      const target = layer ? boms.find(b => b.bom_type === layer) : null;
      if (layer && !target) { toast.error(`No ${LAYER_LABELS[layer]} layer exists — create it first.`); setSaving(false); return; }
      for (const c of selectedComps) {
        const update = {};
        if (target && target.id !== c.bom_id) {
          update.bom_id = target.id;
          update.step_no = step ? Number(step) : null; // moving layer resets the step
        } else if (layer && step !== '') {
          update.step_no = step ? Number(step) : null;
        }
        if (qty !== '' && Number(qty) >= 0) update.qty = Number(qty);
        if (uom !== '') update.uom = uom;
        if (Object.keys(update).length) await base44.entities.BomComponent.update(c.id, update);
      }
      dropLocalEdits(selectedComps.map(c => c.id));
      setShowBulkEdit(false);
      setBulkForm({ layer: '', step: '', qty: '', uom: '' });
      clearSelection();
      invalidateAll();
      toast.success('Selected ingredients updated');
    } catch (err) {
      toast.error('Bulk edit failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  // Steps available in the bulk-edit Step dropdown (for the chosen target layer).
  const bulkStepOptions = useMemo(() => {
    if (!bulkForm.layer) return [];
    const target = boms.find(b => b.bom_type === bulkForm.layer);
    return target ? (operationsByBom[target.id] || []) : [];
  }, [bulkForm.layer, boms, operationsByBom]);

  // ── Unsaved-changes guard ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => { if (hasUnsavedChanges) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  const guardedNavigate = (to) => {
    if (hasUnsavedChanges) setPendingNav(to);
    else navigate(to);
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

  // ── Stage / unstage a whole layer (BOM) for deletion (committed on Save) ──
  const stageLayerDelete = (bomId) =>
    setPendingLayerDeletes(prev => { const n = new Set(prev); n.add(bomId); return n; });
  const unstageLayerDelete = (bomId) =>
    setPendingLayerDeletes(prev => { const n = new Set(prev); n.delete(bomId); return n; });

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
        bom_type: bom.bom_type,
        bom_class: bom.bom_class || (bom.bom_type === 'pack' ? 'packing' : 'production'),
        subcategory: bom.subcategory || undefined,
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
      } else if (confirmAction.type === 'bulk_delete') {
        await doBulkDelete();
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

  const handleAddLayer = async (bomType) => {
    if (!product) return;
    setSaving(true);
    try {
      await base44.entities.Bom.create({
        product_id: productId,
        product_name: product.name,
        product_sku: product.sku || undefined,
        bom_type: bomType,
        bom_class: bomType === 'pack' ? 'packing' : 'production',
        version: 1,
        is_active: false,
        yield_qty: 1,
      });
      queryClient.invalidateQueries({ queryKey: ['recipe-product-boms', productId] });
      queryClient.invalidateQueries({ queryKey: ['recipes-boms'] });
      toast.success(`${LAYER_LABELS[bomType]} layer created — add ingredients below.`);
    } catch (err) {
      toast.error('Failed to create layer: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  if (loadingProduct || loadingBoms) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  if (boms.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/recipes')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{product?.name || 'Recipe'}</h1>
            {product?.sku && <p className="text-sm text-muted-foreground font-mono">{product.sku}</p>}
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-10 text-center space-y-6">
          <div className="flex justify-center">
            <div className="w-16 h-16 bg-orange-50 dark:bg-orange-900/20 rounded-full flex items-center justify-center">
              <ChefHat className="w-8 h-8 text-orange-400" />
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold">No recipe set up yet</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Choose a production layer to start building the recipe for <strong>{product?.name}</strong>.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {['prep', 'cook', 'portion'].map(layer => (
              <Button
                key={layer}
                variant={layer === 'cook' ? 'default' : 'outline'}
                className="gap-2"
                onClick={() => handleAddLayer(layer)}
                disabled={saving}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Add {LAYER_LABELS[layer]} Layer
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Most finished meals start with a <strong>Cook</strong> layer. You can add more layers (Prep, Portion) afterward.
            Packing BOMs are created from the <strong>Create BOM</strong> button on the Bill of Materials page.
          </p>
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

  // Consolidated overview: each ingredient appears ONCE across the recipe,
  // even if it's used in more than one layer (qty combined per UoM).
  const consolidatedIngredients = (() => {
    const map = new Map();
    activeBoms
      .flatMap(b => (componentsByBom[b.id] || []))
      .filter(c => !c.is_consumable)
      .forEach(c => {
        const key = c.input_product_id || c.id;
        const layer = bomTypeById[c.bom_id];
        const qty = Number(c.qty) || 0;
        if (!map.has(key)) {
          map.set(key, {
            key,
            input_product_id: c.input_product_id,
            input_product_sku: c.input_product_sku,
            input_product_name: c.input_product_name,
            layers: new Set(layer ? [layer] : []),
            qtyByUom: { [c.uom]: qty },
          });
        } else {
          const e = map.get(key);
          if (layer) e.layers.add(layer);
          e.qtyByUom[c.uom] = (e.qtyByUom[c.uom] || 0) + qty;
        }
      });
    return [...map.values()];
  })();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => guardedNavigate('/recipes')} className="mt-0.5">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {productClass === 'packing'
                ? <Badge className="text-[10px] bg-blue-100 text-blue-700 gap-1"><Package className="w-3 h-3" /> Packing BOM</Badge>
                : <Badge className="text-[10px] bg-orange-100 text-orange-700 gap-1"><ChefHat className="w-3 h-3" /> Production BOM</Badge>}
              <Badge variant="outline" className="text-[10px]">{categoryLabel}</Badge>
              {subcategoriesText && <Badge variant="outline" className="text-[10px]">{subcategoriesText}</Badge>}
              {anyActive
                ? <Badge className="text-[10px] bg-green-100 text-green-700">Active</Badge>
                : <Badge className="text-[10px] bg-gray-100 text-gray-500">Inactive</Badge>}
              <Badge variant="outline" className="text-[10px]">v{maxVersion}</Badge>
            </div>
            <button type="button" onClick={() => guardedNavigate(`/catalog/${productId}`)} className="text-left group">
              <h1 className="text-2xl font-bold group-hover:text-primary group-hover:underline transition-colors">{product?.name || repBom?.product_name}</h1>
              <p className="text-sm text-muted-foreground font-mono group-hover:text-primary">{product?.sku || repBom?.product_sku}</p>
            </button>
            <p className="text-xs text-muted-foreground mt-1">
              {productClass === 'packing' ? 'Packing process' : 'Full production process'} — {boms.length} layer{boms.length !== 1 ? 's' : ''}: {sortedBoms.map(b => LAYER_LABELS[b.bom_type]).join(' → ')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => guardedNavigate(`/catalog/${productId}`)}>
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

      {/* Tabs — Recipe/BOM vs Equipment capacity. Equipment rules are keyed by
          product_id, so they're the same records shown on the Product page's
          Equipment tab: add on either side and it appears on the other. */}
      <div className="flex gap-1 border-b border-border">
        {[
          { key: 'recipe', label: productClass === 'packing' ? 'Packing BOM' : 'Recipe / BOM', icon: productClass === 'packing' ? Package : ChefHat },
          { key: 'equipment', label: 'Equipment', icon: Wrench },
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'equipment' && (
        <ProductEquipmentTab productId={productId} productName={product?.name} productSku={product?.sku} />
      )}

      {activeTab === 'recipe' && (
      <>
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

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="sticky top-0 z-20 flex items-center justify-between bg-primary/10 border border-primary/30 rounded-lg px-4 py-2">
          <span className="text-sm font-medium">{selectedIds.size} ingredient{selectedIds.size !== 1 ? 's' : ''} selected</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={clearSelection}>Clear</Button>
            <Button variant="outline" size="sm" className="gap-1.5"
              onClick={() => { setBulkForm({ layer: '', step: '', qty: '', uom: '' }); setShowBulkEdit(true); }}>
              <Pencil className="w-3.5 h-3.5" /> Edit selected
            </Button>
            <Button variant="destructive" size="sm" className="gap-1.5" onClick={handleBulkDelete}>
              <Trash2 className="w-3.5 h-3.5" /> Delete selected
            </Button>
          </div>
        </div>
      )}

      {/* Process Flow — one editable card per layer (= BOM), in flow order */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Package className="w-4 h-4 text-primary" /> {productClass === 'packing' ? 'Packing — Contents & Steps' : 'Process Flow — Production Layers'}
        </h3>
        <p className="text-[11px] text-muted-foreground">Each layer is one BOM. Steps, ingredients and outputs below are exactly what runs on the floor for that layer.</p>

        {sortedBoms.map((bom, layerIdx) => {
          const stagedForDelete = pendingLayerDeletes.has(bom.id);
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
              {stagedForDelete ? (
              <div className="bg-destructive/5 border border-dashed border-destructive/40 rounded-xl p-5 flex items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={cn("text-[11px] px-2.5 py-0.5 line-through opacity-70", LAYER_COLORS[bom.bom_type])}>{LAYER_LABELS[bom.bom_type]} Layer</Badge>
                  <span className="text-sm font-medium text-destructive">Will be deleted when you save</span>
                  <span className="text-xs text-muted-foreground">
                    {ingredients.length} ingredient{ingredients.length !== 1 ? 's' : ''}, {(operationsByBom[bom.id] || []).length} step{(operationsByBom[bom.id] || []).length !== 1 ? 's' : ''}
                  </span>
                </div>
                <Button variant="outline" size="sm" className="gap-1.5"
                  onClick={() => unstageLayerDelete(bom.id)} disabled={saving}>
                  <X className="w-3.5 h-3.5" /> Undo
                </Button>
              </div>
              ) : (
              <div className="bg-card border border-border rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Badge className={cn("text-[11px] px-2.5 py-0.5", LAYER_COLORS[bom.bom_type])}>{LAYER_LABELS[bom.bom_type]} Layer</Badge>
                    <span className="text-xs text-muted-foreground">v{bom.version || 1}</span>
                    {bom.is_active === false && <Badge className="text-[10px] bg-gray-100 text-gray-500">Inactive draft</Badge>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button variant="outline" size="sm" className="gap-1.5"
                      onClick={() => toggleActive(bom)} disabled={saving}>
                      {bom.is_active === false
                        ? <><CheckCircle2 className="w-3.5 h-3.5" /> Activate</>
                        : <><AlertTriangle className="w-3.5 h-3.5" /> Set Inactive</>}
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive"
                      onClick={() => stageLayerDelete(bom.id)} disabled={saving}>
                      <Trash2 className="w-3.5 h-3.5" /> Delete layer
                    </Button>
                  </div>
                </div>

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
                  onOpenSubRecipe={(pid) => guardedNavigate(`/recipes/product/${pid}`)}
                  selectable
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                  onToggleSelectAll={toggleSelectAll}
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
              )}
            </React.Fragment>
          );
        })}

        {/* Add another layer — only the layer types allowed for this class, not yet created */}
        {allowedAddLayers.filter(l => !boms.find(b => b.bom_type === l)).length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            <span className="text-xs text-muted-foreground self-center">Add layer:</span>
            {allowedAddLayers.filter(l => !boms.find(b => b.bom_type === l)).map(layer => (
              <Button
                key={layer}
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => handleAddLayer(layer)}
                disabled={saving}
              >
                <Plus className="w-3.5 h-3.5" /> {LAYER_LABELS[layer]}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Consolidated ingredients overview — each ingredient once */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-1">
          <Utensils className="w-4 h-4 text-primary" /> All Ingredients (across layers)
        </h3>
        <p className="text-[11px] text-muted-foreground mb-3">Every ingredient used in this recipe, listed once. Edit quantities in each layer above.</p>
        {consolidatedIngredients.length === 0 ? (
          <p className="text-xs text-muted-foreground">No ingredients linked</p>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Layer(s)</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">SKU</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Ingredient</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Total Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {consolidatedIngredients.map(ing => {
                  const layers = [...ing.layers].sort((a, b) => layerRank(a) - layerRank(b));
                  const qtyText = Object.entries(ing.qtyByUom)
                    .map(([uom, q]) => `${q} ${uom}`).join(', ');
                  return (
                    <tr key={ing.key} className="hover:bg-muted/20">
                      <td className="px-3 py-2">
                        <span className="flex flex-wrap gap-1">
                          {layers.map(l => (
                            <span key={l} className={cn("text-[9px] px-1.5 py-0.5 rounded-full font-medium", LAYER_COLORS[l] || 'bg-muted text-muted-foreground')}>
                              {LAYER_LABELS[l] || l}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs font-mono">{ing.input_product_sku}</td>
                      <td className="px-3 py-2 text-xs">
                        <span className="inline-flex items-center gap-1.5">
                          {ing.input_product_name}
                          {subRecipeProductIds.has(ing.input_product_id) && (
                            <button type="button" onClick={() => guardedNavigate(`/recipes/product/${ing.input_product_id}`)}
                              className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline">
                              <ExternalLink className="w-3 h-3" /> recipe
                            </button>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-right tabular-nums">{qtyText}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
      </>
      )}

      {/* Sticky save bar */}
      {hasUnsavedChanges && (
        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-3 -mx-6 flex items-center justify-end gap-3">
          {pendingLayerDeletes.size > 0 && (
            <span className="text-xs font-medium text-destructive mr-auto flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              {pendingLayerDeletes.size} layer{pendingLayerDeletes.size !== 1 ? 's' : ''} will be permanently deleted on save.
            </span>
          )}
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

      {/* Bulk edit modal */}
      {showBulkEdit && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-lg font-bold">Edit {selectedComps.length} ingredient{selectedComps.length !== 1 ? 's' : ''}</h3>
              <Button variant="ghost" size="icon" onClick={() => setShowBulkEdit(false)}><X className="w-5 h-5" /></Button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-[11px] text-muted-foreground">Only the fields you set are changed. Leave a field as “Keep” / blank to leave it unchanged.</p>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Move to layer</label>
                <Select value={bulkForm.layer || 'keep'} onValueChange={v => setBulkForm(f => ({ ...f, layer: v === 'keep' ? '' : v, step: '' }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep">Keep current layer</SelectItem>
                    {availableLayers.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {bulkForm.layer && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Step (in {LAYER_LABELS[bulkForm.layer]} layer)</label>
                  <Select value={bulkForm.step || '0'} onValueChange={v => setBulkForm(f => ({ ...f, step: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Any step</SelectItem>
                      {bulkStepOptions.map(op => <SelectItem key={op.id} value={String(op.step_no)}>{op.step_no}. {op.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Set quantity</label>
                  <Input type="number" step="any" min="0" placeholder="Keep" value={bulkForm.qty}
                    onChange={e => setBulkForm(f => ({ ...f, qty: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Set UoM</label>
                  <Input placeholder="Keep" value={bulkForm.uom}
                    onChange={e => setBulkForm(f => ({ ...f, uom: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowBulkEdit(false)}>Cancel</Button>
              <Button className="flex-1 gap-2" onClick={applyBulkEdit} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />} Apply
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved-changes leave guard */}
      {pendingNav && (
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl border border-border w-full max-w-sm shadow-xl">
            <div className="px-6 py-5">
              <h3 className="text-lg font-bold mb-1">Unsaved changes</h3>
              <p className="text-sm text-muted-foreground">You have unsaved changes to this recipe. Save them before leaving?</p>
            </div>
            <div className="px-6 py-4 border-t border-border flex flex-col gap-2">
              <Button className="gap-2" disabled={saving}
                onClick={async () => { const to = pendingNav; await handleSave(); setPendingNav(null); navigate(to); }}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save &amp; leave
              </Button>
              <Button variant="outline" className="text-destructive hover:text-destructive"
                onClick={() => { const to = pendingNav; setPendingNav(null); navigate(to); }}>
                Leave without saving
              </Button>
              <Button variant="ghost" onClick={() => setPendingNav(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
