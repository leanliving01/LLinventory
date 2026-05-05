import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, ChevronDown, ChevronRight, Loader2, FolderTree, Tag } from 'lucide-react';
import { toast } from 'sonner';

const TYPE_LABELS = {
  raw: 'Raw Material',
  packaging: 'Packaging',
  wip_bulk: 'Bulk Cooked',
  finished_meal: 'Finished Meal',
  supplement: 'Supplement',
  package: 'Package',
  sauce: 'Sauce',
  solo_serve: 'Solo Serve',
  bundle: 'Bundle',
  service: 'Service',
};

const TYPE_OPTIONS = Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }));

export default function SettingsCategoriesTab() {
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState('all');
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState('raw');
  const [addingCat, setAddingCat] = useState(false);
  const [expandedCats, setExpandedCats] = useState({});
  const [newSubNames, setNewSubNames] = useState({});
  const [addingSub, setAddingSub] = useState({});

  const { data: categories = [], isLoading: loadingCats } = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => base44.entities.ProductCategory.filter({ is_active: true }, 'sort_order', 200),
  });

  const { data: subcategories = [], isLoading: loadingSubs } = useQuery({
    queryKey: ['product-subcategories'],
    queryFn: () => base44.entities.ProductSubcategory.filter({ is_active: true }, 'sort_order', 500),
  });

  const filteredCats = typeFilter === 'all'
    ? categories
    : categories.filter(c => c.product_type === typeFilter);

  const subsByCategory = {};
  subcategories.forEach(s => {
    if (!subsByCategory[s.category_id]) subsByCategory[s.category_id] = [];
    subsByCategory[s.category_id].push(s);
  });

  const toggleCat = (id) => setExpandedCats(prev => ({ ...prev, [id]: !prev[id] }));

  const handleAddCategory = async () => {
    if (!newCatName.trim()) return;
    setAddingCat(true);
    await base44.entities.ProductCategory.create({
      name: newCatName.trim(),
      product_type: newCatType,
      sort_order: categories.filter(c => c.product_type === newCatType).length,
    });
    queryClient.invalidateQueries({ queryKey: ['product-categories'] });
    toast.success(`Category "${newCatName.trim()}" created`);
    setNewCatName('');
    setAddingCat(false);
  };

  const handleDeleteCategory = async (cat) => {
    const subs = subsByCategory[cat.id] || [];
    if (subs.length > 0) {
      toast.error(`Remove all ${subs.length} subcategories first`);
      return;
    }
    await base44.entities.ProductCategory.update(cat.id, { is_active: false });
    queryClient.invalidateQueries({ queryKey: ['product-categories'] });
    toast.success(`Category "${cat.name}" removed`);
  };

  const handleAddSubcategory = async (cat) => {
    const name = (newSubNames[cat.id] || '').trim();
    if (!name) return;
    setAddingSub(prev => ({ ...prev, [cat.id]: true }));
    await base44.entities.ProductSubcategory.create({
      name,
      category_id: cat.id,
      category_name: cat.name,
      product_type: cat.product_type,
      sort_order: (subsByCategory[cat.id] || []).length,
    });
    queryClient.invalidateQueries({ queryKey: ['product-subcategories'] });
    toast.success(`Subcategory "${name}" added under "${cat.name}"`);
    setNewSubNames(prev => ({ ...prev, [cat.id]: '' }));
    setAddingSub(prev => ({ ...prev, [cat.id]: false }));
  };

  const handleDeleteSubcategory = async (sub) => {
    await base44.entities.ProductSubcategory.update(sub.id, { is_active: false });
    queryClient.invalidateQueries({ queryKey: ['product-subcategories'] });
    toast.success(`Subcategory "${sub.name}" removed`);
  };

  if (loadingCats || loadingSubs) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h3 className="text-lg font-bold flex items-center gap-2">
          <FolderTree className="w-5 h-5" /> Product Categories
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Manage categories and subcategories. Products are grouped by these in the catalog.
        </p>
      </div>

      {/* Filter by type */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">Filter by type:</span>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {TYPE_OPTIONS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Add new category */}
      <div className="flex items-end gap-3 bg-muted/30 border border-border rounded-xl p-4">
        <div className="flex-1 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">New Category Name</label>
          <Input
            placeholder="e.g. Frozen Proteins"
            value={newCatName}
            onChange={e => setNewCatName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
          />
        </div>
        <div className="w-48 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Product Type</label>
          <Select value={newCatType} onValueChange={setNewCatType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleAddCategory} disabled={addingCat || !newCatName.trim()} className="gap-1.5">
          {addingCat ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Add
        </Button>
      </div>

      {/* Category list */}
      {filteredCats.length === 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No categories yet. Add one above to get started.
        </p>
      )}

      <div className="space-y-2">
        {filteredCats.map(cat => {
          const subs = subsByCategory[cat.id] || [];
          const isOpen = expandedCats[cat.id];

          return (
            <div key={cat.id} className="border border-border rounded-xl overflow-hidden">
              {/* Category header */}
              <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
                <button onClick={() => toggleCat(cat.id)} className="shrink-0">
                  {isOpen
                    ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    : <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  }
                </button>
                <FolderTree className="w-4 h-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold">{cat.name}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">
                    {TYPE_LABELS[cat.product_type]} · {subs.length} subcategories
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8 text-destructive hover:text-destructive"
                  onClick={() => handleDeleteCategory(cat)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>

              {/* Subcategories */}
              {isOpen && (
                <div className="px-4 py-3 space-y-2 border-t border-border bg-card">
                  {subs.map(sub => (
                    <div key={sub.id} className="flex items-center gap-3 pl-6">
                      <Tag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm flex-1">{sub.name}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-7 h-7 text-destructive hover:text-destructive"
                        onClick={() => handleDeleteSubcategory(sub)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}

                  {subs.length === 0 && (
                    <p className="text-xs text-muted-foreground pl-6">No subcategories yet.</p>
                  )}

                  {/* Add subcategory inline */}
                  <div className="flex items-center gap-2 pl-6 pt-1">
                    <Input
                      placeholder="New subcategory name..."
                      value={newSubNames[cat.id] || ''}
                      onChange={e => setNewSubNames(prev => ({ ...prev, [cat.id]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && handleAddSubcategory(cat)}
                      className="h-8 text-sm"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAddSubcategory(cat)}
                      disabled={addingSub[cat.id] || !(newSubNames[cat.id] || '').trim()}
                      className="gap-1 h-8"
                    >
                      {addingSub[cat.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                      Add
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}