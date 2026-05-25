import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Printer, FileDown } from 'lucide-react';
import HelpDrawer from '@/components/help/HelpDrawer';

export default function PickListHeader({
  runId, runNumber, lineCount, itemCount,
  pickedCount, releasedCount = 0, onPrint, onExportPdf,
}) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-3 print:hidden">
      <div className="flex items-center gap-3">
        <Link to={`/production/run/${runId}`}>
          <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Pick List — {runNumber}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-sm text-muted-foreground">{lineCount} meals · {itemCount} ingredients</span>
            {itemCount > 0 && (
              <>
                <Badge variant="secondary" className="text-[10px] tabular-nums">{pickedCount}/{itemCount} picked</Badge>
                <Badge className="text-[10px] tabular-nums bg-green-100 text-green-700">{releasedCount}/{itemCount} released</Badge>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <HelpDrawer pageKey="pick-list" />
        <Button variant="outline" onClick={onExportPdf} className="gap-1.5">
          <FileDown className="w-4 h-4" /> PDF
        </Button>
        <Button variant="outline" onClick={onPrint} className="gap-1.5">
          <Printer className="w-4 h-4" /> Print
        </Button>
      </div>
    </div>
  );
}