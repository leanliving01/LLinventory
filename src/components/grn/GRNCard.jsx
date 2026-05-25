import React from 'react';
import { Badge } from '@/components/ui/badge';
import { PackageCheck, ChevronRight, Clock, Truck, AlertTriangle } from 'lucide-react';

const STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-green-100 text-green-700',
  disputed: 'bg-red-100 text-red-600',
};

export default function GRNCard({ grn, onClick }) {
  return (
    <button
      onClick={() => onClick(grn)}
      className="w-full text-left bg-card border border-border rounded-xl p-4 hover:shadow-md transition-all flex items-center justify-between group"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <PackageCheck className="w-5 h-5 text-primary" />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-bold font-mono">{grn.grn_number}</span>
            <Badge className={`text-[10px] ${STATUS_STYLES[grn.status] || ''}`}>
              {grn.status}
            </Badge>
            {grn.has_shortages && (
              <Badge className="text-[10px] bg-amber-100 text-amber-700">
                <AlertTriangle className="w-3 h-3 mr-0.5" /> Short
              </Badge>
            )}
            {grn.has_rejections && (
              <Badge className="text-[10px] bg-red-100 text-red-600">Rejected Items</Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Truck className="w-3.5 h-3.5" /> {grn.supplier_name}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> {grn.received_date}
            </span>
            <span>{grn.total_lines || 0} lines</span>
            {grn.total_received_value > 0 && (
              <span className="font-medium text-foreground">
                R {grn.total_received_value.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
              </span>
            )}
          </div>
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
    </button>
  );
}