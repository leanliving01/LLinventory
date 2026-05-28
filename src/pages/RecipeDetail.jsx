import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Package, Utensils, Plus, Trash2, Save, Loader2, ArrowRightLeft, BookOpen, FileText, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import AddComponentModal from '@/components/recipes/AddComponentModal';
import OperationsEditor from '@/components/recipes/OperationsEditor';
import RecipeFilesEditor from '@/components/recipes/RecipeFilesEditor';
import ConfirmActionModal from '@/components/recipes/ConfirmActionModal';
import { getSubcategories, parseSubcategories, stringifySubcategories } from '@/lib/bomSubcategories';
import RecipeComponentTable from '@/components/recipes/RecipeComponentTable';

const LAYER_LABELS = { cook: 'Cook', portion: 'Portion', pack: 'Pack', prep: 'Prep' };
const LAYER_COLORS = {
  cook: 'bg-orange-100 text-orange-700',
  portion: 'bg-green-100 text-green-700',
  pack: 'bg-blue-100 text-blue-700',
  prep: 'bg-purple-100 text-purple-700',
};
const LAYER_DESC = {
  cook: 'Raw materials → Bulk cooked (WIP)',
  portion: 'Bulk cooked → Portioned meal',
  pack: 'Meals → Package',
  prep: 'Pre-processing step (e.g. prep work)',
};

export default function RecipeDetail() {
  const { bomId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [saving, setSaving] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [editedQtys, setEditedQtys] = useState({});
  const [editedSteps, setEditedSteps] = useState({});
  const [localFields, setLocalFields] = useState(null); // lazy-init from bom

  const { data: bom, isLoading: loadingBom } = useQuery({
    queryKey: ['bom-detail', bomId],
    queryFn: async () => {
      const results = await base44.entities.Bom.filter({ id: bomId });
      return results[0] || null;
    },
    enabled: !!bomId,
  });

  const { data: components = [], isLoading: loadingComps } = useQuery({
    queryKey: ['bom-components', bomId],
    queryFn: () => base44.entities.BomComponent.filter({ bom_id: bomId }),
    enabled: !!bomId,
  });

  const { data: operations = [] } = useQuery({
    queryKey: ['bom-operations', bomId],
    queryFn: () => base44.entities.BomOperation.filter({ bom_id: bomId }),
    enabled: !!bomId,
  });

  // Lazy-init local editable fields when bom loads
  React.useEffect(() => {
    if (bom && !localFields) {
      setLocalFields({
        yieldQty: String(bom.yield_qty || 1),
        yieldUom: bom.yield_uom || '',
        bomType: bom.bom_type,
        subcategory: bom.subcategory || '',
        chefNotes: bom.chef_notes || '',
        notes: bom.notes || '',
        files: bom.files || [],
      });
    }
  }, [bom, localFields]);

  if (loadingBom || !bom || !localFields) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { yieldQty, yieldUom, bomType, subcategory, chefNotes, notes, files } = localFields;
  const setField = (key, value) => setLocalFields(prev => ({ ...prev, [key]: value }));

  const ingredients = components.filter(c => !c.is_consumable);
  const consumables = components.filter(c => c.is_consumable);

  const handleStepChange = (compId, stepNo) => {
    setEditedSteps(prev => ({ ...prev, [compId]: stepNo }));
  };

  const hasUnsavedChanges = () => {
    const qtyChanged = Object.keys(editedQtys).length > 0;
    const stepChanged = Object.keys(editedSteps).length > 0;
    const yieldChanged = String(bom.yield_qty || 1) !== yieldQty || (bom.yield_uom || '') !== yieldUom;
    const typeChanged = bomType !== bom.bom_type;
    const subChanged = subcategory !== (bom.subcategory || '');
    const chefChanged = chefNotes !== (bom.chef_notes || '');
    const notesChanged = notes !== (bom.notes || '');
    const filesChanged = JSON.stringify(files) !== JSON.stringify(bom.files || []);
    return qtyChanged || stepChanged || yieldChanged || typeChanged || subChanged || chefChanged || notesChanged || filesChanged;
  };

  const handleSave = async () => {
    setSaving(true);

    try {
      const newYield = Number(yieldQty);
      const bomUpdate = {};
      if (newYield !== (bom.yield_qty || 1)) bomUpdate.yield_qty = newYield || 1;
      if (yieldUom !== (bom.yield_uom || '')) bomUpdate.yield_uom = yieldUom;
      if (bomType !== bom.bom_type) bomUpdate.bom_type = bomType;
      if (subcategory !== (bom.subcategory || '')) bomUpdate.subcategory = subcategory;
      if (chefNotes !== (bom.chef_notes || '')) bomUpdate.chef_notes = chefNotes;
      if (notes !== (bom.notes || '')) bomUpdate.notes = notes;
      if (JSON.stringify(files) !== JSON.stringify(bom.files || [])) bomUpdate.files = files;
      if (Object.keys(bomUpdate).length > 0) {
        await base44.entities.Bom.update(bom.id, bomUpdate);
      }
      for (const [compId, newQty] of Object.entries(editedQtys)) {
        const val = Number(newQty);
        if (isNaN(val) || val < 0) continue;
        await base44.entities.BomComponent.update(compId, { qty: val });
      }
      for (const [compId, stepNo] of Object.entries(editedSteps)) {
        await base44.entities.BomComponent.update(compId, { step_no: stepNo || null });
      }
      setEditedQtys({});
      setEditedSteps({});
      queryClient.invalidateQueries({ queryKey: ['bom-detail', bomId] });
      queryClient.invalidateQueries({ queryKey: ['bom-components', bomId] });
      queryClient.invalidateQueries({ queryKey: ['recipes-boms'] });
      // Reset local fields so they re-init from fresh bom
      setLocalFields(null);
      toast.success('Recipe saved');
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveComponent = (comp) => {
    setConfirmAction({
      type: 'delete_component', data: comp,
      title: 'Remove Ingredient',
      message: <span>Remove <strong>{comp.input_product_name}</strong> ({comp.input_product_sku}) from this recipe?</span>,
      confirmLabel: 'Remove Ingredient', icon: 'delete',
    });
  };

  const doRemoveComponent = async (comp) => {
    await base44.entities.BomComponent.delete(comp.id);
    queryClient.invalidateQueries({ queryKey: ['bom-components', bomId] });
    toast.success('Ingredient removed');
  };

  const handleDuplicateBom = async () => {
    setSaving(true);

    try {
      const newBom = await base44.entities.Bom.create({
        product_id: bom.product_id, product_name: bom.product_name, product_sku: bom.product_sku,
        bom_type: bom.bom_type, subcategory: bom.subcategory || undefined,
        yield_qty: bom.yield_qty || 1, yield_uom: bom.yield_uom || undefined,
        chef_notes: bom.chef_notes || undefined,
        notes: bom.notes ? `(Copy) ${bom.notes}` : '(Copy)',
        files: bom.files || [], version: (bom.version || 1) + 1, is_active: false,
      });
      const [comps, ops] = await Promise.all([
        base44.entities.BomComponent.filter({ bom_id: bom.id }),
        base44.entities.BomOperation.filter({ bom_id: bom.id }),
      ]);
      await Promise.all(comps.map(c => base44.entities.BomComponent.create({
        bom_id: newBom.id, input_product_id: c.input_product_id,
        input_product_name: c.input_product_name, input_product_sku: c.input_product_sku,
        qty: c.qty, uom: c.uom, is_consumable: c.is_consumable || false,
      })));
      await Promise.all(ops.map(o => base44.entities.BomOperation.create({
        bom_id: newBom.id, step_no: o.step_no, name: o.name, station: o.station,
        equipment_id: o.equipment_id || undefined, cycle_time_min: o.cycle_time_min || undefined,
        notes: o.notes || undefined,
      })));
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }

    queryClient.invalidateQueries({ queryKey: ['recipes-boms'] });
    toast.success(`Recipe duplicated as inactive`);
    navigate(`/recipes/${newBom.id}`);
  };

  const handleDeleteBom = () => {
    setConfirmAction({
      type: 'delete_bom', title: 'Delete Entire Recipe',
      message: <span>Permanently delete <strong>{bom.product_name}</strong> {LAYER_LABELS[bom.bom_type]} recipe and all {components.length} ingredients?</span>,
      confirmLabel: 'Delete Permanently', icon: 'delete',
    });
  };

  const doDeleteBom = async () => {
    const [comps, ops] = await Promise.all([
      base44.entities.BomComponent.filter({ bom_id: bom.id }),
      base44.entities.BomOperation.filter({ bom_id: bom.id }),
    ]);
    for (const c of comps) await base44.entities.BomComponent.delete(c.id);
    for (const o of ops) await base44.entities.BomOperation.delete(o.id);
    await base44.entities.Bom.delete(bom.id);
    queryClient.invalidateQueries({ queryKey: ['recipes-boms'] });
    toast.success('Recipe deleted');
    navigate('/recipes');
  };

  const handleLayerChange = (newType) => {
    if (newType === bomType) return;
    setConfirmAction({
      type: 'change_layer', data: newType,
      title: 'Move to Different Layer',
      message: <span>Move <strong>{bom.product_name}</strong> from <strong>{LAYER_LABELS[bomType]}</strong> to <strong>{LAYER_LABELS[newType]}</strong>? Press <strong>Save</strong> to apply.</span>,
      confirmLabel: `Move to ${LAYER_LABELS[newType]}`, confirmVariant: 'default', icon: 'move',
    });
  };

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    setSaving(true);
    if (confirmAction.type === 'delete_component') await doRemoveComponent(confirmAction.data);
    else if (confirmAction.type === 'delete_bom') await doDeleteBom();
    else if (confirmAction.type === 'change_layer') setField('bomType', confirmAction.data);
    setSaving(false);
    setConfirmAction(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/recipes')} className="mt-0.5">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge className={`text-[10px] ${LAYER_COLORS[bom.bom_type]}`}>{LAYER_LABELS[bom.bom_type]}</Badge>
              {bom.is_active
                ? <Badge className="text-[10px] bg-green-100 text-green-700">Active</Badge>
                : <Badge className="text-[10px] bg-gray-100 text-gray-500">Inactive</Badge>}
            </div>
            <h1 className="text-2xl font-bold">{bom.product_name}</h1>
            <p className="text-sm text-muted-foreground font-mono">{bom.product_sku}</p>
            <p className="text-xs text-muted-foreground mt-1">{LAYER_DESC[bom.bom_type]}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDuplicateBom} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />} Duplicate
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={handleDeleteBom}>
            <Trash2 className="w-4 h-4" /> Delete
          </Button>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column */}
        <div className="space-y-6">
          {/* Layer */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-3">
              <ArrowRightLeft className="w-4 h-4 text-primary" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Layer</span>
            </div>
            <Select value={bomType} onValueChange={handleLayerChange}>
              <SelectTrigger className="h-9 text-sm w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cook">Cook</SelectItem>
                <SelectItem value="portion">Portion</SelectItem>
                <SelectItem value="pack">Pack</SelectItem>
                <SelectItem value="prep">Prep</SelectItem>
              </SelectContent>
            </Select>
            {bomType !== bom.bom_type && (
              <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                <ArrowRightLeft className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                  Moving from {LAYER_LABELS[bom.bom_type]} → {LAYER_LABELS[bomType]}. Press <strong>Save</strong>.
                </p>
              </div>
            )}
            {getSubcategories(bomType).length > 0 && (
              <div className="pt-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Subcategory</span>
                <div className="flex flex-wrap gap-1.5">
                  {getSubcategories(bomType).map(sub => {
                    const active = parseSubcategories(subcategory).includes(sub);
                    return (
                      <button key={sub} onClick={() => {
                        const current = parseSubcategories(subcategory);
                        const next = active ? current.filter(s => s !== sub) : [...current, sub];
                        setField('subcategory', stringifySubcategories(next));
                      }}
                        className={`text-[11px] px-2.5 py-1 rounded-full font-medium border transition-all ${
                          active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/30'
                        }`}>{sub}</button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Yield */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <Package className="w-5 h-5 text-primary" />
              <span className="text-sm font-medium">Yield</span>
            </div>
            <div className="flex items-center gap-2">
              <Input type="number" step="any" min="0" value={yieldQty} onChange={e => setField('yieldQty', e.target.value)} className="w-28 h-9" />
              <Input value={yieldUom} onChange={e => setField('yieldUom', e.target.value)} placeholder="UoM" className="w-24 h-9" />
              <span className="text-xs text-muted-foreground">Version {bom.version || 1}</span>
            </div>
          </div>

          {/* Ingredients */}
          <RecipeComponentTable
            title="Ingredients" icon={<Utensils className="w-4 h-4 text-primary" />}
            components={ingredients.map(c => ({ ...c, step_no: editedSteps[c.id] !== undefined ? editedSteps[c.id] : (c.step_no || 0) }))}
            loading={loadingComps}
            editedQtys={editedQtys} onQtyChange={(id, v) => setEditedQtys(prev => ({ ...prev, [id]: v }))}
            onRemove={handleRemoveComponent} onAdd={() => setShowAddModal(true)}
            operations={operations} onStepChange={handleStepChange}
          />

          {/* Consumables */}
          {consumables.length > 0 && (
            <RecipeComponentTable
              title="Packaging / Consumables" icon={<Package className="w-4 h-4 text-muted-foreground" />}
              components={consumables.map(c => ({ ...c, step_no: editedSteps[c.id] !== undefined ? editedSteps[c.id] : (c.step_no || 0) }))}
              loading={loadingComps}
              editedQtys={editedQtys} onQtyChange={(id, v) => setEditedQtys(prev => ({ ...prev, [id]: v }))}
              onRemove={handleRemoveComponent} onAdd={() => setShowAddModal(true)}
              operations={operations} onStepChange={handleStepChange}
            />
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Steps */}
          <div className="bg-card border border-border rounded-xl p-5">
            <OperationsEditor bomId={bom.id} />
          </div>

          {/* Chef Notes */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
              <BookOpen className="w-4 h-4 text-primary" /> Chef Notes
            </h3>
            <p className="text-[10px] text-muted-foreground mb-1.5">Instructions shown to kitchen staff on the floor.</p>
            <Textarea value={chefNotes} onChange={e => setField('chefNotes', e.target.value)}
              placeholder="e.g. Sear chicken at 180°C until internal temp hits 74°C..."
              className="min-h-[140px] text-sm resize-none overflow-hidden"
              style={{ height: 'auto', minHeight: '140px' }}
              ref={el => { if (el) { el.style.height = 'auto'; el.style.height = Math.max(140, el.scrollHeight) + 'px'; } }}
            />
          </div>

          {/* General Notes */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
              <FileText className="w-4 h-4 text-muted-foreground" /> General Notes
            </h3>
            <Textarea value={notes} onChange={e => setField('notes', e.target.value)}
              placeholder="Internal notes about this recipe (not shown on floor)..."
              className="min-h-[140px] text-sm resize-none overflow-hidden"
              style={{ height: 'auto', minHeight: '140px' }}
              ref={el => { if (el) { el.style.height = 'auto'; el.style.height = Math.max(140, el.scrollHeight) + 'px'; } }}
            />
          </div>

          {/* Files */}
          <div className="bg-card border border-border rounded-xl p-5">
            <RecipeFilesEditor files={files} onChange={f => setField('files', f)} />
          </div>
        </div>
      </div>

      {/* Sticky save bar */}
      {hasUnsavedChanges() && (
        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-3 -mx-6 flex justify-end">
          <Button onClick={handleSave} disabled={saving} className="gap-2 min-w-[200px]">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      )}

      {showAddModal && (
        <AddComponentModal bomId={bom.id} existingProductIds={components.map(c => c.input_product_id)}
          onAdded={() => { queryClient.invalidateQueries({ queryKey: ['bom-components', bomId] }); setShowAddModal(false); toast.success('Ingredient added'); }}
          onCancel={() => setShowAddModal(false)} />
      )}

      {confirmAction && (
        <ConfirmActionModal title={confirmAction.title} message={confirmAction.message}
          confirmLabel={confirmAction.confirmLabel} confirmVariant={confirmAction.confirmVariant || 'destructive'}
          icon={confirmAction.icon} onConfirm={handleConfirmAction} onCancel={() => setConfirmAction(null)} loading={saving} />
      )}
    </div>
  );
}