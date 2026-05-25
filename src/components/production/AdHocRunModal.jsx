import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Factory, Loader2, Search, X } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { groupMealsForProduction, VARIANT_CODES } from '@/lib/productionGrouping';
import { writeAuditLog } from '@/lib/auditLog';
import { generateCookingRunsForRun } from '@/lib/cookingRunGenerator';
import AdHocRunTable from './AdHocRunTable';

export default function AdHocRunModal({ open, onOpenChange }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [quantities, setQuantities] = useState({});
  const [creating, setCreating] = useState(false);

  const { data: finishedMeals = [] } = useQuery({
    queryKey: ['finished-meals'],
    queryFn: () => base44.entities.Product.filter({ type: 'finished_meal', status: 'active' }, '-sku', 500),
  });

  const { goalRows, lowCarbRows } = useMemo(() => {
    return groupMealsForProduction(finishedMeals);
  }, [finishedMeals]);

  const filteredGoal = useMemo(() => {
    if (!search) return goalRows;
    const s = search.toLowerCase();
    return goalRows.filter(r => r.baseName.toLowerCase().includes(s));
  }, [goalRows, search]);

  const filteredLC = useMemo(() => {
    if (!search) return lowCarbRows;
    const s = search.toLowerCase();
    return lowCarbRows.filter(r => r.baseName.toLowerCase().includes(s));
  }, [lowCarbRows, search]);

  const handleQtyChange = (productId, value) => {
    setQuantities(prev => ({ ...prev, [productId]: value }));
  };

  // Collect all lines with qty > 0
  const totalUnits = useMemo(() => {
    return Object.values(quantities).reduce((sum, v) => sum + (Number(v) || 0), 0);
  }, [quantities]);

  const handleCreate = async () => {
    if (totalUnits === 0) { toast.error('Enter at least one quantity'); return; }
    setCreating(true);

    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      const runNumber = `RUN-${format(new Date(), 'yyyy')}-${String(Date.now()).slice(-4)}`;

      const lines = [];
      const collectLines = (rows, codes) => {
        rows.forEach(row => {
          codes.forEach(code => {
            const p = row.variants[code];
            if (!p) return;
            const qty = Number(quantities[p.id]) || 0;
            if (qty > 0) {
              lines.push({
                product_id: p.id,
                product_name: p.name,
                product_sku: p.sku,
                planned_qty: qty,
                status: 'pending',
              });
            }
          });
        });
      };
      collectLines(goalRows, VARIANT_CODES);
      collectLines(lowCarbRows, ['LC']);

      const created = await base44.entities.ProductionRun.create({
        run_number: runNumber,
        run_date: today,
        status: 'scheduled',
        total_lines: lines.length,
        total_units: totalUnits,
        notes: 'Ad-hoc top-up run',
      });

      const linesWithRun = lines.map(l => ({ ...l, run_id: created.id }));
      await base44.entities.ProductionRunLine.bulkCreate(linesWithRun);

      const cookingRunCount = await generateCookingRunsForRun(created.id, linesWithRun, today);

      writeAuditLog({
        action: 'create',
        entity_type: 'ProductionRun',
        entity_id: created.id,
        description: `Created ad-hoc run ${runNumber} — ${lines.length} meals, ${totalUnits} units, ${cookingRunCount} cooking runs`,
      });

      queryClient.invalidateQueries({ queryKey: ['production-runs'] });
      queryClient.invalidateQueries({ queryKey: ['wip-cooking-runs'] });
      toast.success(`Ad-hoc run created — ${lines.length} meals, ${totalUnits} units, ${cookingRunCount} cooking run${cookingRunCount !== 1 ? 's' : ''} queued`);
      setQuantities({});
      setSearch('');
      onOpenChange(false);
    } catch (err) {
      console.error('[AdHocRun] creation failed:', err);
      toast.error(`Failed to create run: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold flex items-center gap-2">
            <Factory className="w-5 h-5 text-primary" />
            Ad-Hoc Production Run
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Quick top-up run — enter quantities for the meals you want to produce.
          </p>
        </DialogHeader>

        {/* Search + summary */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search meals..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {search && (
            <Button variant="ghost" size="sm" onClick={() => setSearch('')} className="gap-1">
              <X className="w-3.5 h-3.5" /> Clear
            </Button>
          )}
          <div className="ml-auto flex items-center gap-4">
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Total</p>
              <p className="text-lg font-bold tabular-nums">{totalUnits.toLocaleString()}</p>
            </div>
            <Button
              onClick={handleCreate}
              disabled={creating || totalUnits === 0}
              className="gap-2 h-10"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Factory className="w-4 h-4" />}
              {creating ? 'Creating...' : 'Create Run'}
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <AdHocRunTable
            title="Goal-Related Meals"
            rows={filteredGoal}
            variantCodes={VARIANT_CODES}
            quantities={quantities}
            onQtyChange={handleQtyChange}
          />

          <AdHocRunTable
            title="Low Carb Meals"
            rows={filteredLC}
            variantCodes={['LC']}
            quantities={quantities}
            onQtyChange={handleQtyChange}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}