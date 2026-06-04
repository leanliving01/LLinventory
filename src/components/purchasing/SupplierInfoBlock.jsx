import React from 'react';
import { Truck } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Read-only supplier detail block for purchasing documents — name, physical
 * address (falls back to billing address) and VAT number. Populated from the
 * supplier record.
 */
export default function SupplierInfoBlock({ supplier, className, title = 'Supplier' }) {
  if (!supplier) return null;
  const address = supplier.physical_address || supplier.billing_address || '';
  const vat = supplier.is_vat_registered ? (supplier.vat_number || '') : (supplier.vat_number || '');

  return (
    <div className={cn('rounded-lg border border-border bg-muted/20 px-3 py-2.5', className)}>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1 flex items-center gap-1">
        <Truck className="w-3 h-3" /> {title}
      </p>
      <p className="text-sm font-medium">{supplier.name}</p>
      {address && (
        <p className="text-xs text-muted-foreground whitespace-pre-line mt-0.5 leading-relaxed">{address}</p>
      )}
      <p className="text-xs text-muted-foreground mt-0.5">VAT: {vat || '—'}</p>
    </div>
  );
}
