import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Loader2, Ruler, ArrowRightLeft } from 'lucide-react';
import { toast } from 'sonner';
import BulkPurchaseUomEditor from './BulkPurchaseUomEditor';

const CATEGORY_LABELS = {
  weight: 'Weight',
  volume: 'Volume',
  length: 'Length',
  count: 'Count',
  other: 'Other',
};

const CATEGORY_COLORS = {
  weight: 'bg-blue-100 text-blue-700',
  volume: 'bg-purple-100 text-purple-700',
  length: 'bg-green-100 text-green-700',
  count: 'bg-orange-100 text-orange-700',
  other: 'bg-gray-100 text-gray-700',
};

export default function SettingsUomTab() {
  const queryClient = useQueryClient();
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('other');
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [showBulkEditor, setShowBulkEditor] = useState(false);

  const { data: uoms = [], isLoading } = useQuery({
    queryKey: ['uom-list'],
    queryFn: () => base44.entities.UnitOfMeasure.list('code', 200),
  });

  const handleAdd = async () => {
    if (!newCode.trim()) return;
    // Check for duplicate
    if (uoms.some(u => u.code.toLowerCase() === newCode.trim().toLowerCase())) {
      toast.error(`Unit "${newCode.trim()}" already exists`);
      return;
    }
    setAdding(true);
    await base44.entities.UnitOfMeasure.create({
      code: newCode.trim(),
      name: newName.trim() || newCode.trim(),
      category: newCategory,
      is_default: false,
    });
    queryClient.invalidateQueries({ queryKey: ['uom-list'] });
    setNewCode('');
    setNewName('');
    toast.success(`Unit "${newCode.trim()}" added`);
    setAdding(false);
  };

  const handleDelete = async (uom) => {
    if (uom.is_default) {
      toast.error('Cannot delete a system default unit');
      return;
    }
    setDeleting(uom.id);
    await base44.entities.UnitOfMeasure.delete(uom.id);
    queryClient.invalidateQueries({ queryKey: ['uom-list'] });
    toast.success(`Unit "${uom.code}" deleted`);
    setDeleting(null);
  };

  // Group by category
  const grouped = {};
  uoms.forEach(u => {
    if (!grouped[u.category]) grouped[u.category] = [];
    grouped[u.category].push(u);
  });

  if (showBulkEditor) {
    return <BulkPurchaseUomEditor onBack={() => setShowBulkEditor(false)} />;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Bulk Purchase UoM Editor */}
      <div className="bg-card border border-border rounded-xl p-5 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-primary" /> Purchase UoM Conversions
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Bulk-edit the buying unit and stock conversion factor for all products
          </p>
        </div>
        <Button variant="outline" onClick={() => setShowBulkEditor(true)} className="gap-2">
          <ArrowRightLeft className="w-4 h-4" /> Edit Conversions
        </Button>
      </div>

      {/* Add new */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Plus className="w-4 h-4 text-muted-foreground" /> Add New Unit of Measure
        </h3>
        <div className="flex gap-2 flex-wrap">
          <Input
            placeholder="Code (e.g. m)"
            value={newCode}
            onChange={e => setNewCode(e.target.value)}
            className="w-24"
          />
          <Input
            placeholder="Full name (e.g. Metres)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="flex-1 min-w-[140px]"
          />
          <Select value={newCategory} onValueChange={setNewCategory}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleAdd} disabled={adding || !newCode.trim()} className="gap-1.5">
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add
          </Button>
        </div>
      </div>

      {/* Existing units by category */}
      {isLoading ? (
        <div className="text-center py-8 text-sm text-muted-foreground">Loading units...</div>
      ) : (
        Object.entries(CATEGORY_LABELS).map(([cat, label]) => {
          const items = grouped[cat] || [];
          if (items.length === 0) return null;
          return (
            <div key={cat} className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
                <Ruler className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">{label}</h3>
                <Badge variant="outline" className="text-[10px]">{items.length}</Badge>
              </div>
              <div className="divide-y divide-border">
                {items.map(u => (
                  <div key={u.id} className="px-5 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-mono font-bold w-12">{u.code}</span>
                      <span className="text-sm text-muted-foreground">{u.name}</span>
                      {u.is_default && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">System</Badge>
                      )}
                    </div>
                    {!u.is_default && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-red-600"
                        onClick={() => handleDelete(u)}
                        disabled={deleting === u.id}
                      >
                        {deleting === u.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5" />}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}