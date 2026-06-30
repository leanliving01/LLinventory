import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { FileClock, Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Lists saved invoice-scan drafts (scratch state from a part-finished scan) with
 * Resume / Delete. Drop it next to the "Scan Invoice" button. `onResume(draft)`
 * should open InvoiceScanDialog with `resumeDraft={draft}`.
 */
export default function ScanDraftsBanner({ onResume }) {
  const queryClient = useQueryClient();
  const { data: drafts = [], isLoading } = useQuery({
    queryKey: ['invoice-scan-drafts'],
    queryFn: () => base44.entities.InvoiceScanDraft.list('-updated_date', 50),
  });

  if (isLoading || drafts.length === 0) return null;

  const del = async (id) => {
    try {
      await base44.entities.InvoiceScanDraft.delete(id);
      queryClient.invalidateQueries({ queryKey: ['invoice-scan-drafts'] });
      toast.success('Draft deleted');
    } catch (e) {
      toast.error('Failed to delete draft: ' + (e.message || 'Unknown error'));
    }
  };

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
      <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
        <FileClock className="w-4 h-4" /> {drafts.length} saved scan draft{drafts.length !== 1 ? 's' : ''} — resume where you left off
      </p>
      <div className="space-y-1.5">
        {drafts.map(d => {
          const lineCount = Array.isArray(d.extracted?.lines) ? d.extracted.lines.length : 0;
          return (
            <div key={d.id} className="flex items-center justify-between gap-3 bg-background rounded-md border border-border px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-medium truncate flex items-center gap-1.5">
                  <span className="truncate">{d.supplier_name || 'No supplier'}{d.invoice_number ? ` · ${d.invoice_number}` : ''}</span>
                  <span className="text-[10px] uppercase rounded px-1 py-0.5 bg-muted text-muted-foreground shrink-0">
                    {d.mode === 'blind' ? 'Blind receipt' : 'Invoice'}
                  </span>
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {lineCount} line{lineCount !== 1 ? 's' : ''}
                  {d.updated_date ? ` · saved ${new Date(d.updated_date).toLocaleString('en-ZA')}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => onResume(d)}>
                  <Play className="w-3 h-3" /> Resume
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => del(d.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
