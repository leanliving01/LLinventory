import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Wrench, Plus, Trash2, ChevronUp, ChevronDown, GripVertical, Loader2, Pencil, X, Check } from 'lucide-react';
import { toast } from 'sonner';
import ConfirmActionModal from '@/components/recipes/ConfirmActionModal';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

const STATIONS = ['prep', 'cook', 'portion', 'pack'];
const STATION_COLORS = {
  prep: 'bg-blue-100 text-blue-700',
  cook: 'bg-amber-100 text-amber-700',
  portion: 'bg-green-100 text-green-700',
  pack: 'bg-purple-100 text-purple-700',
};

export default function OperationsEditor({ bomId, defaultStation, ingredientsByStep = {} }) {
  const baseStation = defaultStation && STATIONS.includes(defaultStation) ? defaultStation : 'cook';
  const blankStep = { name: '', station: baseStation, cycle_time_min: '', notes: '', output_qty: '', output_uom: '' };
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [addingNew, setAddingNew] = useState(false);
  const [insertAfter, setInsertAfter] = useState(null); // step_no to insert after, or 0 for top
  const [newStep, setNewStep] = useState(blankStep);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  const { data: operations = [], isLoading } = useQuery({
    queryKey: ['bom-operations', bomId],
    queryFn: () => base44.entities.BomOperation.filter({ bom_id: bomId }),
  });

  const sorted = useMemo(() => [...operations].sort((a, b) => (a.step_no || 0) - (b.step_no || 0)), [operations]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['bom-operations', bomId] });

  // --- Reorder logic ---
  const reorderSteps = async (newOrder) => {
    setSaving(true);
    const updates = newOrder.map((op, idx) => 
      base44.entities.BomOperation.update(op.id, { step_no: idx + 1 })
    );
    await Promise.all(updates);
    invalidate();
    setSaving(false);
  };

  const handleDragEnd = (result) => {
    if (!result.destination || result.source.index === result.destination.index) return;
    const reordered = Array.from(sorted);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    reorderSteps(reordered);
  };

  const moveStep = (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= sorted.length) return;
    const reordered = Array.from(sorted);
    const [moved] = reordered.splice(index, 1);
    reordered.splice(newIndex, 0, moved);
    reorderSteps(reordered);
  };

  // --- CRUD ---
  const handleAddStep = async (afterIndex) => {
    if (!newStep.name.trim()) return;
    setSaving(true);

    try {
      // Calculate position: insert after the given index
      const position = afterIndex != null ? afterIndex + 1 : sorted.length;

      // Shift everything after the insert point
      const shiftsNeeded = sorted.filter((_, i) => i >= position);
      for (const op of shiftsNeeded.reverse()) {
        await base44.entities.BomOperation.update(op.id, { step_no: (sorted.indexOf(op) + 1) + 1 });
      }

      await base44.entities.BomOperation.create({
        bom_id: bomId,
        step_no: position + 1,
        name: newStep.name.trim(),
        station: newStep.station,
        cycle_time_min: newStep.cycle_time_min ? Number(newStep.cycle_time_min) : undefined,
        notes: newStep.notes || undefined,
        output_qty: newStep.output_qty ? Number(newStep.output_qty) : undefined,
        output_uom: newStep.output_uom || undefined,
      });

      setNewStep(blankStep);
      setAddingNew(false);
      setInsertAfter(null);
      invalidate();
      toast.success('Step added');
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    setSaving(true);

    try {
      await base44.entities.BomOperation.delete(confirmDelete.id);
      // Re-number remaining
      const remaining = sorted.filter(s => s.id !== confirmDelete.id);
      await Promise.all(remaining.map((op, i) => base44.entities.BomOperation.update(op.id, { step_no: i + 1 })));
      invalidate();
      toast.success('Step removed');
      setConfirmDelete(null);
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (op) => {
    setEditingId(op.id);
    setEditForm({
      name: op.name || '',
      station: op.station || baseStation,
      cycle_time_min: op.cycle_time_min ?? '',
      notes: op.notes || '',
      output_qty: op.output_qty ?? '',
      output_uom: op.output_uom || '',
    });
  };

  const saveEdit = async () => {
    if (!editForm.name.trim()) { toast.error('Step name is required'); return; }
    setSaving(true);

    try {
      await base44.entities.BomOperation.update(editingId, {
        name: editForm.name.trim(),
        station: editForm.station,
        cycle_time_min: editForm.cycle_time_min ? Number(editForm.cycle_time_min) : null,
        notes: editForm.notes || null,
        output_qty: editForm.output_qty ? Number(editForm.output_qty) : null,
        output_uom: editForm.output_uom || null,
      });
      setEditingId(null);
      invalidate();
      toast.success('Step updated');
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const showInsertForm = insertAfter !== null || addingNew;
  const insertIndex = insertAfter !== null ? insertAfter : sorted.length - 1;

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading steps...</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Wrench className="w-4 h-4 text-primary" />
          Steps ({sorted.length})
        </h3>
        <div className="flex items-center gap-1.5">
          {sorted.length > 0 && (
            <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={() => { setInsertAfter(-1); setAddingNew(false); }}>
              <Plus className="w-3 h-3" /> Insert at Top
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={() => { setAddingNew(true); setInsertAfter(null); }}>
            <Plus className="w-3 h-3" /> Add Step
          </Button>
        </div>
      </div>

      {sorted.length === 0 && !showInsertForm && (
        <p className="text-xs text-muted-foreground mb-3">No steps defined. Add steps to define the production workflow.</p>
      )}

      {/* Insert at top form */}
      {insertAfter === -1 && (
        <StepForm
          step={newStep}
          onChange={setNewStep}
          onSave={() => handleAddStep(-1)}
          onCancel={() => { setInsertAfter(null); setNewStep(blankStep); }}
          saving={saving}
          label="Insert at top"
        />
      )}

      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="operations">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-1.5">
              {sorted.map((op, index) => (
                <React.Fragment key={op.id}>
                  <Draggable draggableId={op.id} index={index}>
                    {(dragProvided, snapshot) => (
                      <div
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        className={`rounded-lg border transition-shadow ${snapshot.isDragging ? 'shadow-lg border-primary bg-card' : 'border-transparent bg-muted/30'}`}
                      >
                        {editingId === op.id ? (
                          <div className="p-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                                {index + 1}
                              </span>
                              <Input
                                value={editForm.name}
                                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                                className="h-8 text-sm font-medium flex-1"
                                placeholder="Step name"
                                autoFocus
                              />
                            </div>
                            <div className="flex items-center gap-2 pl-8">
                              <Select value={editForm.station} onValueChange={v => setEditForm(f => ({ ...f, station: v }))}>
                                <SelectTrigger className="h-7 text-xs w-28"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {STATIONS.map(s => <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>)}
                                </SelectContent>
                              </Select>
                              <Input
                                type="number"
                                placeholder="Time (min)"
                                value={editForm.cycle_time_min}
                                onChange={e => setEditForm(f => ({ ...f, cycle_time_min: e.target.value }))}
                                className="h-7 w-24 text-xs"
                              />
                              <span className="text-[10px] text-muted-foreground">min</span>
                            </div>
                            <div className="flex items-center gap-2 pl-8">
                              <span className="text-[10px] text-muted-foreground">Output →</span>
                              <Input
                                type="number"
                                placeholder="Qty"
                                value={editForm.output_qty}
                                onChange={e => setEditForm(f => ({ ...f, output_qty: e.target.value }))}
                                className="h-7 w-20 text-xs"
                              />
                              <Input
                                placeholder="UoM"
                                value={editForm.output_uom}
                                onChange={e => setEditForm(f => ({ ...f, output_uom: e.target.value }))}
                                className="h-7 w-20 text-xs"
                              />
                            </div>
                            <div className="pl-8">
                              <Textarea
                                placeholder="Instructions / notes (optional)"
                                value={editForm.notes}
                                onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                                className="text-xs min-h-[60px]"
                              />
                            </div>
                            <div className="flex gap-2 pl-8">
                              <Button size="sm" className="h-7 text-xs gap-1" onClick={saveEdit} disabled={saving || !editForm.name.trim()}>
                                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                Save
                              </Button>
                              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingId(null)}>Cancel</Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 px-2 py-2">
                            <div {...dragProvided.dragHandleProps} className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-foreground">
                              <GripVertical className="w-4 h-4" />
                            </div>
                            <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                              {index + 1}
                            </span>
                            <div className="flex-1 min-w-0 ml-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium truncate">{op.name}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize ${STATION_COLORS[op.station] || ''}`}>
                                  {op.station}
                                </span>
                                {op.cycle_time_min && (
                                  <span className="text-[10px] text-muted-foreground">{op.cycle_time_min} min</span>
                                )}
                              </div>
                              {op.notes && (
                                <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{op.notes}</p>
                              )}
                              {(ingredientsByStep[op.step_no] || []).length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {(ingredientsByStep[op.step_no] || []).map(ing => (
                                    <span key={ing.id} className="text-[9px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">
                                      {ing.input_product_name} {ing.qty}{ing.uom}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {(op.output_qty != null && op.output_qty !== '') && (
                                <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5 font-medium">
                                  Output → {op.output_qty} {op.output_uom || ''}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-0.5 shrink-0">
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => moveStep(index, -1)} disabled={index === 0 || saving}>
                                <ChevronUp className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => moveStep(index, 1)} disabled={index === sorted.length - 1 || saving}>
                                <ChevronDown className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => startEdit(op)}>
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setConfirmDelete(op)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </Draggable>

                  {/* Insert-after button between steps */}
                  {editingId == null && insertAfter !== index && (
                    <div className="flex justify-center py-0.5 opacity-0 hover:opacity-100 transition-opacity">
                      <button
                        className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1 px-2 py-0.5 rounded-full hover:bg-primary/5 transition-colors"
                        onClick={() => { setInsertAfter(index); setAddingNew(false); setNewStep(blankStep); }}
                      >
                        <Plus className="w-3 h-3" /> Insert here
                      </button>
                    </div>
                  )}

                  {/* Insert form after a specific step */}
                  {insertAfter === index && (
                    <StepForm
                      step={newStep}
                      onChange={setNewStep}
                      onSave={() => handleAddStep(index)}
                      onCancel={() => { setInsertAfter(null); setNewStep(blankStep); }}
                      saving={saving}
                      label={`Insert after step ${index + 1}`}
                    />
                  )}
                </React.Fragment>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {/* Add at bottom form */}
      {addingNew && insertAfter === null && (
        <div className="mt-2">
          <StepForm
            step={newStep}
            onChange={setNewStep}
            onSave={() => handleAddStep(sorted.length - 1)}
            onCancel={() => { setAddingNew(false); setNewStep(blankStep); }}
            saving={saving}
            label="Add to end"
          />
        </div>
      )}

      {confirmDelete && (
        <ConfirmActionModal
          title="Remove Step"
          message={
            <span>
              Are you sure you want to remove step <strong>"{confirmDelete.name}"</strong>?
              <br /><br />
              Remaining steps will be automatically re-numbered.
            </span>
          }
          confirmLabel="Remove Step"
          icon="delete"
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(null)}
          loading={saving}
        />
      )}
    </div>
  );
}

function StepForm({ step, onChange, onSave, onCancel, saving, label }) {
  return (
    <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-2 my-1.5">
      <p className="text-[10px] font-semibold text-primary uppercase tracking-wider">{label}</p>
      <Input
        placeholder="Step name (e.g. Wash Spinach, Marinate Chicken)"
        value={step.name}
        onChange={e => onChange(prev => ({ ...prev, name: e.target.value }))}
        className="h-8 text-sm"
        autoFocus
      />
      <div className="flex items-center gap-2">
        <Select value={step.station} onValueChange={v => onChange(prev => ({ ...prev, station: v }))}>
          <SelectTrigger className="h-7 text-xs w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATIONS.map(s => <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          type="number"
          placeholder="Time (min)"
          value={step.cycle_time_min}
          onChange={e => onChange(prev => ({ ...prev, cycle_time_min: e.target.value }))}
          className="h-7 w-24 text-xs"
        />
        <span className="text-[10px] text-muted-foreground">min</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground">Output →</span>
        <Input
          type="number"
          placeholder="Qty"
          value={step.output_qty}
          onChange={e => onChange(prev => ({ ...prev, output_qty: e.target.value }))}
          className="h-7 w-20 text-xs"
        />
        <Input
          placeholder="UoM"
          value={step.output_uom}
          onChange={e => onChange(prev => ({ ...prev, output_uom: e.target.value }))}
          className="h-7 w-20 text-xs"
        />
        <span className="text-[10px] text-muted-foreground">into next stage</span>
      </div>
      <Textarea
        placeholder="Instructions / notes (optional)"
        value={step.notes}
        onChange={e => onChange(prev => ({ ...prev, notes: e.target.value }))}
        className="text-xs min-h-[50px]"
      />
      <div className="flex gap-2 pt-1">
        <Button size="sm" className="h-7 text-xs gap-1" onClick={onSave} disabled={saving || !step.name.trim()}>
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          Add
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}