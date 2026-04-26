import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import ProductEditForm from '@/components/catalog/ProductEditForm';

export default function ProductEdit() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState(null);

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
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Changes
        </Button>
      </div>

      {formData && (
        <ProductEditForm
          formData={formData}
          onChange={setFormData}
          locations={locations}
          suppliers={suppliers}
          categories={categories}
        />
      )}
    </div>
  );
}