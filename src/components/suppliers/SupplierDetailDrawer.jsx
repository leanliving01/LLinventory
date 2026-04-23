import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X, Truck, User, Mail, Phone, CreditCard, MapPin, Package } from 'lucide-react';

function Field({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3">
      <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
      <div>
        <p className="text-[10px] uppercase text-muted-foreground font-semibold">{label}</p>
        <p className="text-sm">{value}</p>
      </div>
    </div>
  );
}

export default function SupplierDetailDrawer({ supplier, onClose }) {
  // Products linked to this supplier
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['supplier-products', supplier.id],
    queryFn: () => base44.entities.Product.filter({ supplier_id: supplier.id }),
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-card shadow-xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-start justify-between z-10">
          <div>
            <Badge className={`text-[10px] mb-1 ${supplier.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {supplier.status || 'active'}
            </Badge>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Truck className="w-5 h-5 text-primary" />
              {supplier.name}
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="px-6 py-4 space-y-6">
          {/* Contact info */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Contact Details</h3>
            <div className="space-y-3">
              <Field icon={User} label="Contact Name" value={supplier.contact_name} />
              <Field icon={Mail} label="Email" value={supplier.email} />
              <Field icon={Phone} label="Phone" value={supplier.phone} />
              <Field icon={CreditCard} label="Payment Terms" value={supplier.payment_terms} />
              <Field icon={MapPin} label="Billing Address" value={supplier.billing_address} />
              {supplier.tax_id && <Field icon={CreditCard} label="VAT Number" value={supplier.tax_id} />}
            </div>
            {!supplier.contact_name && !supplier.email && !supplier.phone && (
              <p className="text-xs text-muted-foreground italic">No contact details on file</p>
            )}
          </div>

          {/* Linked products */}
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
              <Package className="w-4 h-4 text-primary" />
              Linked Products ({products.length})
            </h3>
            {isLoading ? (
              <p className="text-xs text-muted-foreground">Loading...</p>
            ) : products.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No products linked to this supplier yet</p>
            ) : (
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">SKU</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Supplier SKU</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {products.slice(0, 15).map(p => (
                      <tr key={p.id} className="hover:bg-muted/20">
                        <td className="px-3 py-2 text-xs font-mono">{p.sku}</td>
                        <td className="px-3 py-2 text-xs">{p.name}</td>
                        <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{p.supplier_sku || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {products.length > 15 && (
                  <div className="px-3 py-2 bg-muted/30 border-t border-border">
                    <p className="text-xs text-muted-foreground">+{products.length - 15} more products</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Cin7 reference */}
          {supplier.cin7_id && (
            <div className="pt-2 border-t border-border">
              <p className="text-[10px] text-muted-foreground">Cin7 ID: <span className="font-mono">{supplier.cin7_id}</span></p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}