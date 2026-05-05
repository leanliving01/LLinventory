import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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

export default function ProductEdit() {
  const { productId } = useParams();
  const navigate = useNavigate();
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
    enabled: !!productId,
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
    if (product && !formData) {
      setFormData({ ...product });
    }
  }, [product]);

  const handleSave = async () => {
    if (!formData) return;
    setSaving(true);
    const { id, created_date, updated_date, created_by, ...updateData } = formData;
    await base44.entities.Product.update(productId, updateData);
    queryClient.invalidateQueries({ queryKey: ['catalog-products'] });
    queryClient.invalidateQueries({ queryKey: ['product', productId] });
    toast.success('Product saved');
    setSaving(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="text-center py-24 text-muted-foreground">
        Product not found.
        <Button variant="link" onClick={() => navigate('/catalog')}>Back to Catalog</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/catalog')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{product.name}</h1>
            <p className="text-sm text-muted-foreground font-mono">{product.sku}</p>
          </div>
        </div>
        {canEdit && (
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map(tab => {
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