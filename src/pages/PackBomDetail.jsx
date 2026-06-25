import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Save, Loader2, AlertTriangle, RotateCcw, Package, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import PackBomMealRow from '@/components/pack-bom/PackBomMealRow';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function parseOverrides(str) {
  if (!str) return {};
  try { return JSON.parse(str); } catch { return {}; }
}

export default function PackBomDetail() {
  const { packBomId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [showRecalcPrompt, setShowRecalcPrompt] = useState(false);
  const [recalcRunning, setRecalcRunning] = useState(false);

  const { data: packBom, isLoading } = useQuery({
    queryKey: ['pack-bom', packBomId],
    queryFn: async () => {
      const results = await base44.entities.PackBom.filter({ id: packBomId });
      return results[0] || null;
    },
    enabled: !!packBomId,
  });

  // Load product names for display
  const { data: products = [] } = useQuery({
    queryKey: ['products-for-packbom'],
    queryFn: () => base44.entities.Product.list('sku', 1000),
  });

  const productMap = useMemo(() => {
    const m = {};
    products.forEach(p => { m[p.sku] = p; });
    return m;
  }, [products]);

  // Is this pack's composition mastered by a Packing BOM? If so, direct edits
  // here are auto-overwritten from that BOM — point the user to the master.
  const pkgProduct = useMemo(
    () => products.find(p => (p.sku || '').toUpperCase() === (packBom?.package_sku || '').toUpperCase()) || null,
    [products, packBom],
  );
  const { data: masterBoms = [] } = useQuery({
    queryKey: ['pack-bom-master', pkgProduct?.id],
    queryFn: () => base44.entities.Bom.filter({ product_id: pkgProduct.id, bom_class: 'packing' }),
    enabled: !!pkgProduct?.id,
  });
  const hasMasterBom = masterBoms.some(b => b.is_active !== false);

  // Local editable state
  const [disabledSkus, setDisabledSkus] = useState(null);
  const [overrides, setOverrides] = useState(null);

  // Lazy-init from packBom
  useEffect(() => {
    if (packBom && disabledSkus === null) {
      setDisabledSkus(new Set(packBom.disabled_skus || []));
      setOverrides(parseOverrides(packBom.sku_overrides));
    }
  }, [packBom, disabledSkus]);

  const allSkus = packBom?.component_skus || [];
  const defaultMultiplier = packBom?.multiplier || 1;

  const activeSkus = useMemo(() => {
    if (!disabledSkus) return [];
    return allSkus.filter(s => !disabledSkus.has(s));
  }, [allSkus, disabledSkus]);

  const totalMeals = useMemo(() => {
    if (!overrides || !disabledSkus) return 0;
    return activeSkus.reduce((sum, sku) => sum + (overrides[sku] || defaultMultiplier), 0);
  }, [activeSkus, overrides, defaultMultiplier, disabledSkus]);

  // The full pack size = every meal at its saved per-meal quantity (override or
  // default ×). Using allSkus.length * defaultMultiplier was wrong for packs that
  // store per-meal overrides (e.g. WWR uses multiplier=1 + a qty per meal), which
  // produced a false "doesn't match expected size" warning.
  const originalTotal = useMemo(() => {
    const orig = parseOverrides(packBom?.sku_overrides);
    return allSkus.reduce((sum, sku) => sum + (orig[sku] || defaultMultiplier), 0);
  }, [allSkus, packBom, defaultMultiplier]);

  const toggleSku = useCallback((sku) => {
    setDisabledSkus(prev => {
      const next = new Set(prev);
      if (next.has(sku)) {
        next.delete(sku);
        // Reset override when re-enabling
        setOverrides(o => { const copy = { ...o }; delete copy[sku]; return copy; });
      } else {
        next.add(sku);
        // Remove override for disabled SKU
        setOverrides(o => { const copy = { ...o }; delete copy[sku]; return copy; });
      }
      return next;
    });
  }, []);

  const setSkuMultiplier = useCallback((sku, val) => {
    const num = parseInt(val) || 0;
    setOverrides(prev => {
      if (num === defaultMultiplier) {
        const copy = { ...prev };
        delete copy[sku];
        return copy;
      }
      return { ...prev, [sku]: num };
    });
  }, [defaultMultiplier]);

  const handleAutoRedistribute = useCallback(() => {
    if (!disabledSkus || activeSkus.length === 0) return;
    // Distribute originalTotal evenly among active SKUs
    const basePerSku = Math.floor(originalTotal / activeSkus.length);
    const remainder = originalTotal - (basePerSku * activeSkus.length);
    const newOverrides = {};
    activeSkus.forEach((sku, i) => {
      const qty = basePerSku + (i < remainder ? 1 : 0);
      if (qty !== defaultMultiplier) newOverrides[sku] = qty;
    });
    setOverrides(newOverrides);
    toast.success(`Redistributed ${originalTotal} meals across ${activeSkus.length} active meals`);
  }, [disabledSkus, activeSkus, originalTotal, defaultMultiplier]);

  const handleResetAll = useCallback(() => {
    setDisabledSkus(new Set());
    setOverrides({});
    toast.info('Reset to standard composition');
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const disabledArr = [...disabledSkus];
    const overridesClean = {};
    for (const [sku, val] of Object.entries(overrides)) {
      if (val !== defaultMultiplier && !disabledSkus.has(sku)) overridesClean[sku] = val;
    }
    try {
      await base44.entities.PackBom.update(packBomId, {
        disabled_skus: disabledArr,
        sku_overrides: JSON.stringify(overridesClean),
      });
      toast.success('Pack composition saved — new orders will use this composition');
      // Wait for fresh data before resetting local state
      await queryClient.invalidateQueries({ queryKey: ['pack-bom', packBomId] });
      await queryClient.invalidateQueries({ queryKey: ['pack-boms'] });
      setDisabledSkus(null);
      setOverrides(null);
      // Prompt user to recalculate committed stock
      setShowRecalcPrompt(true);
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = useMemo(() => {
    if (!packBom || !disabledSkus || !overrides) return false;
    const origDisabled = new Set(packBom.disabled_skus || []);
    const origOverrides = parseOverrides(packBom.sku_overrides);
    // Compare disabled sets
    if (disabledSkus.size !== origDisabled.size) return true;
    for (const s of disabledSkus) { if (!origDisabled.has(s)) return true; }
    // Compare overrides (order-independent)
    const cleanOverrides = {};
    for (const [k, v] of Object.entries(overrides)) { if (!disabledSkus.has(k) && v !== defaultMultiplier) cleanOverrides[k] = v; }
    const cleanKeys = Object.keys(cleanOverrides).sort();
    const origKeys = Object.keys(origOverrides).sort();
    if (cleanKeys.length !== origKeys.length) return true;
    for (const k of cleanKeys) {
      if (cleanOverrides[k] !== origOverrides[k]) return true;
    }
    return false;
  }, [packBom, disabledSkus, overrides, defaultMultiplier]);

  if (isLoading || !packBom || disabledSkus === null) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  const isMismatch = totalMeals !== originalTotal;

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/purchasing/pack-bom')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold font-mono">{packBom.package_sku}</h1>
            <p className="text-sm text-muted-foreground">
              {packBom.portion_weight_g}g portions · Default ×{defaultMultiplier} each
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleResetAll} className="gap-1.5">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </Button>
        </div>
      </div>

      {/* Master-BOM notice — composition is auto-synced from the Packing BOM */}
      {hasMasterBom && pkgProduct && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800">
          <p className="text-xs text-blue-800 dark:text-blue-300">
            <strong>Auto-synced from the Packing BOM.</strong> This pack’s meals come from its Packing BOM — edits here are a quick override and get replaced when the Packing BOM changes. Edit there to make permanent changes.
          </p>
          <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={() => navigate(`/recipes/product/${pkgProduct.id}`)}>
            <Package className="w-3.5 h-3.5" /> Open Packing BOM
          </Button>
        </div>
      )}

      {/* Summary bar */}
      <div className={`flex items-center justify-between px-4 py-3 rounded-xl border ${
        isMismatch ? 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800' : 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
      }`}>
        <div className="flex items-center gap-2">
          {isMismatch ? <AlertTriangle className="w-5 h-5 text-amber-600" /> : <Package className="w-5 h-5 text-green-600" />}
          <span className="text-sm font-medium">
            {activeSkus.length} of {allSkus.length} meals active
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className={`text-lg font-bold tabular-nums ${isMismatch ? 'text-amber-700' : 'text-green-700'}`}>
            {totalMeals} / {originalTotal} meals
          </span>
          {isMismatch && disabledSkus.size > 0 && (
            <Button size="sm" variant="outline" onClick={handleAutoRedistribute} className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-100">
              Auto-redistribute
            </Button>
          )}
        </div>
      </div>

      {isMismatch && (
        <p className="text-xs text-amber-600">
          ⚠ Total meals ({totalMeals}) doesn't match the expected pack size ({originalTotal}). 
          Use "Auto-redistribute" to even out, or manually adjust quantities below.
        </p>
      )}

      {/* Meal table */}
      <div className="bg-card border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="w-14 px-3 py-2.5 text-center text-[10px] font-semibold text-muted-foreground uppercase">Active</th>
              <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">SKU</th>
              <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Meal Name</th>
              <th className="w-24 text-center px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Qty</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {allSkus.map(sku => (
              <PackBomMealRow
                key={sku}
                sku={sku}
                productName={productMap[sku]?.name || sku}
                isDisabled={disabledSkus.has(sku)}
                multiplier={overrides[sku] || defaultMultiplier}
                defaultMultiplier={defaultMultiplier}
                onToggle={() => toggleSku(sku)}
                onMultiplierChange={(val) => setSkuMultiplier(sku, val)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Recalc Prompt after PackBom save */}
      <AlertDialog open={showRecalcPrompt} onOpenChange={setShowRecalcPrompt}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Recalculate Committed Stock?</AlertDialogTitle>
            <AlertDialogDescription>
              PackBom updated. Recalculate committed stock now so inventory numbers reflect the new composition? 
              This takes about 1-2 minutes and does not modify any order data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={recalcRunning}>Later</AlertDialogCancel>
            <AlertDialogAction
              disabled={recalcRunning}
              onClick={async (e) => {
                e.preventDefault();
                setRecalcRunning(true);
                try {
                  // Step 1: Reset demand_calculated for all orders with this package SKU
                  // and immediately re-decompose them with the updated BOM.
                  const fnBase = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
                  const headers = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                    'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                  };
                  await fetch(`${fnBase}/recalc-demand`, { method: 'POST', headers, body: JSON.stringify({ force_package_sku: packBom?.package_sku }) });
                  // Step 2: Recalculate committed stock from the freshly decomposed lines.
                  const csRes = await fetch(`${fnBase}/recalc-committed-stock`, { method: 'POST', headers, body: '{}' });
                  const d = csRes.ok ? await csRes.json() : {};
                  toast.success(
                    `Stock commitment updated — ${d.orders_processed ?? '?'} orders, ${d.unique_skus ?? '?'} SKUs in ${d.elapsed_seconds ?? '?'}s. Remaining orders sync within 15 min.`
                  );
                  setShowRecalcPrompt(false);
                } catch (err) {
                  toast.error('Recalculation failed: ' + (err.message || 'Unknown error'));
                } finally {
                  setRecalcRunning(false);
                }
              }}
            >
              {recalcRunning ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              {recalcRunning ? 'Recalculating…' : 'Recalculate Now'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Sticky save bar */}
      {hasChanges && (
        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-3 -mx-6 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {disabledSkus.size > 0 && `${disabledSkus.size} meal${disabledSkus.size !== 1 ? 's' : ''} disabled`}
            {Object.keys(overrides).length > 0 && ` · ${Object.keys(overrides).length} qty override${Object.keys(overrides).length !== 1 ? 's' : ''}`}
          </p>
          <Button onClick={handleSave} disabled={saving} className="gap-2 min-w-[200px]">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving...' : 'Save Composition'}
          </Button>
        </div>
      )}
    </div>
  );
}