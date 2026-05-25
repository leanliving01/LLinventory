import React from 'react';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ChevronRight, Truck, Package } from 'lucide-react';

const STATUS_STYLES = {
  open: 'bg-amber-100 text-amber-700',
  follow_up_delivery: 'bg-blue-100 text-blue-700',
  credit_received: 'bg-green-100 text-green-700',
  written_off: 'bg-gray-100 text-gray-500',
};

const STATUS_LABELS = {
  open: 'Open',
  follow_up_delivery: 'Follow-up Delivery',
  credit_received: 'Credit Received',
  written_off: 'Written Off',
};

export default function ShortageCard({ shortage, onClick }) {
  return (
    <button
      onClick={() => onClick(shortage)}
      className="w-full text-left bg-card border border-border rounded-xl p-4 hover:shadow-md transition-all flex items-center justify-between group"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
          <AlertTriangle className="w-5 h-5 text-amber-600" />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-medium">{shortage.product_name}</span>
            <Badge className={`text-[10px] ${STATUS_STYLES[shortage.status] || ''}`}>
              {STATUS_LABELS[shortage.status] || shortage.status}
            </Badge>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="font-mono">{shortage.product_sku}</span>
            <span className="flex items-center gap-1">
              <Truck className="w-3.5 h-3.5" /> {shortage.supplier_name}
            </span>
            <span className="font-medium text-amber-700">
              {shortage.shortage_qty} {shortage.purchase_uom} short
            </span>
            <span className="text-foreground font-medium">
              R {(shortage.shortage_value || 0).toFixed(2)}
            </span>
          </div>
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
    </button>
  );
}