import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Printer, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buildProductionSheets } from '@/lib/productionSheets';
import ProductionPlanPrint from '@/components/production/print/ProductionPlanPrint';
import BulkCookSheetPrint from '@/components/production/print/BulkCookSheetPrint';
import RecipeSheetPrint from '@/components/production/print/RecipeSheetPrint';

const SHEETS = [
  { key: 'plan', label: 'Production Plan' },
  { key: 'bulk', label: 'Bulk Cook Sheet' },
  { key: 'recipes', label: 'Recipe Sheets' },
  { key: 'all', label: 'All Sheets' },
];

// Print-only stylesheet: A4 landscape, hide the app shell, page-break between
// sections. visibility trick keeps only `.print-area` ink on the page.
const PRINT_CSS = `
@media print {
  @page { size: A4 landscape; margin: 10mm; }
  body * { visibility: hidden !important; }
  .print-area, .print-area * { visibility: visible !important; }
  .print-area { position: absolute; left: 0; top: 0; width: 100%; }
  /* Each sheet/section starts a new page. A forced break before the very first
     box is ignored by the browser, so no leading blank page. */
  .print-page { break-before: page; }
}
/* Screen-only separation between stacked sheet previews. */
@media screen {
  .print-page + .print-page { margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px dashed #cbd5e1; }
  .print-root + .print-root { margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px dashed #cbd5e1; }
}
`;

export default function ProductionPrintSheets() {
  const { runId } = useParams();
  const [sheet, setSheet] = useState('plan');

  const { data: run } = useQuery({
    queryKey: ['production-run', runId],
    queryFn: () => base44.entities.ProductionRun.filter({ id: runId }).then(r => r[0]),
    enabled: !!runId,
  });

  const { data: lines = [], isLoading: loadingLines } = useQuery({
    queryKey: ['production-run-lines', runId],
    queryFn: () => base44.entities.ProductionRunLine.filter({ run_id: runId }, 'product_sku', 500),
    enabled: !!runId,
  });

  const { data: sheets, isLoading: building } = useQuery({
    queryKey: ['production-sheets', runId, lines.length],
    queryFn: () => buildProductionSheets(lines),
    enabled: lines.length > 0,
  });

  const loading = loadingLines || building;

  return (
    <div className="space-y-4">
      <style>{PRINT_CSS}</style>

      {/* Toolbar — screen only */}
      <div className="flex items-center gap-3 print:hidden">
        <Link to={`/production/run/${runId}`}>
          <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Print Production Sheets</h1>
          <p className="text-sm text-muted-foreground">{run?.run_number || ''}</p>
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          {SHEETS.map(s => (
            <button
              key={s.key}
              onClick={() => setSheet(s.key)}
              className={cn(
                'px-3 py-1.5 text-sm rounded-md transition-colors',
                sheet === s.key ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <Button onClick={() => window.print()} disabled={loading || !sheets} className="gap-2">
          <Printer className="w-4 h-4" /> Print / Save as PDF
        </Button>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground print:hidden">
          <Loader2 className="w-4 h-4 animate-spin" /> Building sheets…
        </div>
      )}

      {!loading && !sheets && lines.length === 0 && (
        <p className="text-sm text-muted-foreground py-16 text-center print:hidden">
          This run has no meal lines to print.
        </p>
      )}

      {/* Preview + print target */}
      {sheets && (
        <div className="print-area bg-white text-black rounded-lg border border-border p-6 print:p-0 print:border-0 print:rounded-none">
          {(sheet === 'plan' || sheet === 'all') && <ProductionPlanPrint run={run} plan={sheets.plan} />}
          {(sheet === 'bulk' || sheet === 'all') && <BulkCookSheetPrint run={run} bulkCook={sheets.bulkCook} />}
          {(sheet === 'recipes' || sheet === 'all') && <RecipeSheetPrint run={run} recipes={sheets.recipes} />}
        </div>
      )}
    </div>
  );
}
