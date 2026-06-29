import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useUnsavedChanges, useGuardedNavigate } from '@/lib/navigationGuard';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Save, Loader2, Package, ArrowRightLeft, Settings2, Wrench, Truck } from 'lucide-react';
import { toast } from 'sonner';
import ProductEditForm from '@/components/catalog/ProductEditForm';
import ProductStockTab from '@/components/catalog/ProductStockTab';
import ProductMovementsTab from '@/components/catalog/ProductMovementsTab';
import ProductCookBomCard from '@/components/catalog/ProductCookBomCard';
import ProductEquipmentTab from '@/components/catalog/ProductEquipmentTab';
import ProductSuppliersTab from '@/components/catalog/ProductSuppliersTab';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';

const TABS = [
  { key: 'details', label: 'Details', icon: Settings2 },
  { key: 'suppliers', label: 'Suppliers', icon: Truck },
  { key: 'equipment', label: 'Equipment', icon: Wrench },
  { key: 'stock', label: 'Stock', icon: Package },
  { key: 'movements', label: 'Movements', icon: ArrowRightLeft },
];

const DEFAULT_FORM = {
  name: '', sku: '', barcode: '', type: 'raw', status: 'active',
  inventory_tracked: true, sellable: false, purchasable: true, produced: false, stock_uom: 'kg',
  subcategory: '', pick_category: '', weight_g: null, weight_unit: 'g',
  length_cm: null, width_cm: null, height_cm: null,
  cost_avg: 0, cost_current: 0, price: 0, par_level: 0,
  min_before_reorder: 0, reorder_qty: 0, lead_time_days: 0,
  supplier_id: '', supplier_sku: '', description: '', internal_note: '',
};

// Drop server-managed fields so the unsaved-changes comparison only reflects
// user-editable data (timestamps/ids drift on refetch and would read as dirty).
function stripServerFields(obj) {
  if (!obj) return obj;
  const { id, created_date, updated_date, created_by, ...rest } = obj;
  return rest;
}

export default function ProductEdit() {
  const { productId } = useParams();
  const isNew = productId === 'new';
  const navigate = useNavigate();
  const guardedNavigate = useGuardedNavigate();
  const createdIdRef = useRef(null);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const canEdit = !!perms.catalog_edit;
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState(null);
  const [activeTab, setActiveTab] = useState('details');

  const { data: product, isLoading } = useQuery({
    queryKey: ['product', productId],
    queryFn: async () => {
      const products = await base44.entities.Product.filter({ id: productId });
      return products[0] || null;
    },
    enabled: !isNew && !!productId,
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => base44.entities.Location.list(),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => base44.entities.Supplier.list(),
  });

  const { data: allProducts = [] } = useQuery({
    queryKey: ['catalog-products'],
    queryFn: () => base44.entities.Product.list('-created_date', 500),
  });

  const { data: productCategories = [] } = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => base44.entities.ProductCategory.filter({ is_active: true }, 'sort_order', 200),
  });

  const { data: productSubcategories = [] } = useQuery({
    queryKey: ['product-subcategories'],
    queryFn: () => base44.entities.ProductSubcategory.filter({ is_active: true }, 'sort_order', 500),
  });

  const categories = [...new Set(allProducts.map(p => p.category).filter(Boolean))].sort();

  useEffect(() => {
    if (isNew && !formData) {
      setFormData({ ...DEFAULT_FORM });
    } else if (!isNew && product && !formData) {
      setFormData({ ...product });
    }
  }, [isNew, product]);

  // Persist only — no navigation. Returns true on success / false on abort so
  // the unsaved-changes guard can decide whether to proceed with the leave.
  const persist = async () => {
    if (!formData) return false;
    if (!formData.name?.trim()) { toast.error('Product name is required'); return false; }
    if (!formData.sku?.trim()) { toast.error('SKU is required'); return false; }
    setSaving(true);
    const { id, created_date, updated_date, created_by, ...payload } = formData;
    try {
      if (isNew) {
        const newProduct = await base44.entities.Product.create(payload);
        queryClient.invalidateQueries({ queryKey: ['catalog-products'] });
        toast.success('Product created');
        createdIdRef.current = newProduct.id;
      } else {
        await base44.entities.Product.update(productId, payload);
        queryClient.invalidateQueries({ queryKey: ['catalog-products'] });
        queryClient.invalidateQueries({ queryKey: ['product', productId] });
        toast.success('Product saved');
      }
      setSaving(false);
      return true;
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
      setSaving(false);
      return false;
    }
  };

  // Save button: persist, then (for a brand-new product) open its detail page.
  const handleSave = async () => {
    const ok = await persist();
    if (ok && isNew && createdIdRef.current) navigate(`/catalog/${createdIdRef.current}`);
    return ok;
  };

  // ---- Unsaved-changes guard (sidebar / back button / refresh / ⌘K) ----
  // Compare only the editable payload — server-managed fields (timestamps, ids)
  // would otherwise drift after a save/refetch and read as permanently dirty.
  const hasUnsavedChanges = !!formData &&
    JSON.stringify(stripServerFields(formData)) !==
      JSON.stringify(stripServerFields(isNew ? DEFAULT_FORM : product));
  // onSave persists only; the guard performs the leave navigation itself.
  useUnsavedChanges(hasUnsavedChanges, {
    message: 'You have unsaved changes to this product.',
    onSave: persist,
  });

  if (!isNew && isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isNew && !product) {
    return (
      <div className="text-center py-24 text-muted-foreground">
        Product not found.
        <Button variant="link" onClick={() => navigate('/catalog')}>Back to Catalog</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => guardedNavigate('/catalog')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{isNew ? 'New Product' : product.name}</h1>
            {!isNew && <p className="text-sm text-muted-foreground font-mono">{product.sku}</p>}
          </div>
        </div>
        {canEdit && (
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isNew ? 'Create Product' : 'Save Changes'}
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(isNew ? TABS.filter(t => t.key === 'details') : TABS).map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'details' && formData && (
        <>
          <ProductCookBomCard
            product={formData}
            onTypeChanged={(newType) => {
              setFormData(prev => ({ ...prev, type: newType }));
              queryClient.invalidateQueries({ queryKey: ['product', productId] });
            }}
          />
          <ProductEditForm
            formData={formData}
            onChange={setFormData}
            locations={locations}
            suppliers={suppliers}
            categories={categories}
            productCategories={productCategories}
            productSubcategories={productSubcategories}
            productId={productId}
          />
        </>
      )}

      {activeTab === 'suppliers' && product && (
        <ProductSuppliersTab
          productId={productId}
          productName={product.name}
          productSku={product.sku}
          stockUom={product.stock_uom}
          canEdit={canEdit}
        />
      )}

      {activeTab === 'equipment' && product && (
        <ProductEquipmentTab productId={productId} productName={product.name} productSku={product.sku} />
      )}

      {activeTab === 'stock' && (
        <ProductStockTab productId={productId} />
      )}

      {activeTab === 'movements' && (
        <ProductMovementsTab productId={productId} />
      )}
    </div>
  );
}