import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, X, Plus, Link2, AlertTriangle, Sparkles } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import SupplierProductRow from '@/components/purchasing/SupplierProductRow';
import SupplierProductDrawer from '@/components/purchasing/SupplierProductDrawer';
import CreateSupplierProductModal from '@/components/purchasing/CreateSupplierProductModal';
import PageHelp from '@/components/help/PageHelp';

const HELP_ITEMS = [
  { title: 'What is this page?', text: 'The Supplier Product Catalog links internal products to their suppliers with buy UoM, conversion factors, yield deductions, and pricing. This replaces the legacy Product.supplier_id field.' },
  { title: 'Link a new product', text: 'Click "Link Supplier Product" to connect a supplier to an internal raw material. Set the purchase UoM (e.g. case of 6 × 1kg), conversion factor, and yield factor.' },
  { title: 'UoM conversion', text: 'Example: you buy a "case" that contains 6 × 1kg bags = conversion factor 6. If 8% is lost to trim, yield factor = 0.92. Effective stock = 6 × 0.92 = 5.52 kg per case.' },
  { title: 'Default supplier', text: 'Mark one supplier as "default" per product. When reorder alerts fire, the default supplier is suggested first.' },
  { title: 'Xero matching', text: 'Set the Xero Item Code to match Xero bill lines automatically during invoice sync.' },
];

export default function SupplierProductCatalog() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [sourceFilter, setSourceFilter] = useState('all'); // 'all' | 'ai' | 'mismatch'
  const [showCreate, setShowCreate] = useState(false);
  const [selectedSP, setSelectedSP] = useState(null);

  const { data: allSPs = [], isLoading } = useQuery({
    queryKey: ['supplier-product-catalog'],
    queryFn: () => base44.entities.SupplierProduct.list('product_name', 500),
  });

  // Load products to cross-check stock_uom for mismatch detection
  const { data: products = [] } = useQuery({
    queryKey: ['products-for-sp-check'],
    queryFn: () => base44.entities.Product.list('sku', 1000),
    enabled: allSPs.length > 0,
  });
  const productMap = useMemo(() => {
    const m = {};
    for (const p of products) m[p.id] = p;
    return m;
  }, [products]);

  // Detect UoM mismatches — conversion_uom should match the product's stock_uom
  const VALID_UOMS = new Set(['g', 'kg', 'ml', 'L', 'pcs', 'box']);
  const hasMismatch = (sp) => {
    if (!VALID_UOMS.has(sp.conversion_uom)) return true; // non-standard conversion_uom like "case of 6"
    const product = productMap[sp.product_id];
    if (product && product.stock_uom && sp.conversion_uom !== product.stock_uom) return true; // conversion_uom ≠ stock_uom
    return false;
  };

  const isAiEnriched = (sp) => (sp.notes || '').startsWith('AI-enriched');

  const filtered = useMemo(() => {
    return allSPs.filter(sp => {
      if (statusFilter === 'active' && sp.active === false) return false;
      if (statusFilter === 'inactive' && sp.active !== false) return false;
      if (sourceFilter === 'ai' && !isAiEnriched(sp)) return false;
      if (sourceFilter === 'mismatch' && !hasMismatch(sp)) return false;
      if (search) {
        const q = search.toLowerCase();
        return (sp.product_name || '').toLowerCase().includes(q) ||
               (sp.product_sku || '').toLowerCase().includes(q) ||
               (sp.supplier_name || '').toLowerCase().includes(q) ||
               (sp.supplier_sku || '').toLowerCase().includes(q) ||
               (sp.xero_item_code || '').toLowerCase().includes(q);
      }
      return true;
    });
  }, [allSPs, search, statusFilter, sourceFilter, productMap]);

  const activeCount = allSPs.filter(sp => sp.active !== false).length;
  const inactiveCount = allSPs.length - activeCount;
  const aiCount = allSPs.filter(isAiEnriched).length;
  const mismatchCount = allSPs.filter(hasMismatch).length;

  const handleUpdated = () => {
    queryClient.invalidateQueries({ queryKey: ['supplier-product-catalog'] });
    if (selectedSP) {
      base44.entities.SupplierProduct.filter({ id: selectedSP.id }).then(res => {
        if (res[0]) setSelectedSP(res[0]); else setSelectedSP(null);
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Link2 className="w-6 h-6 text-primary" /> Supplier Product Catalog
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtered.length} of {allSPs.length} supplier-product links
          </p>
        </div>
        {perms.supplier_product_edit && (
          <Button onClick={() => setShowCreate(true)} className="gap-2 h-11 px-5">
            <Plus className="w-4 h-4" /> Link Supplier Product
          </Button>
        )}
      </div>

      <PageHelp items={HELP_ITEMS} />

      {/* Status chips */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'active', label: 'Active', count: activeCount },
          { key: 'inactive', label: 'Inactive', count: inactiveCount },
          { key: 'all', label: 'All', count: allSPs.length },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => { setStatusFilter(tab.key); setSourceFilter('all'); }}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
              statusFilter === tab.key && sourceFilter === 'all'
                ? 'bg-primary/10 text-primary ring-2 ring-primary/30'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
        <span className="w-px bg-border mx-1" />
        <button
          onClick={() => { setSourceFilter(sourceFilter === 'ai' ? 'all' : 'ai'); setStatusFilter('all'); }}
          className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all flex items-center gap-1.5 ${
            sourceFilter === 'ai'
              ? 'bg-violet-100 text-violet-700 ring-2 ring-violet-300'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          <Sparkles className="w-3 h-3" /> AI Enriched ({aiCount})
        </button>
        {mismatchCount > 0 && (
          <button
            onClick={() => { setSourceFilter(sourceFilter === 'mismatch' ? 'all' : 'mismatch'); setStatusFilter('all'); }}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all flex items-center gap-1.5 ${
              sourceFilter === 'mismatch'
                ? 'bg-orange-100 text-orange-700 ring-2 ring-orange-300'
                : 'bg-orange-50 text-orange-600 hover:bg-orange-100'
            }`}
          >
            <AlertTriangle className="w-3 h-3" /> UoM Mismatch ({mismatchCount})
          </button>
        )}
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search product, supplier, SKU, Xero code..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch('')} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading supplier products...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          {allSPs.length === 0 ? 'No supplier products linked yet. Click "Link Supplier Product" to get started.' : 'No results match your search.'}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Product</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Supplier</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Supplier SKU</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Purchase UoM</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Conversion</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Yield</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Price</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.slice(0, 15).map(sp => (
                <SupplierProductRow key={sp.id} sp={sp} onClick={setSelectedSP} mismatch={hasMismatch(sp)} aiEnriched={isAiEnriched(sp)} />
              ))}
            </tbody>
          </table>
          {filtered.length > 15 && (
            <div className="px-4 py-2 bg-muted/30 border-t border-border text-center">
              <p className="text-xs text-muted-foreground">
                Showing 15 of {filtered.length} — use search to narrow results
              </p>
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <CreateSupplierProductModal
          onCreated={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['supplier-product-catalog'] });
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {selectedSP && (
        <SupplierProductDrawer
          sp={selectedSP}
          onClose={() => setSelectedSP(null)}
          onUpdated={handleUpdated}
          canEdit={perms.supplier_product_edit}
        />
      )}
    </div>
  );
}