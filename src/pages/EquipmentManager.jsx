import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Wrench, Plus, Trash2, Loader2, ArrowLeft, Search, X, Pencil, Check, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';

const STATUS_STYLES = {
  active: 'bg-green-100 text-green-700',
  maintenance: 'bg-amber-100 text-amber-700',
  retired: 'bg-muted text-muted-foreground',
};

const UOM_OPTIONS = ['g', 'kg', 'ml', 'L', 'pcs', 'trays'];

export default function EquipmentManager() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null); // equipment object to delete
  const [confirmEdit, setConfirmEdit] = useState(false); // show edit confirmation
  const [form, setForm] = useState({
    name: '', equipment_type: '', default_capacity: '', default_capacity_uom: 'kg',
    tray_count: '', per_tray_capacity: '', per_tray_uom: 'kg', notes: '',
  });

  const { data: equipment = [], isLoading } = useQuery({
    queryKey: ['equipment-all'],
    queryFn: () => base44.entities.Equipment.list('name', 200),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => base44.entities.Location.list(),
  });

  const filtered = search
    ? equipment.filter(e => e.name.toLowerCase().includes(search.toLowerCase()) || e.equipment_type?.toLowerCase().includes(search.toLowerCase()))
    : equipment;

  const handleCreate = async () => {
    if (!form.name || !form.equipment_type) {
      toast.error('Name and type are required');
      return;
    }
    setSaving(true);

    try {
      await base44.entities.Equipment.create({
        name: form.name,
        equipment_type: form.equipment_type,
        default_capacity: form.default_capacity ? Number(form.default_capacity) : undefined,
        default_capacity_uom: form.default_capacity_uom,
        tray_count: form.tray_count ? Number(form.tray_count) : undefined,
        per_tray_capacity: form.per_tray_capacity ? Number(form.per_tray_capacity) : undefined,
        per_tray_uom: form.per_tray_uom,
        notes: form.notes,
        status: 'active',
      });
      queryClient.invalidateQueries({ queryKey: ['equipment-all'] });
      queryClient.invalidateQueries({ queryKey: ['equipment-list'] });
      setForm({ name: '', equipment_type: '', default_capacity: '', default_capacity_uom: 'kg', tray_count: '', per_tray_capacity: '', per_tray_uom: 'kg', notes: '' });
      setAdding(false);
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }

    toast.success('Equipment added');
  };

  const handleDelete = async (id) => {
    await base44.entities.Equipment.delete(id);
    queryClient.invalidateQueries({ queryKey: ['equipment-all'] });
    queryClient.invalidateQueries({ queryKey: ['equipment-list'] });
    setConfirmDelete(null);
    toast.success('Equipment removed');
  };

  const handleStatusChange = async (id, status) => {
    await base44.entities.Equipment.update(id, { status });
    queryClient.invalidateQueries({ queryKey: ['equipment-all'] });
    queryClient.invalidateQueries({ queryKey: ['equipment-list'] });
    toast.success(`Status updated to ${status}`);
  };

  const startEdit = (eq) => {
    setEditingId(eq.id);
    setEditForm({
      name: eq.name || '',
      equipment_type: eq.equipment_type || '',
      default_capacity: eq.default_capacity ?? '',
      default_capacity_uom: eq.default_capacity_uom || 'kg',
      tray_count: eq.tray_count ?? '',
      per_tray_capacity: eq.per_tray_capacity ?? '',
      per_tray_uom: eq.per_tray_uom || 'kg',
      notes: eq.notes || '',
    });
  };

  // Compute what fields changed for the edit confirmation dialog
  const getEditChanges = () => {
    if (!editingId) return [];
    const original = equipment.find(e => e.id === editingId);
    if (!original) return [];
    const labels = {
      name: 'Name', equipment_type: 'Type', default_capacity: 'Default Capacity',
      default_capacity_uom: 'Capacity UoM', tray_count: 'Tray Count',
      per_tray_capacity: 'Per-Tray Capacity', per_tray_uom: 'Per-Tray UoM', notes: 'Notes',
    };
    const changes = [];
    Object.keys(labels).forEach(key => {
      const oldVal = (original[key] == null || original[key] === '') ? '' : String(original[key]);
      const newVal = (editForm[key] == null || editForm[key] === '') ? '' : String(editForm[key]);
      if (oldVal !== newVal) {
        changes.push({ label: labels[key], from: oldVal || '(empty)', to: newVal || '(empty)' });
      }
    });
    return changes;
  };
  const hasEditChanges = editingId ? getEditChanges().length > 0 : false;

  const handleSaveEdit = async () => {
    if (!editForm.name || !editForm.equipment_type) {
      toast.error('Name and type are required');
      return;
    }
    setConfirmEdit(false);
    setSaving(true);

    try {
      await base44.entities.Equipment.update(editingId, {
        name: editForm.name,
        equipment_type: editForm.equipment_type,
        default_capacity: editForm.default_capacity ? Number(editForm.default_capacity) : null,
        default_capacity_uom: editForm.default_capacity_uom,
        tray_count: editForm.tray_count ? Number(editForm.tray_count) : null,
        per_tray_capacity: editForm.per_tray_capacity ? Number(editForm.per_tray_capacity) : null,
        per_tray_uom: editForm.per_tray_uom,
        notes: editForm.notes,
      });
      queryClient.invalidateQueries({ queryKey: ['equipment-all'] });
      queryClient.invalidateQueries({ queryKey: ['equipment-list'] });
      setEditingId(null);
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }

    toast.success('Equipment updated');
  };

  // Get unique equipment types for suggestions
  const existingTypes = [...new Set(equipment.map(e => e.equipment_type).filter(Boolean))].sort();

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/settings">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Equipment</h1>
            <p className="text-sm text-muted-foreground">
              Manage kitchen equipment and their default capacities. Product-specific capacity rules are set on each product's Equipment tab.
            </p>
          </div>
        </div>
        <Button onClick={() => setAdding(!adding)} className="gap-1.5">
          <Plus className="w-4 h-4" /> Add Equipment
        </Button>
      </div>

      {/* Add form */}
      {adding && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold">New Equipment</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Name *</label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Ivario Rational 1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Type *</label>
              <Input
                value={form.equipment_type}
                onChange={e => setForm(f => ({ ...f, equipment_type: e.target.value }))}
                placeholder="e.g. Ivario, Oven, Pressure Cooker"
                list="eq-types"
              />
              <datalist id="eq-types">
                {existingTypes.map(t => <option key={t} value={t} />)}
              </datalist>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Default Capacity</label>
              <Input type="number" min="0" step="0.1" value={form.default_capacity} onChange={e => setForm(f => ({ ...f, default_capacity: e.target.value }))} placeholder="e.g. 20" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Capacity UoM</label>
              <Select value={form.default_capacity_uom} onValueChange={v => setForm(f => ({ ...f, default_capacity_uom: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UOM_OPTIONS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes</label>
              <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Tray Count (ovens)</label>
              <Input type="number" min="0" value={form.tray_count} onChange={e => setForm(f => ({ ...f, tray_count: e.target.value }))} placeholder="e.g. 10" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Per-Tray Capacity</label>
              <Input type="number" min="0" step="0.1" value={form.per_tray_capacity} onChange={e => setForm(f => ({ ...f, per_tray_capacity: e.target.value }))} placeholder="e.g. 5" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Per-Tray UoM</label>
              <Select value={form.per_tray_uom} onValueChange={v => setForm(f => ({ ...f, per_tray_uom: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UOM_OPTIONS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create
            </Button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search equipment..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        {search && <Button variant="ghost" size="sm" onClick={() => setSearch('')} className="gap-1"><X className="w-3.5 h-3.5" /> Clear</Button>}
        <Badge variant="outline">{filtered.length} equipment</Badge>
      </div>

      {/* Equipment list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-card border border-border rounded-xl">
          <Wrench className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No equipment defined yet.</p>
          <p className="text-sm text-muted-foreground mt-1">Add your kitchen equipment (ovens, pressure cookers, mixers, etc.) to enable capacity-based task splitting.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-[10px] text-muted-foreground uppercase">
                <th className="text-left px-4 py-2.5 font-semibold">Name</th>
                <th className="text-left px-3 py-2.5 font-semibold">Type</th>
                <th className="text-right px-3 py-2.5 font-semibold">Default Capacity</th>
                <th className="text-right px-3 py-2.5 font-semibold">Trays</th>
                <th className="text-center px-3 py-2.5 font-semibold">Status</th>
                <th className="text-left px-3 py-2.5 font-semibold">Notes</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(eq => (
                <React.Fragment key={eq.id}>
                  <tr className={editingId === eq.id ? 'bg-primary/5' : 'hover:bg-muted/20'}>
                    <td className="px-4 py-2.5 font-medium">
                      <div className="flex items-center gap-2">
                        <Wrench className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="whitespace-normal">{eq.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{eq.equipment_type}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {eq.default_capacity ? `${eq.default_capacity} ${eq.default_capacity_uom || ''}` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {eq.tray_count ? `${eq.tray_count} × ${eq.per_tray_capacity || '?'} ${eq.per_tray_uom || ''}` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <Select value={eq.status} onValueChange={v => handleStatusChange(eq.id, v)}>
                        <SelectTrigger className="h-7 text-xs w-28 mx-auto">
                          <Badge className={`${STATUS_STYLES[eq.status]} text-[10px]`}>{eq.status}</Badge>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="maintenance">Maintenance</SelectItem>
                          <SelectItem value="retired">Retired</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      <span className="block max-w-[200px] truncate" title={eq.notes || ''}>{eq.notes || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center gap-0.5 justify-end">
                        {editingId === eq.id ? (
                          <>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600 hover:text-green-700" onClick={() => {
                              if (!editForm.name || !editForm.equipment_type) { toast.error('Name and type are required'); return; }
                              setConfirmEdit(true);
                            }} disabled={saving}>
                              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => setEditingId(null)}>
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => startEdit(eq)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-600" onClick={() => setConfirmDelete(eq)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {editingId === eq.id && (
                    <tr className="bg-primary/5">
                      <td colSpan={7} className="px-4 py-4">
                        <div className="grid grid-cols-2 gap-3 mb-3">
                          <div>
                            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Name</label>
                            <Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className="h-9" placeholder="Name" />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Type</label>
                            <Input value={editForm.equipment_type} onChange={e => setEditForm(f => ({ ...f, equipment_type: e.target.value }))} className="h-9" placeholder="Type" list="eq-types-edit" />
                            <datalist id="eq-types-edit">{existingTypes.map(t => <option key={t} value={t} />)}</datalist>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3 mb-3">
                          <div>
                            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Default Capacity</label>
                            <div className="flex items-center gap-2">
                              <Input type="number" min="0" step="0.1" value={editForm.default_capacity} onChange={e => setEditForm(f => ({ ...f, default_capacity: e.target.value }))} className="h-9 flex-1" placeholder="e.g. 20" />
                              <Select value={editForm.default_capacity_uom} onValueChange={v => setEditForm(f => ({ ...f, default_capacity_uom: v }))}>
                                <SelectTrigger className="h-9 w-20"><SelectValue /></SelectTrigger>
                                <SelectContent>{UOM_OPTIONS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Tray Count</label>
                            <Input type="number" min="0" value={editForm.tray_count} onChange={e => setEditForm(f => ({ ...f, tray_count: e.target.value }))} className="h-9" placeholder="e.g. 10" />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Per-Tray Capacity</label>
                            <div className="flex items-center gap-2">
                              <Input type="number" min="0" step="0.1" value={editForm.per_tray_capacity} onChange={e => setEditForm(f => ({ ...f, per_tray_capacity: e.target.value }))} className="h-9 flex-1" placeholder="e.g. 5" />
                              <Select value={editForm.per_tray_uom} onValueChange={v => setEditForm(f => ({ ...f, per_tray_uom: v }))}>
                                <SelectTrigger className="h-9 w-20"><SelectValue /></SelectTrigger>
                                <SelectContent>{UOM_OPTIONS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                              </Select>
                            </div>
                          </div>
                        </div>
                        <div className="mb-3">
                          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Notes</label>
                          <Input value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} className="h-9" placeholder="Optional notes" />
                        </div>
                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                          <Button variant="outline" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
                          <Button size="sm" className="gap-1.5" disabled={saving || !hasEditChanges} onClick={() => {
                            if (!editForm.name || !editForm.equipment_type) { toast.error('Name and type are required'); return; }
                            setConfirmEdit(true);
                          }}>
                            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            Save Changes
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* Delete confirmation dialog */}
      <AlertDialog open={!!confirmDelete} onOpenChange={open => { if (!open) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" /> Delete Equipment
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{confirmDelete?.name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => handleDelete(confirmDelete.id)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit confirmation dialog */}
      <AlertDialog open={confirmEdit} onOpenChange={open => { if (!open) setConfirmEdit(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Pencil className="w-5 h-5 text-primary" /> Confirm Changes
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-3">Are you sure you want to save these changes?</p>
                {getEditChanges().length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No changes detected.</p>
                ) : (
                  <div className="space-y-2">
                    {getEditChanges().map((c, i) => (
                      <div key={i} className="bg-muted/50 rounded-lg px-3 py-2 text-sm">
                        <span className="font-semibold text-foreground">{c.label}:</span>{' '}
                        <span className="text-red-500 line-through">{c.from}</span>{' → '}
                        <span className="text-green-600 font-medium">{c.to}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSaveEdit} disabled={getEditChanges().length === 0}>
              Save Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}