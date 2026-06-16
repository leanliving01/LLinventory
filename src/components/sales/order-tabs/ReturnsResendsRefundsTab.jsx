import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RotateCcw, Send, Receipt, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import RefundsTab from './RefundsTab';
import ReturnsBlock from '../order-shared/ReturnsBlock';
import ResendsBlock from '../order-shared/ResendsBlock';
import OrderOperationalHistory from '../order-shared/OrderOperationalHistory';
import { createReturnFromOrder } from '@/lib/createReturn';

/**
 * Consolidated after-sale view: Returns, Re-sends and Refunds in one place,
 * each with its full detail. Reuses the existing blocks so behaviour matches
 * the standalone Returns/Resends pages.
 */
function SectionHeading({ icon: Icon, children, count }) {
  return (
    <div className="flex items-center gap-2 mt-2">
      <Icon className="w-4 h-4 text-slate-500" />
      <h3 className="text-sm font-semibold">{children}</h3>
      {count > 0 && (
        <span className="text-[11px] text-muted-foreground">({count})</span>
      )}
    </div>
  );
}

export default function ReturnsResendsRefundsTab({ order, returns = [], resends = [], financialLines = [] }) {
  const navigate = useNavigate();
  const [creatingReturn, setCreatingReturn] = useState(false);

  const handleAddReturn = async () => {
    setCreatingReturn(true);
    try {
      const id = await createReturnFromOrder(order.id);
      toast.success('Draft return created');
      navigate(`/sales/returns/${id}`);
    } catch (err) {
      toast.error(err.message || 'Could not create return');
      setCreatingReturn(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <SectionHeading icon={RotateCcw} count={returns.length}>Returns</SectionHeading>
          <button onClick={handleAddReturn} disabled={creatingReturn}
            className="inline-flex items-center gap-1.5 text-xs border rounded-md px-3 py-1.5 hover:bg-muted disabled:opacity-60">
            {creatingReturn ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add Return
          </button>
        </div>
        <ReturnsBlock returns={returns} />
      </div>

      <div className="space-y-2">
        <SectionHeading icon={Send} count={resends.length}>Re-sends</SectionHeading>
        <ResendsBlock order={order} resends={resends} />
      </div>

      <div className="space-y-2">
        <SectionHeading icon={Receipt}>Refunds &amp; Adjustments</SectionHeading>
        <RefundsTab order={order} financialLines={financialLines} />
      </div>

      <OrderOperationalHistory order={order} returns={returns} resends={resends} />
    </div>
  );
}
