import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { X, Package, Utensils, Plus, Trash2, Save, Loader2, ArrowRightLeft, BookOpen, FileText, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import AddComponentModal from '@/components/recipes/AddComponentModal';
import OperationsEditor from '@/components/recipes/OperationsEditor';
import RecipeFilesEditor from '@/components/recipes/RecipeFilesEditor';
import ConfirmActionModal from '@/components/recipes/ConfirmActionModal';
import { getSubcategories } from '@/lib/bomSubcategories';

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

export default function RecipeDetailDrawer({ bom, onClose, onUpdated }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // { type, data }
  const [editedQtys, setEditedQtys] = useState({});
  const [yieldQty, setYieldQty] = useState(String(bom.yield_qty || 1));
  const [yieldUom, setYieldUom] = useState(bom.yield_uom || '');
  const [bomType, setBomType] = useState(bom.bom_type);
  const [subcategory, setSubcategory] = useState(bom.subcategory || '');
  const [chefNotes, setChefNotes] = useState(bom.chef_notes || '');
  const [notes, setNotes] = useState(bom.notes || '');
  const [files, setFiles] = useState(bom.files || []);

  const { data: components = [], isLoading: loadingComps } = useQuery({
    queryKey: ['bom-components', bom.id],
    queryFn: () => base44.entities.BomComponent.filter({ bom_id: bom.id }),
  });

  const ingredients = components.filter(c => !c.is_consumable);
  const consumables = components.filter(c => c.is_consumable);

  const handleQtyChange = (compId, value) => {
    setEditedQtys(prev => ({ ...prev, [compId]: value }));
  };

  const hasUnsavedChanges = () => {
    const qtyChanged = Object.keys(editedQtys).length > 0;
    const yieldChanged = String(bom.yield_qty || 1) !== yieldQty || (bom.yield_uom || '') !== yieldUom;
    const typeChanged = bomType !== bom.bom_type;
    const subChanged = subcategory !== (bom.subcategory || '');
    const chefChanged = chefNotes !== (bom.chef_notes || '');
    const notesChanged = notes !== (bom.notes || '');
    const filesChanged = JSON.stringify(files) !== JSON.stringify(bom.files || []);
    return qtyChanged || yieldChanged || typeChanged || subChanged || chefChanged || notesChanged || filesChanged;
  };

  const handleSave = async () => {
    setSaving(true);

    // Save yield + type changes
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

    // Save component qty changes
    for (const [compId, newQty] of Object.entries(editedQtys)) {
      const val = Number(newQty);
      if (isNaN(val) || val < 0) continue;
      await base44.entities.BomComponent.update(compId, { qty: val });
    }

    setEditedQtys({});
    queryClient.invalidateQueries({ queryKey: ['bom-components', bom.id] });
    onUpdated?.();
    toast.success('BOM saved');
    setSaving(false);
  };

  const handleRemoveComponent = (comp) => {
    setConfirmAction({
      type: 'delete_component',
      data: comp,
      title: 'Remove Ingredient',
      message: (
        <span>
          Are you sure you want to remove <strong>{comp.input_product_name}</strong> ({comp.input_product_sku}) from this recipe?
          <br /><br />
          This ingredient will be permanently removed and won't appear in future production tasks for this product.
        </span>
      ),
      confirmLabel: 'Remove Ingredient',
      icon: 'delete',
    });
  };

  const doRemoveComponent = async (comp) => {
    await base44.entities.BomComponent.delete(comp.id);
    queryClient.invalidateQueries({ queryKey: ['bom-components', bom.id] });
    toast.success('Ingredient removed');
  };

  const handleComponentAdded = () => {
    queryClient.invalidateQueries({ queryKey: ['bom-components', bom.id] });
    setShowAddModal(false);
    toast.success('Ingredient added');
  };

  const handleDeleteBom = () => {
    setConfirmAction({
      type: 'delete_bom',
      title: 'Delete Entire Recipe',
      message: (
        <span>
          Are you sure you want to delete the <strong>{bom.product_name}</strong> {LAYER_LABELS[bom.bom_type]} recipe?
          <br /><br />
          This will <strong>permanently delete</strong> the recipe along with all {components.length} ingredient{components.length !== 1 ? 's' : ''} and all production steps. This cannot be undone.
        </span>
      ),
      confirmLabel: 'Delete Permanently',
      icon: 'delete',
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
    onUpdated?.();
    onClose();
    toast.success('Recipe deleted');
  };

  const handleLayerChange = (newType) => {
    if (newType === bomType) return;
    setConfirmAction({
      type: 'change_layer',
      data: newType,
      title: 'Move to Different Layer',
      message: (
        <span>
          Are you sure you want to move <strong>{bom.product_name}</strong> from <strong>{LAYER_LABELS[bomType]}</strong> to <strong>{LAYER_LABELS[newType]}</strong>?
          <br /><br />
          This will change which production stage this recipe belongs to:
          <br />• <strong>{LAYER_LABELS[bomType]}:</strong> {LAYER_DESC[bomType]}
          <br />• <strong>{LAYER_LABELS[newType]}:</strong> {LAYER_DESC[newType]}
          <br /><br />
          All ingredients and steps will be kept. You'll still need to press <strong>Save</strong> to apply this change.
        </span>
      ),
      confirmLabel: `Move to ${LAYER_LABELS[newType]}`,
      confirmVariant: 'default',
      icon: 'move',
    });
  };

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    setSaving(true);
    if (confirmAction.type === 'delete_component') {
      await doRemoveComponent(confirmAction.data);
    } else if (confirmAction.type === 'delete_bom') {
      await doDeleteBom();
    } else if (confirmAction.type === 'change_layer') {
      setBomType(confirmAction.data);
    }
    setSaving(false);
    setConfirmAction(null);
  };

  const renderComponentTable = (comps, title, icon) => (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          {icon}
          {title} ({comps.length})
        </h3>
        <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={() => setShowAddModal(true)}>
          <Plus className="w-3 h-3" /> Add
        </Button>
      </div>
      {loadingComps ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : comps.length === 0 ? (
        <p className="text-xs text-muted-foreground">No ingredients linked</p>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">SKU</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Name</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Qty</th>
                <th className="text-center px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">UoM</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {comps.map(c => {
                const editedVal = editedQtys[c.id];
                const currentQty = editedVal !== undefined ? editedVal : String(c.qty);
                const isChanged = editedVal !== undefined && Number(editedVal) !== c.qty;
                return (
                  <tr key={c.id} className={cn("hover:bg-muted/20", isChanged && "bg-amber-50 dark:bg-amber-900/10")}>
                    <td className="px-3 py-2 text-xs font-mono">{c.input_product_sku}</td>
                    <td className="px-3 py-2 text-xs">{c.input_product_name}</td>
                    <td className="px-3 py-1.5 text-right">
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        value={currentQty}
                        onChange={e => handleQtyChange(c.id, e.target.value)}
                        className={cn("w-20 h-7 text-right text-xs ml-auto", isChanged && "border-amber-400")}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-center">{c.uom}</td>
                    <td className="px-1 py-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemoveComponent(c)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-card shadow-xl flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-start justify-between z-10 shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge className={`text-[10px] ${LAYER_COLORS[bom.bom_type]}`}>
                {LAYER_LABELS[bom.bom_type]}
              </Badge>
              {bom.is_active ? (
                <Badge className="text-[10px] bg-green-100 text-green-700">Active</Badge>
              ) : (
                <Badge className="text-[10px] bg-gray-100 text-gray-500">Inactive</Badge>
              )}
            </div>
            <h2 className="text-lg font-bold">{bom.product_name}</h2>
            <p className="text-xs text-muted-foreground font-mono">{bom.product_sku}</p>
            <p className="text-xs text-muted-foreground mt-1">{LAYER_DESC[bom.bom_type]}</p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={handleDeleteBom} title="Delete this BOM">
              <Trash2 className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {/* Layer type — editable */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-3">
              <ArrowRightLeft className="w-4 h-4 text-primary" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Layer</span>
            </div>
            <Select value={bomType} onValueChange={handleLayerChange}>
              <SelectTrigger className="h-8 text-sm w-36">
                <SelectValue />
              </SelectTrigger>
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
                  Moving from {LAYER_LABELS[bom.bom_type]} → {LAYER_LABELS[bomType]}. Press <strong>Save</strong> to apply.
                </p>
              </div>
            )}

            {/* Subcategory */}
            {getSubcategories(bomType).length > 0 && (
              <div className="pt-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Subcategory</span>
                <div className="flex flex-wrap gap-1.5">
                  {getSubcategories(bomType).map(sub => (
                    <button
                      key={sub}
                      onClick={() => setSubcategory(subcategory === sub ? '' : sub)}
                      className={`text-[11px] px-2.5 py-1 rounded-full font-medium border transition-all ${
                        subcategory === sub
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:bg-muted/30'
                      }`}
                    >
                      {sub}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Yield — editable */}
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="flex items-center gap-3 mb-2">
              <Package className="w-5 h-5 text-primary" />
              <span className="text-sm font-medium">Yield</span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="any"
                min="0"
                value={yieldQty}
                onChange={e => setYieldQty(e.target.value)}
                className="w-24 h-8 text-sm"
              />
              <Input
                value={yieldUom}
                onChange={e => setYieldUom(e.target.value)}
                placeholder="UoM"
                className="w-20 h-8 text-sm"
              />
              <span className="text-xs text-muted-foreground">Version {bom.version || 1}</span>
            </div>
          </div>

          {/* Ingredients */}
          {renderComponentTable(ingredients, 'Ingredients', <Utensils className="w-4 h-4 text-primary" />)}

          {/* Consumables */}
          {consumables.length > 0 && renderComponentTable(consumables, 'Packaging / Consumables', <Package className="w-4 h-4 text-muted-foreground" />)}

          {/* Operations — full editor */}
          <OperationsEditor bomId={bom.id} />

          {/* Chef Notes — editable */}
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
              <BookOpen className="w-4 h-4 text-primary" />
              Chef Notes
            </h3>
            <p className="text-[10px] text-muted-foreground mb-1.5">Instructions shown to kitchen staff on the floor (cook times, seasoning tips, critical temps).</p>
            <Textarea
              value={chefNotes}
              onChange={e => setChefNotes(e.target.value)}
              placeholder="e.g. Sear chicken at 180°C until internal temp hits 74°C. Rest 5 min before slicing..."
              className="min-h-[80px] text-sm"
            />
          </div>

          {/* Recipe Notes — editable */}
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
              <FileText className="w-4 h-4 text-muted-foreground" />
              General Notes
            </h3>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Internal notes about this recipe (not shown on floor)..."
              className="min-h-[60px] text-sm"
            />
          </div>

          {/* Files — upload + manage */}
          <RecipeFilesEditor files={files} onChange={setFiles} />
        </div>

        {/* Footer — save button */}
        {hasUnsavedChanges() && (
          <div className="sticky bottom-0 bg-card border-t border-border px-6 py-3 shrink-0">
            <Button onClick={handleSave} disabled={saving} className="w-full gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        )}
      </div>

      {/* Add component modal */}
      {showAddModal && (
        <AddComponentModal
          bomId={bom.id}
          existingProductIds={components.map(c => c.input_product_id)}
          onAdded={handleComponentAdded}
          onCancel={() => setShowAddModal(false)}
        />
      )}

      {/* Confirmation modal */}
      {confirmAction && (
        <ConfirmActionModal
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.confirmLabel}
          confirmVariant={confirmAction.confirmVariant || 'destructive'}
          icon={confirmAction.icon}
          onConfirm={handleConfirmAction}
          onCancel={() => setConfirmAction(null)}
          loading={saving}
        />
      )}
    </div>
  );
}