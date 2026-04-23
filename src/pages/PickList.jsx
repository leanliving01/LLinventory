import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import PickListHeader from '@/components/pick-list/PickListHeader';
import PickListCategory from '@/components/pick-list/PickListCategory';
import BarcodeScanner from '@/components/pick-list/BarcodeScanner';
import { generatePickListPdf } from '@/components/pick-list/PickListPdfExport';

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

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => base44.entities.Location.list('name', 50),
  });

  // Picked state: { [productId]: { picked: bool, qty: string } }
  const [pickedState, setPickedState] = useState({});
  const [showScanner, setShowScanner] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const queryClient = useQueryClient();

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

    // Exclude non-pickable items
    const PICK_EXCLUDE_PATTERNS = ['sleeve', 'vacuum'];
    for (const pid of Object.keys(ingredientAgg)) {
      const name = (ingredientAgg[pid].product.name || '').toLowerCase();
      if (PICK_EXCLUDE_PATTERNS.some(pat => name.includes(pat))) {
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
  }, [lines, boms, bomComponents, products, locations]);

  const hasUncategorized = pickItems.some(i => i.pickCategory === 'Uncategorized');
  const pickedCount = pickItems.filter(i => pickedState[i.product.id]?.picked).length;

  const handleTogglePicked = (productId, totalQty) => {
    setPickedState(prev => {
      const current = prev[productId] || { picked: false, qty: '' };
      return {
        ...prev,
        [productId]: {
          picked: !current.picked,
          qty: !current.picked ? String(totalQty) : current.qty,
        },
      };
    });
  };

  const handleQtyChange = (productId, value) => {
    setPickedState(prev => ({
      ...prev,
      [productId]: { ...(prev[productId] || { picked: false }), qty: value },
    }));
  };

  // Barcode scan auto-picks item
  const handleItemScanned = (productId, totalQty) => {
    setPickedState(prev => ({
      ...prev,
      [productId]: { picked: true, qty: String(totalQty) },
    }));
  };

  const handleCategorize = async () => {
    setCategorizing(true);
    try {
      const res = await base44.functions.invoke('categorizeProducts', {});
      toast.success(`${res.data.updated} products categorized`);
      queryClient.invalidateQueries({ queryKey: ['all-products'] });
    } catch (e) {
      toast.error('Failed to categorize: ' + (e.message || 'Unknown error'));
    }
    setCategorizing(false);
  };

  const handleExportPdf = () => {
    if (!run || pickItems.length === 0) return;
    generatePickListPdf({ run, lines, pickItems, categories });
    toast.success('PDF downloaded');
  };

  if (!run) {
    return <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-4 print:space-y-2">
      <PickListHeader
        runId={runId}
        runNumber={run.run_number}
        lineCount={lines.length}
        itemCount={pickItems.length}
        categoryCount={categories.length}
        pickedCount={pickedCount}
        hasUncategorized={hasUncategorized}
        categorizing={categorizing}
        onCategorize={handleCategorize}
        onPrint={() => window.print()}
        onExportPdf={handleExportPdf}
        onToggleScanner={() => setShowScanner(v => !v)}
        showScanner={showScanner}
      />

      {/* Print header */}
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">Pick List — {run.run_number}</h1>
        <p className="text-sm">{lines.length} meals · {pickItems.length} ingredients</p>
      </div>

      {/* Scanner */}
      {showScanner && (
        <BarcodeScanner pickItems={pickItems} onItemScanned={handleItemScanned} />
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-800 print:hidden">
        Stock is <strong>not</strong> deducted when picking — only when the run is completed. Tap checkboxes or scan barcodes to mark items as picked.
      </div>

      {/* Progress bar */}
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

      {/* Categories */}
      {categories.map(cat => (
        <PickListCategory
          key={cat}
          category={cat}
          items={pickItems.filter(i => i.pickCategory === cat)}
          pickedState={pickedState}
          onTogglePicked={handleTogglePicked}
          onQtyChange={handleQtyChange}
        />
      ))}

      {pickItems.length === 0 && (
        <div className="bg-card border border-border rounded-xl px-6 py-12 text-center text-sm text-muted-foreground">
          No ingredients found — check that recipes (Cook + Portion BOMs) are set up for the meals in this run.
        </div>
      )}
    </div>
  );
}