import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { CATEGORY_LABELS, CATEGORY_ORDER, CATEGORY_HEADER_BG, getSubcategoryColor, resolveSubcategory } from '@/lib/productClassification';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, ChevronDown, ChevronRight, Search, Camera, Save, CheckCircle2, Loader2, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';
import CameraScanner from '@/components/floor/CameraScanner';
import { saveFloorCounts, completeFloorCount, RECOUNT_STATUSES } from '@/lib/stockCount';

/**
 * Floor counting screen. One row per product. NEVER shows system qty, variance,
 * cost or value — only the count UOM and the quantity input.
 */
export default function FloorCountSession({ count, onBack }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userName = user?.full_name || user?.email || 'Floor';

  const [counts, setCounts] = useState({});       // lineId → value (string)
  const [uomKey, setUomKey] = useState({});       // lineId → selected option key
  const [seeded, setSeeded] = useState(false);
  const [search, setSearch] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [highlightId, setHighlightId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const toggleCollapse = (key) =>
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  // Explicitly mark every new group key as open (false) the moment it appears,
  // so stale HMR state or a re-render never leaves a group silently closed.
  useEffect(() => {
    if (!grouped.order.length) return;
    setCollapsed(prev => {
      const next = { ...prev };
      let changed = false;
      grouped.order.forEach(cat => {
        if (!(cat in next)) { next[cat] = false; changed = true; }
        Object.keys(grouped.cats[cat] || {}).forEach(sub => {
          const k = `${cat}::${sub}`;
          if (!(k in next)) { next[k] = false; changed = true; }
        });
      });
      return changed ? next : prev;
    });
  }, [grouped]);

  const locked = count.status === 'completed' || count.status === 'cancelled';
  const isRecount = RECOUNT_STATUSES.includes(count.status);

  const { data: allLines = [], isLoading } = useQuery({
    queryKey: ['floor-count-lines', count.id],
    queryFn: () => base44.entities.StockTakeLine.filter({ stocktake_id: count.id }, 'product_name', 5000),
  });

  // In a recount, only the items flagged for recount are shown.
  const lines = useMemo(
    () => (isRecount ? allLines.filter(l => l.recount_requested) : allLines),
    [allLines, isRecount]
  );

  // Count UOM options per product (default + alternates) for the unit dropdown.
  const productIds = useMemo(() => Array.from(new Set(lines.map(l => l.product_id))), [lines]);
  const { data: countUoms = [] } = useQuery({
    queryKey: ['floor-count-uoms', count.id, productIds.length],
    queryFn: () => base44.entities.StockCountUom.filter({ product_id: productIds }, 'count_uom', 5000),
    enabled: productIds.length > 0,
  });

  const { data: productsData = [] } = useQuery({
    queryKey: ['floor-count-product-detail', count.id, productIds.length],
    queryFn: () => productIds.length ? base44.entities.Product.filter({ id: productIds }, 'name', 5000) : [],
    enabled: productIds.length > 0,
  });
  const productById = useMemo(
    () => Object.fromEntries(productsData.map(p => [p.id, p])),
    [productsData]
  );

  // optionsByProduct: list of selectable units, always including the base stock UOM.
  const optionsByLine = useMemo(() => {
    const byProduct = {};
    countUoms.forEach(u => { (byProduct[u.product_id] = byProduct[u.product_id] || []).push(u); });
    const map = {};
    lines.forEach(l => {
      const base = { key: '__stock__', count_uom: l.stock_uom || 'unit', conversion_factor: 1, count_uom_label: '' };
      const extras = (byProduct[l.product_id] || []).map(u => ({
        key: u.id, count_uom: u.count_uom, conversion_factor: Number(u.conversion_factor) || 1, count_uom_label: u.count_uom_label || '',
      }));
      map[l.id] = [base, ...extras];
    });
    return map;
  }, [lines, countUoms]);

  // Seed local inputs + selected UOM key from saved lines (once).
  useEffect(() => {
    if (seeded || !lines.length) return;
    const initCounts = {};
    const initUom = {};
    lines.forEach(l => {
      if (l.counted_qty != null) initCounts[l.id] = String(l.counted_qty);
      const opts = optionsByLine[l.id] || [];
      const match = opts.find(o => o.key !== '__stock__' && o.count_uom === l.count_uom && Number(o.conversion_factor) === Number(l.conversion_factor));
      initUom[l.id] = match ? match.key : '__stock__';
    });
    setCounts(initCounts);
    setUomKey(initUom);
    setSeeded(true);
  }, [lines, optionsByLine, seeded]);

  const multiLocation = useMemo(
    () => new Set(lines.map(l => l.location_id || '').filter(Boolean)).size > 1,
    [lines]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return lines;
    const q = search.trim().toLowerCase();
    return lines.filter(l =>
      (l.product_name || '').toLowerCase().includes(q) ||
      (l.product_sku || '').toLowerCase().includes(q)
    );
  }, [lines, search]);

  const grouped = useMemo(() => {
    const cats = {};
    for (const line of lines) {
      const product = productById[line.product_id];
      const cat = product?.type || '__unknown__';
      const sub = product ? resolveSubcategory(product) : 'Unknown';
      const pname = line.product_name || 'Unknown Product';
      if (!cats[cat]) cats[cat] = {};
      if (!cats[cat][sub]) cats[cat][sub] = {};
      if (!cats[cat][sub][pname]) cats[cat][sub][pname] = [];
      cats[cat][sub][pname].push(line);
    }
    const order = [...CATEGORY_ORDER.filter(c => cats[c]), ...(cats['__unknown__'] ? ['__unknown__'] : [])];
    return { order, cats };
  }, [lines, productById]);

  const countedCount = Object.values(counts).filter(v => v !== '' && v != null).length;

  // Barcode scan → jump to the matching line.
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const handleScan = (code) => {
    const t = code.trim().toLowerCase();
    const found = linesRef.current.find(l => (l.product_sku || '').toLowerCase() === t);
    if (found) {
      setHighlightId(found.id);
      setSearch(found.product_sku || '');
      toast.success(`Found: ${found.product_name}`);
      setTimeout(() => setHighlightId(null), 3000);
    } else {
      toast.error(`No match for "${code.trim()}" in this count`);
    }
    setShowCamera(false);
  };

  const entriesPayload = () =>
    Object.entries(counts)
      .filter(([, v]) => v !== '' && v != null)
      .map(([id, v]) => {
        const opts = optionsByLine[id] || [];
        const sel = opts.find(o => o.key === uomKey[id]) || opts[0];
        return {
          id,
          counted_qty: v,
          count_uom: sel?.count_uom,
          count_uom_label: sel?.count_uom_label || null,
          conversion_factor: sel?.conversion_factor || 1,
        };
      });

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveFloorCounts(count.id, entriesPayload(), userName);
      queryClient.invalidateQueries({ queryKey: ['floor-count-lines', count.id] });
      queryClient.invalidateQueries({ queryKey: ['floor-stock-counts'] });
      toast.success('Progress saved');
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async () => {
    const uncounted = lines.length - countedCount;
    if (uncounted > 0 && !window.confirm(`${uncounted} item(s) not counted yet. Complete the count anyway?`)) {
      return;
    }
    setCompleting(true);
    try {
      await saveFloorCounts(count.id, entriesPayload(), userName);
      await completeFloorCount(count.id, userName);
      queryClient.invalidateQueries({ queryKey: ['floor-stock-counts'] });
      toast.success('Count completed and sent for review');
      onBack();
    } catch (err) {
      toast.error('Complete failed: ' + (err.message || 'Unknown error'));
      setCompleting(false);
    }
  };

  return (
    <div className="space-y-4 pb-40">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="w-5 h-5" /></Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold truncate">{count.reference}</h1>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <MapPin className="w-3 h-3" /> {count.location_name} · {countedCount}/{lines.length} counted
          </p>
        </div>
      </div>

      {/* Search + scan */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SKU or name..." className="pl-9 h-10" />
        </div>
        <Button variant="outline" className="h-10 w-10 shrink-0" onClick={() => setShowCamera(true)}>
          <Camera className="w-5 h-5" />
        </Button>
      </div>

      {showCamera && <CameraScanner active={showCamera} onScan={handleScan} onClose={() => setShowCamera(false)} />}

      {/* Count list — no system qty / variance / cost shown */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading items...</div>
      ) : search.trim() ? (
        /* Flat filtered list when the user is searching / scanning */
        <div className="bg-card border border-border rounded-2xl divide-y divide-border">
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No items match.</p>
          ) : filtered.map(l => (
            <FloorCountLineRow
              key={l.id}
              l={l}
              counts={counts}
              setCounts={setCounts}
              uomKey={uomKey}
              setUomKey={setUomKey}
              optionsByLine={optionsByLine}
              multiLocation={multiLocation}
              isRecount={isRecount}
              locked={locked}
              highlightId={highlightId}
            />
          ))}
        </div>
      ) : (
        /* Grouped view: category → subcategory → sorted by SKU */
        <div className="space-y-3">
          {grouped.order.length === 0 && (
            <p className="text-center py-8 text-sm text-muted-foreground">No items in this count.</p>
          )}
          {grouped.order.map(cat => {
            const subMap = grouped.cats[cat];
            const catLabel = CATEGORY_LABELS[cat] || cat;
            const isCatOpen = !collapsed[cat];
            const allCatLines = Object.values(subMap).flatMap(subProds => Object.values(subProds).flat());
            const catCounted = allCatLines.filter(l => counts[l.id] !== undefined && counts[l.id] !== '').length;
            return (
              <div key={cat} className="rounded-2xl border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleCollapse(cat)}
                  className={cn(
                    'w-full flex items-center justify-between px-4 py-3 text-gray-900',
                    CATEGORY_HEADER_BG[cat] || 'bg-gray-300'
                  )}
                >
                  <div className="flex items-center gap-2">
                    {isCatOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                    <span className="font-bold text-sm">{catLabel}</span>
                  </div>
                  <Badge variant={catCounted === allCatLines.length ? 'default' : 'outline'} className="text-xs">
                    {catCounted}/{allCatLines.length}
                  </Badge>
                </button>
                {isCatOpen && Object.entries(subMap)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([sub, productMap]) => {
                    const subKey = `${cat}::${sub}`;
                    const isSubOpen = !collapsed[subKey];
                    const subLines = Object.values(productMap).flat();
                    const subCounted = subLines.filter(l => counts[l.id] !== undefined && counts[l.id] !== '').length;
                    return (
                      <div key={sub}>
                        <button
                          type="button"
                          onClick={() => toggleCollapse(subKey)}
                          className={cn(
                            'w-full flex items-center justify-between px-4 py-2 border-y border-black/10 text-gray-900',
                            getSubcategoryColor(sub) || 'bg-gray-100'
                          )}
                        >
                          <div className="flex items-center gap-2">
                            {isSubOpen ? <ChevronDown className="w-3.5 h-3.5 opacity-50" /> : <ChevronRight className="w-3.5 h-3.5 opacity-50" />}
                            <span className="text-xs font-semibold">{sub}</span>
                          </div>
                          <span className="text-xs opacity-70">{subCounted}/{subLines.length}</span>
                        </button>
                        {isSubOpen && (
                          <div className="divide-y divide-border">
                            {Object.entries(productMap)
                              .sort(([, aLines], [, bLines]) =>
                                (aLines[0]?.product_sku || '').localeCompare(bLines[0]?.product_sku || ''))
                              .map(([, plines]) => plines.map(l => (
                                <FloorCountLineRow
                                  key={l.id}
                                  l={l}
                                  counts={counts}
                                  setCounts={setCounts}
                                  uomKey={uomKey}
                                  setUomKey={setUomKey}
                                  optionsByLine={optionsByLine}
                                  multiLocation={multiLocation}
                                  isRecount={isRecount}
                                  locked={locked}
                                  highlightId={highlightId}
                                />
                              )))}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      )}

      {/* Sticky save/complete — visible whenever there are entries */}
      {!locked && (
        <div className="fixed bottom-[68px] left-0 right-0 bg-card/95 backdrop-blur border-t border-border px-4 py-3 z-30 flex gap-2">
          <Button variant="outline" onClick={handleSave} disabled={saving || completing} className="flex-1 h-12 gap-2">
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            Save & Continue
          </Button>
          <Button onClick={handleComplete} disabled={saving || completing || countedCount === 0} className="flex-1 h-12 gap-2 bg-green-600 hover:bg-green-700">
            {completing ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
            Complete Count
          </Button>
        </div>
      )}
    </div>
  );
}

function FloorCountLineRow({ l, counts, setCounts, uomKey, setUomKey, optionsByLine, multiLocation, isRecount, locked, highlightId }) {
  return (
    <div className={cn('px-4 py-3 flex items-center gap-3 transition-colors', highlightId === l.id && 'bg-primary/5')}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{l.product_name}</p>
        {multiLocation && l.location_name && (
          <p className="text-[11px] text-primary flex items-center gap-1"><MapPin className="w-3 h-3" /> {l.location_name}</p>
        )}
        {isRecount && l.previous_counted_qty != null && (
          <p className="text-[11px] text-orange-600">Previous count: {l.previous_counted_qty}</p>
        )}
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] font-mono text-muted-foreground">{l.product_sku}</span>
          {(optionsByLine[l.id]?.length || 0) > 1 ? (
            <Select value={uomKey[l.id] || '__stock__'} onValueChange={v => setUomKey(prev => ({ ...prev, [l.id]: v }))} disabled={locked}>
              <SelectTrigger className="h-6 text-[11px] w-auto gap-1 px-2"><SelectValue /></SelectTrigger>
              <SelectContent>
                {optionsByLine[l.id].map(o => (
                  <SelectItem key={o.key} value={o.key}>
                    {o.count_uom}{o.count_uom_label ? ` — ${o.count_uom_label}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="outline" className="text-[10px]">{l.count_uom || l.stock_uom || 'unit'}</Badge>
          )}
        </div>
      </div>
      <Input
        type="number"
        inputMode="decimal"
        min="0"
        value={counts[l.id] ?? ''}
        onChange={e => setCounts(prev => ({ ...prev, [l.id]: e.target.value }))}
        placeholder="0"
        disabled={locked}
        className="h-11 w-24 text-right text-base"
      />
    </div>
  );
}
