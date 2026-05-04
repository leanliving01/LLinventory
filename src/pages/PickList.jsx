import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScanBarcode, Check } from 'lucide-react';
import PickListHeader from '@/components/pick-list/PickListHeader';
import PickListCategory from '@/components/pick-list/PickListCategory';
import { generatePickListPdf } from '@/components/pick-list/PickListPdfExport';
import PickListPrintView from '@/components/pick-list/PickListPrintView';
import PickListEditModal from '@/components/pick-list/PickListEditModal';
import LiveTimer from '@/components/kitchen/LiveTimer';

/**
 * §5.1.3 Master Pick List
 * Aggregates raw ingredients across Cook BOMs for a production run.
 * Groups by pick_category. Interactive tablet picking + barcode scanner + PDF export.
 */
export default function PickList() {
  const runId = window.location.pathname.split('/').filter(Boolean).find((_, i, arr) => arr[i - 1] === 'run');

  const { data: run } = useQuery({
    queryKey: ['production-run', runId],
    queryFn: () => base44.entities.ProductionRun.filter({ id: runId }).then(r => r[0]),
    enabled: !!runId,
  });

  const { data: lines = [] } = useQuery({
    queryKey: ['production-run-lines', runId],
    queryFn: () => base44.entities.ProductionRunLine.filter({ run_id: runId }, 'product_sku', 200),
    enabled: !!runId,
  });

  const { data: boms = [] } = useQuery({
    queryKey: ['boms-active'],
    queryFn: () => base44.entities.Bom.filter({ is_active: true }, '-created_date', 500),
  });

  const { data: bomComponents = [] } = useQuery({
    queryKey: ['bom-components'],
    queryFn: () => base44.entities.BomComponent.list('-created_date', 2000),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['all-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });

  const { data: stockRecords = [] } = useQuery({
    queryKey: ['stock-on-hand'],
    queryFn: () => base44.entities.StockOnHand.list('-updated_date', 1000),
  });

  // Build stock map for display
  const stockMap = useMemo(() => {
    const map = {};
    stockRecords.forEach(s => {
      if (!map[s.product_id]) map[s.product_id] = 0;
      map[s.product_id] += s.qty_on_hand || 0;
    });
    return map;
  }, [stockRecords]);

  // Picked state: { [productId]: { picked: bool, qty: string } }
  const [pickedState, setPickedState] = useState({});
  const [confirmingPick, setConfirmingPick] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [editLog, setEditLog] = useState([]); // Track edits for display
  const queryClient = useQueryClient();

  const isConfirmed = !!run?.pick_list_confirmed;

  // Inline barcode scanner state
  const [scanInput, setScanInput] = useState('');
  const [lastScanned, setLastScanned] = useState(null);
  const scanInputRef = useRef(null);
  const bufferRef = useRef('');
  const timerRef = useRef(null);

  // Build ingredient pick list
  const { pickItems, categories } = useMemo(() => {
    if (!lines.length || !boms.length || !bomComponents.length || !products.length) {
      return { pickItems: [], categories: [] };
    }

    const productMap = {};
    products.forEach(p => { productMap[p.id] = p; });

    const compsByBom = {};
    bomComponents.forEach(c => {
      if (!compsByBom[c.bom_id]) compsByBom[c.bom_id] = [];
      compsByBom[c.bom_id].push(c);
    });

    const ingredientAgg = {};

    for (const line of lines) {
      const qty = line.planned_qty;
      if (qty <= 0) continue;

      const portionBom = boms.find(b => b.product_id === line.product_id && b.bom_type === 'portion');
      if (!portionBom) continue;

      const portionComps = compsByBom[portionBom.id] || [];
      for (const comp of portionComps) {
        const inputProduct = productMap[comp.input_product_id];
        if (!inputProduct) continue;

        const portionYield = portionBom.yield_qty || 1;
        const neededPerUnit = comp.qty / portionYield;
        const totalNeeded = neededPerUnit * qty;

        if (inputProduct.type === 'wip_bulk') {
          const cookBom = boms.find(b => b.product_id === inputProduct.id && b.bom_type === 'cook');
          if (cookBom) {
            const cookComps = compsByBom[cookBom.id] || [];
            const cookYield = cookBom.yield_qty || 1;
            for (const cc of cookComps) {
              if (cc.is_consumable) continue;
              const rawProduct = productMap[cc.input_product_id];
              if (!rawProduct) continue;
              const rawTotal = (cc.qty / cookYield) * totalNeeded;
              if (!ingredientAgg[rawProduct.id]) {
                ingredientAgg[rawProduct.id] = { product: rawProduct, totalQty: 0, uom: cc.uom || rawProduct.stock_uom };
              }
              ingredientAgg[rawProduct.id].totalQty += rawTotal;
            }
          } else {
            if (!ingredientAgg[inputProduct.id]) {
              ingredientAgg[inputProduct.id] = { product: inputProduct, totalQty: 0, uom: comp.uom || inputProduct.stock_uom };
            }
            ingredientAgg[inputProduct.id].totalQty += totalNeeded;
          }
        } else {
          if (!ingredientAgg[inputProduct.id]) {
            ingredientAgg[inputProduct.id] = { product: inputProduct, totalQty: 0, uom: comp.uom || inputProduct.stock_uom };
          }
          ingredientAgg[inputProduct.id].totalQty += totalNeeded;
        }
      }
    }

    // Exclude packaging materials — they're at the machines and auto-deducted on run completion
    for (const pid of Object.keys(ingredientAgg)) {
      const prod = ingredientAgg[pid].product;
      if (prod.type === 'packaging') {
        delete ingredientAgg[pid];
      }
    }

    const CATEGORY_ORDER = [
      'Meats', 'Vegetables', 'Starches', 'Spices & Seasoning',
      'Sauces & Condiments', 'Dairy & Eggs', 'Oils & Fats',
      'Dry Goods', 'Packaging', 'Other', 'Uncategorized',
    ];

    const items = Object.values(ingredientAgg).map(item => ({
      ...item,
      totalQty: Math.round(item.totalQty * 100) / 100,
      pickCategory: item.product.pick_category || 'Uncategorized',
    }));

    items.sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a.pickCategory);
      const bi = CATEGORY_ORDER.indexOf(b.pickCategory);
      if (ai !== bi) return ai - bi;
      return a.product.name.localeCompare(b.product.name);
    });

    const cats = [...new Set(items.map(i => i.pickCategory))];
    cats.sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));

    return { pickItems: items, categories: cats };
  }, [lines, boms, bomComponents, products]);

  // After confirmation, populate pickedState from the pick items so the UI shows green checks + qty
  const effectivePickedState = useMemo(() => {
    if (!isConfirmed) return pickedState;
    const state = {};
    pickItems.forEach(item => {
      state[item.product.id] = { picked: true, qty: String(item.totalQty) };
    });
    return state;
  }, [isConfirmed, pickedState, pickItems]);

  const pickedCount = pickItems.filter(i => {
    const s = effectivePickedState[i.product.id];
    return s?.picked && s?.qty && Number(s.qty) > 0;
  }).length;

  // Barcode scanner lookup map
  const lookupMap = useMemo(() => {
    const map = {};
    pickItems.forEach(item => {
      if (item.product.barcode) map[item.product.barcode.toLowerCase()] = item;
      if (item.product.sku) map[item.product.sku.toLowerCase()] = item;
    });
    return map;
  }, [pickItems]);

  const processCode = (code) => {
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;
    const found = lookupMap[trimmed];
    if (found) {
      setLastScanned(found);
      setPickedState(prev => ({
        ...prev,
        [found.product.id]: { picked: true, qty: prev[found.product.id]?.qty || '' },
      }));
      toast.success(`Checked: ${found.product.name} — enter qty picked`);
    } else {
      setLastScanned(null);
      toast.error(`No match for "${code.trim()}" on this pick list`);
    }
  };

  // Hardware barcode scanner listener (always active when picking)
  useEffect(() => {
    if (!run?.picking_started_at || run?.pick_list_confirmed) return;
    const handleKeyDown = (e) => {
      if (document.activeElement && document.activeElement !== scanInputRef.current &&
          (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.key === 'Enter') {
        if (bufferRef.current.length > 3) {
          processCode(bufferRef.current);
        }
        bufferRef.current = '';
        return;
      }
      if (e.key.length === 1) {
        bufferRef.current += e.key;
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => { bufferRef.current = ''; }, 100);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lookupMap, run?.picking_started_at, run?.pick_list_confirmed]);

  const handleScanSubmit = (e) => {
    e.preventDefault();
    processCode(scanInput);
    setScanInput('');
  };

  // Toggle checkbox only — never auto-fill qty
  const handleTogglePicked = (productId) => {
    setPickedState(prev => {
      const current = prev[productId] || { picked: false, qty: '' };
      return {
        ...prev,
        [productId]: { picked: !current.picked, qty: current.qty },
      };
    });
  };

  const handleQtyChange = (productId, value) => {
    setPickedState(prev => ({
      ...prev,
      [productId]: { ...(prev[productId] || { picked: false }), qty: value },
    }));
  };

  // Mark All for a category
  const handleMarkAll = (categoryItems) => {
    setPickedState(prev => {
      const next = { ...prev };
      categoryItems.forEach(item => {
        if (!next[item.product.id]?.picked) {
          next[item.product.id] = { picked: true, qty: next[item.product.id]?.qty || '' };
        }
      });
      return next;
    });
  };

  const handleStartPicking = async () => {
    await base44.entities.ProductionRun.update(runId, { picking_started_at: new Date().toISOString() });
    queryClient.invalidateQueries({ queryKey: ['production-run', runId] });
    toast.success('Picking timer started');
  };

  const handleExportPdf = () => {
    if (!run || pickItems.length === 0) return;
    generatePickListPdf({ run, lines, pickItems, categories, pickedState: effectivePickedState });
    toast.success('PDF downloaded');
  };

  // Edit a confirmed pick list item
  const handleEditSave = async ({ productId, productName, productSku, oldQty, newQty, reason, notes, uom }) => {
    const diff = newQty - oldQty;

    // Create adjustment stock movement
    if (diff !== 0) {
      await base44.entities.StockMovement.create({
        product_id: productId,
        product_sku: productSku,
        product_name: productName,
        qty: Math.abs(diff),
        uom,
        reason: diff > 0 ? 'production_consume' : 'return',
        ref_type: 'production_run',
        ref_id: runId,
        ref_number: run?.run_number || '',
        notes: `Pick list edit: ${reason}${notes ? ' — ' + notes : ''} (${oldQty} → ${newQty} ${uom})`,
      });

      // Update StockOnHand
      const sohRecords = await base44.entities.StockOnHand.list('-updated_date', 2000);
      const productSoh = sohRecords
        .filter(s => s.product_id === productId)
        .sort((a, b) => (b.qty_on_hand || 0) - (a.qty_on_hand || 0));

      if (diff > 0) {
        // More consumed — deduct from stock
        let remaining = diff;
        for (const soh of productSoh) {
          if (remaining <= 0) break;
          const deduct = Math.min(remaining, soh.qty_on_hand || 0);
          const newOnHand = Math.max(0, (soh.qty_on_hand || 0) - deduct);
          await base44.entities.StockOnHand.update(soh.id, {
            qty_on_hand: newOnHand,
            qty_available: newOnHand - (soh.qty_committed || 0),
            last_updated_at: new Date().toISOString(),
          });
          remaining -= deduct;
        }
      } else {
        // Less consumed — return stock
        const returnQty = Math.abs(diff);
        if (productSoh.length > 0) {
          const soh = productSoh[0];
          const newOnHand = (soh.qty_on_hand || 0) + returnQty;
          await base44.entities.StockOnHand.update(soh.id, {
            qty_on_hand: newOnHand,
            qty_available: newOnHand - (soh.qty_committed || 0),
            last_updated_at: new Date().toISOString(),
          });
        }
      }
    }

    // Update local picked state
    setPickedState(prev => ({
      ...prev,
      [productId]: { picked: true, qty: String(newQty) },
    }));

    // Log the edit for display
    setEditLog(prev => [...prev, {
      productName, oldQty, newQty, reason, notes, uom,
      timestamp: new Date().toISOString(),
    }]);

    queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
    toast.success(`Updated ${productName}: ${oldQty} → ${newQty} ${uom}`);
    setEditingItem(null);
  };

  const handleConfirmPickList = async () => {
    // Check for items picked below needed
    const belowNeeded = pickItems.filter(i => {
      const s = pickedState[i.product.id];
      if (!s?.picked || !s?.qty) return false;
      return Number(s.qty) < i.totalQty;
    });

    if (belowNeeded.length > 0) {
      const names = belowNeeded.map(i => i.product.name).join(', ');
      toast.error(`Cannot confirm: ${belowNeeded.length} item(s) picked below needed quantity (${names}). You need to pick at least what's required or go buy more.`, { duration: 8000 });
      return;
    }

    if (pickedCount < pickItems.length) {
      toast.error(`Only ${pickedCount} of ${pickItems.length} items picked. Pick all items before confirming.`);
      return;
    }
    setConfirmingPick(true);

    // Create stock consumption movements for all picked items
    for (const item of pickItems) {
      const state = pickedState[item.product.id];
      const qty = Number(state?.qty) || item.totalQty;
      await base44.entities.StockMovement.create({
        product_id: item.product.id,
        product_sku: item.product.sku,
        product_name: item.product.name,
        qty,
        uom: item.uom,
        reason: 'production_consume',
        ref_type: 'production_run',
        ref_id: runId,
        ref_number: run?.run_number || '',
        notes: `Pick list confirmed for run ${run?.run_number}`,
      });
    }

    // Decrement StockOnHand for consumed ingredients
    // Pick from the location with the MOST stock first, then deduct remainder from next
    const sohRecords = await base44.entities.StockOnHand.list('-updated_date', 2000);
    for (const item of pickItems) {
      const state = pickedState[item.product.id];
      let remaining = Number(state?.qty) || item.totalQty;
      // Get all SOH records for this product, sorted by qty_on_hand descending
      const productSoh = sohRecords
        .filter(s => s.product_id === item.product.id && (s.qty_on_hand || 0) > 0)
        .sort((a, b) => (b.qty_on_hand || 0) - (a.qty_on_hand || 0));
      for (const soh of productSoh) {
        if (remaining <= 0) break;
        const deduct = Math.min(remaining, soh.qty_on_hand || 0);
        const newOnHand = Math.max(0, (soh.qty_on_hand || 0) - deduct);
        await base44.entities.StockOnHand.update(soh.id, {
          qty_on_hand: newOnHand,
          qty_available: newOnHand - (soh.qty_committed || 0),
          last_updated_at: new Date().toISOString(),
        });
        remaining -= deduct;
      }
    }

    // Mark the run as pick list confirmed with finished timestamp
    await base44.entities.ProductionRun.update(runId, {
      pick_list_confirmed: true,
      picking_finished_at: new Date().toISOString(),
    });
    queryClient.invalidateQueries({ queryKey: ['production-run', runId] });
    queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
    toast.success('Pick list confirmed — stock consumed from storage');
    setConfirmingPick(false);
  };

  if (!run) {
    return <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>;
  }

  const isPicking = !!run.picking_started_at && !run.pick_list_confirmed;

  return (
    <div className="space-y-4 print:space-y-2">
      <PickListHeader
        runId={runId}
        runNumber={run.run_number}
        lineCount={lines.length}
        itemCount={pickItems.length}
        pickedCount={pickedCount}
        onPrint={() => window.print()}
        onExportPdf={handleExportPdf}
      />

      {/* Print view — mirrors the PDF layout */}
      <PickListPrintView
        run={run}
        lines={lines}
        pickItems={pickItems}
        categories={categories}
        pickedState={effectivePickedState}
      />

      {/* Inline scanner — visible only while picking is active */}
      {isPicking && (
        <div className="bg-card border-2 border-primary/30 rounded-xl px-4 py-3 print:hidden">
          <form onSubmit={handleScanSubmit} className="flex items-center gap-3">
            <ScanBarcode className="w-5 h-5 text-primary shrink-0" />
            <Input
              ref={scanInputRef}
              value={scanInput}
              onChange={e => setScanInput(e.target.value)}
              placeholder="Scan barcode or type SKU..."
              className="h-11 text-base font-mono flex-1"
            />
            <Button type="submit" size="default" className="h-11 px-5 gap-1.5">
              <Check className="w-4 h-4" /> Find
            </Button>
          </form>
          {lastScanned && (
            <div className="flex items-center gap-2 mt-2 text-sm text-amber-700 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
              <Check className="w-4 h-4 shrink-0" />
              <span><strong>{lastScanned.product.name}</strong> — checked ✓ enter the qty you picked</span>
            </div>
          )}
        </div>
      )}

      {run?.pick_list_confirmed ? (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 text-sm text-green-700 print:hidden flex items-center justify-between">
          <span>✓ Pick list confirmed — stock has been consumed from storage. Kitchen tasks can now begin.</span>
          {run.picking_started_at && run.picking_finished_at && (
            <span className="text-xs font-mono text-green-600">
              Picking time: {(() => {
                const ms = new Date(run.picking_finished_at).getTime() - new Date(run.picking_started_at).getTime();
                const m = Math.floor(ms / 60000);
                const s = Math.floor((ms % 60000) / 1000);
                return `${m}m ${s}s`;
              })()}
            </span>
          )}
        </div>
      ) : !run.picking_started_at ? (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4 text-sm text-blue-800 print:hidden flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold">Ready to pick?</p>
            <p className="text-xs text-blue-600 mt-0.5">Items are locked until you start. Timer and scanner begin when you press the button.</p>
          </div>
          <Button
            onClick={handleStartPicking}
            disabled={pickItems.length === 0}
            size="lg"
            className="shrink-0 gap-2 bg-blue-600 hover:bg-blue-700 text-white px-8"
          >
            Start Picking
          </Button>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-800 print:hidden flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span>Picking in progress</span>
            <LiveTimer
              startedAt={run.picking_started_at}
              isActive={true}
              className="font-mono text-sm font-bold text-amber-700"
            />
          </div>
          <Button
            onClick={handleConfirmPickList}
            disabled={confirmingPick || pickedCount < pickItems.length}
            className="shrink-0 bg-green-600 hover:bg-green-700 text-white gap-1.5"
            size="sm"
          >
            {confirmingPick ? 'Confirming...' : `Confirm Pick List (${pickedCount}/${pickItems.length})`}
          </Button>
        </div>
      )}

      {/* Progress bar — screen only */}
      {pickItems.length > 0 && (
        <div className="print:hidden">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Pick progress</span>
            <span className="font-semibold">{pickedCount} / {pickItems.length}</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2.5">
            <div
              className="bg-green-500 h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${pickItems.length ? (pickedCount / pickItems.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Categories — hidden when printing (print view handles it) */}
      <div className="print:hidden">
        {categories.map(cat => (
          <PickListCategory
            key={cat}
            category={cat}
            items={pickItems.filter(i => i.pickCategory === cat)}
            pickedState={effectivePickedState}
            stockMap={stockMap}
            onTogglePicked={handleTogglePicked}
            onQtyChange={handleQtyChange}
            onMarkAll={handleMarkAll}
            disabled={!run.picking_started_at || run.pick_list_confirmed}
            isConfirmed={isConfirmed}
            onEditItem={isConfirmed ? setEditingItem : null}
          />
        ))}
      </div>

      {pickItems.length === 0 && (
        <div className="bg-card border border-border rounded-xl px-6 py-12 text-center text-sm text-muted-foreground print:hidden">
          No ingredients found — check that recipes (Cook + Portion BOMs) are set up for the meals in this run.
        </div>
      )}

      {/* Edit log — show after confirmed */}
      {isConfirmed && editLog.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 print:hidden">
          <p className="text-xs font-semibold text-amber-800 mb-2">Pick List Edits ({editLog.length})</p>
          <div className="space-y-1">
            {editLog.map((log, i) => (
              <p key={i} className="text-xs text-amber-700">
                <span className="font-medium">{log.productName}</span>: {log.oldQty} → {log.newQty} {log.uom}
                <span className="text-amber-500 ml-2">— {log.reason}</span>
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editingItem && (
        <PickListEditModal
          item={editingItem}
          currentQty={Number(effectivePickedState[editingItem.product.id]?.qty) || editingItem.totalQty}
          onSave={handleEditSave}
          onCancel={() => setEditingItem(null)}
        />
      )}
    </div>
  );
}