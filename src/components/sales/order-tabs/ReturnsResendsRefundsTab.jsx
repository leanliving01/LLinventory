import React from 'react';
import { RotateCcw, Send, Receipt } from 'lucide-react';
import RefundsTab from './RefundsTab';
import ReturnsBlock from '../order-shared/ReturnsBlock';
import ResendsBlock from '../order-shared/ResendsBlock';

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
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <SectionHeading icon={RotateCcw} count={returns.length}>Returns</SectionHeading>
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
    </div>
  );
}
