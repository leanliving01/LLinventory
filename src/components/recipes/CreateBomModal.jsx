import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Plus, Loader2, Search, ChefHat, Package } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import PackColorPicker from '@/components/recipes/PackColorPicker';
import { parseSubcategories, stringifySubcategories } from '@/lib/bomSubcategories';
import { useBomSubcategories } from '@/lib/useSubcategories';

// Two top-level kinds of BOM.
const BOM_CLASSES = [
  {
    value: 'production',
    icon: ChefHat,
    title: 'Production BOM',
    desc: 'Physically made — raw materials are cooked, processed & portioned. Raw → Cook (WIP) → Portion → Plate.',
  },
  {
    value: 'packing',
    icon: Package,
    title: 'Packing BOM',
    desc: 'Finished goods assembled & packed into a box for distribution. Finished meals → Packed box.',
  },
];

// Stages within a Production BOM (the physical make). Packing is always the 'pack' stage.
const PRODUCTION_STAGES = [
  { value: 'prep', label: 'Prep', desc: 'Pre-processing step (e.g. prep work)' },
  { value: 'cook', label: 'Cook', desc: 'Raw materials → Bulk cooked (WIP)' },
  { value: 'portion', label: 'Portion', desc: 'Bulk cooked → Portioned meal' },
];

export default function CreateBomModal({ onCreated, onCancel, defaults }) {
  const initialClass = defaults?.bomType === 'pack' ? 'packing' : 'production';
  const initialStage = ['prep', 'cook', 'portion'].includes(defaults?.bomType) ? defaults.bomType : 'cook';

  const [bomClass, setBomClass] = useState(initialClass);
  const [bomType, setBomType] = useState(initialStage); // production stage only; packing forces 'pack'
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [search, setSearch] = useState('');
  const [yieldQty, setYieldQty] = useState('1');
  const [yieldUom, setYieldUom] = useState(initialClass === 'packing' ? 'box' : '');
  const [notes, setNotes] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [packColor, setPackColor] = useState('');
  const [creating, setCreating] = useState(false);

  // The actual bom_type stored: packing is always the 'pack' stage.
  const effectiveBomType = bomClass === 'packing' ? 'pack' : bomType;

  // Subcategory options per layer (pack = DB-driven catalog meal ranges).
  const getBomSubcategories = useBomSubcategories();
  const subcategoryOptions = getBomSubcategories(effectiveBomType);

  const { data: products = [] } = useQuery({
    queryKey: ['products-for-bom-create'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });

  // Auto-select product from defaults (deep-link from Product page)
  React.useEffect(() => {
    if (defaults?.productId && products.length > 0 && !selectedProduct) {
      const match = products.find(p => p.id === defaults.productId);
      if (match) {
        setSelectedProduct(match);
        setYieldUom(match.stock_uom || (bomClass === 'packing' ? 'box' : ''));
      }
    }
  }, [defaults, products]);

  const filtered = useMemo(() => {
    const available = products;
    if (!search.trim()) return available.slice(0, 50);
    const q = search.toLowerCase();
    return available.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q)
    ).slice(0, 50);
  }, [products, search]);

  // Switching the top-level type resets the (class-specific) subcategory.
  const selectClass = (cls) => {
    if (cls === bomClass) return;
    setBomClass(cls);
    setSubcategory('');
    if (cls === 'packing') {
      if (!yieldUom) setYieldUom('box');
    }
  };

  const handleCreate = async () => {
    if (!selectedProduct) return;
    setCreating(true);
    const bomData = {
      product_id: selectedProduct.id,
      product_name: selectedProduct.name,
      product_sku: selectedProduct.sku,
      bom_type: effectiveBomType,
      bom_class: bomClass,
      yield_qty: Number(yieldQty) || 1,
      yield_uom: yieldUom || selectedProduct.stock_uom || (bomClass === 'packing' ? 'box' : 'pcs'),
      version: 1,
      is_active: true,
      notes: notes || undefined,
      subcategory: subcategory || undefined,
    };
    if (bomClass === 'packing' && packColor) {
      bomData.pack_color_theme = packColor;
    }
    const created = await base44.entities.Bom.create(bomData);
    setCreating(false);
    onCreated(created);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h3 className="text-lg font-bold">Create New BOM</h3>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* BOM type — Production vs Packing */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">BOM Type</label>
            <div className="space-y-2">
              {BOM_CLASSES.map(opt => {
                const Icon = opt.icon;
                const active = bomClass === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => selectClass(opt.value)}
                    className={`w-full text-left px-4 py-3 rounded-xl border transition-all flex gap-3 items-start ${
                      active
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                        : 'border-border hover:bg-muted/30'
                    }`}
                  >
                    <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span>
                      <span className="block text-sm font-semibold">{opt.title}</span>
                      <span className="block text-xs text-muted-foreground">{opt.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Production stage — only for Production BOMs */}
          {bomClass === 'production' && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Production Stage</label>
              <div className="space-y-2">
                {PRODUCTION_STAGES.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setBomType(opt.value); setSubcategory(''); }}
                    className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                      bomType === opt.value
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                        : 'border-border hover:bg-muted/30'
                    }`}
                  >
                    <p className="text-sm font-semibold">{opt.label}</p>
                    <p className="text-xs text-muted-foreground">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Subcategory */}
          {subcategoryOptions.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Subcategory</label>
              <div className="flex flex-wrap gap-2">
                {subcategoryOptions.map(sub => {
                  const active = parseSubcategories(subcategory).includes(sub);
                  return (
                    <button
                      key={sub}
                      onClick={() => {
                        const current = parseSubcategories(subcategory);
                        const next = active ? current.filter(s => s !== sub) : [...current, sub];
                        setSubcategory(stringifySubcategories(next));
                      }}
                      className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-all ${
                        active
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:bg-muted/30'
                      }`}
                    >
                      {sub}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Output product */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
              {bomClass === 'packing' ? 'Output Box / Package' : 'Output Product'}
            </label>
            {selectedProduct ? (
              <div className="bg-muted/50 rounded-lg p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">{selectedProduct.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{selectedProduct.sku}</p>
                </div>
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSelectedProduct(null)}>Change</Button>
              </div>
            ) : (
              <>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search product by name or SKU..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <div className="space-y-1 max-h-[30vh] overflow-y-auto">
                  {filtered.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedProduct(p); setYieldUom(p.stock_uom || (bomClass === 'packing' ? 'box' : '')); }}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors flex items-center justify-between"
                    >
                      <div>
                        <p className="text-sm font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{p.sku}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px]">{p.type}</Badge>
                    </button>
                  ))}
                  {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-3">No products found</p>}
                </div>
              </>
            )}
          </div>

          {/* Yield */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Yield</label>
            <div className="flex gap-2">
              <Input
                type="number"
                step="any"
                min="0"
                placeholder="Quantity"
                value={yieldQty}
                onChange={e => setYieldQty(e.target.value)}
                className="w-24"
              />
              <Input
                placeholder={bomClass === 'packing' ? 'UoM (e.g. box)' : 'UoM (e.g. kg, pcs)'}
                value={yieldUom}
                onChange={e => setYieldUom(e.target.value)}
                className="w-28"
              />
            </div>
          </div>

          {/* Pack color theme — only for Packing BOMs */}
          {bomClass === 'packing' && (
            <PackColorPicker value={packColor} onChange={setPackColor} />
          )}

          {/* Notes */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Notes (optional)</label>
            <Input
              placeholder={bomClass === 'packing' ? 'Any notes about this packing BOM...' : 'Any notes about this recipe...'}
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border shrink-0 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button
            className="flex-1 gap-2"
            onClick={handleCreate}
            disabled={creating || !selectedProduct}
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create BOM
          </Button>
        </div>
      </div>
    </div>
  );
}
