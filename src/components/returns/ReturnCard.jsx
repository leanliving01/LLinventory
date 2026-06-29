import React from 'react';
import { Badge } from '@/components/ui/badge';
import { RotateCcw, ChevronRight, Truck, Clock } from 'lucide-react';

const STATUS_STYLES = {
  pending_return: 'bg-amber-100 text-amber-700',
  returned: 'bg-blue-100 text-blue-700',
  credit_received: 'bg-green-100 text-green-700',
  disputed: 'bg-red-100 text-red-600',
};

const STATUS_LABELS = {
  pending_return: 'Pending Return',
  returned: 'Returned',
  credit_received: 'Credit Received',
  disputed: 'Disputed',
};

export default function ReturnCard({ ret, onClick }) {
  return (
    <button
      onClick={() => onClick(ret)}
      className="w-full text-left bg-card border border-border rounded-xl p-4 hover:shadow-md transition-all flex items-center justify-between group"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center">
          <RotateCcw className="w-5 h-5 text-red-600" />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-bold font-mono">{ret.return_number}</span>
            <Badge className={`text-[10px] ${STATUS_STYLES[ret.status] || ''}`}>
              {STATUS_LABELS[ret.status] || ret.status}
            </Badge>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Truck className="w-3.5 h-3.5" /> {ret.supplier_name}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> {ret.return_date}
            </span>
            {ret.total_return_value > 0 && (
              <span className="font-medium text-foreground">
                R {ret.total_return_value.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            )}
          </div>
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
    </button>
  );
}