import React from 'react';
import { Card } from '@/components/ui/card';
import FinancialTotals from '../order-shared/FinancialTotals';
import FinancialLinesSections from '../order-shared/FinancialLinesSections';
import ProfitabilitySummary from '../order-shared/ProfitabilitySummary';

/**
 * Profitability tab — the order's cost & margin breakdown, with the financial
 * totals recap and the non-inventory line detail that feeds it.
 */
export default function FinancialSummaryTab({ order, financialLines = [], profit }) {
  return (
    <div className="space-y-4">
      <ProfitabilitySummary profit={profit} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <Card className="p-4">
          <p className="text-sm font-semibold mb-3">Financial Totals</p>
          <FinancialTotals order={order} financialLines={financialLines} />
        </Card>
        <Card className="p-4">
          <p className="text-sm font-semibold mb-3">Non-inventory Lines</p>
          <FinancialLinesSections financialLines={financialLines} />
        </Card>
      </div>
    </div>
  );
}
