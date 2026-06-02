import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ScanBarcode, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import FloorOrderPicker from '@/components/floor/FloorOrderPicker';
import FloorPackList from '@/components/floor/FloorPackList';
import FloorPackTimer from '@/components/floor/FloorPackTimer';
import CameraScanner from '@/components/floor/CameraScanner';
import PackerSelectModal from '@/components/floor/PackerSelectModal';
import { useScanFeedback } from '@/components/floor/ScanFeedback';
import ScanResultBanner from '@/components/floor/ScanResultBanner';
import { computePackedSnapshot } from '@/lib/packingMetrics';

/* ── SKU-to-friendly-name map ── */
const SKU_LABELS = {
  MenLeaMus: "Men's Lean Muscle",
  MenWeiLos: "Men's Weight Loss",
  WomLeaMus: "Women's Lean Muscle",
  WomWeiLos: "Women's Weight Loss",
  LowCar: "Low Carb",
};

function friendlyPackageName(sku, name) {
  if (!sku) return name || 'Package';
  for (const [prefix, label] of Object.entries(SKU_LABELS)) {
    if (sku.startsWith(prefix)) {
      const num = sku.replace(prefix, '');
      return `${label} — ${num} Pack`;
    }
  }
  if (/byo/i.test(sku) || /build.your.own/i.test(name || '')) return 'Build Your Own';
  return name || sku;
}

/** Find the matching PackBom color for a parent SKU */
function resolvePackColor(parentSku, packBoms) {
  if (!parentSku || !packBoms?.length) return null;
  const skuLower = parentSku.toLowerCase();
  // Exact match first
  const exact = packBoms.find(pb => (pb.package_sku || '').toLowerCase() === skuLower);
  if (exact?.pack_color_theme) return exact.pack_color_theme;
  // Prefix match (e.g. MenLeaMus15 matches MenLeaMus prefix)
  const prefix = packBoms.find(pb => {
    const pbSku = (pb.package_sku || '').toLowerCase();
    return skuLower.startsWith(pbSku) || pbSku.startsWith(skuLower);
  });
  return prefix?.pack_color_theme || null;
}

// Per-section column maps + helpers (split packing: supplements vs meals).
const SECTION_COLS = {
  supplements: { status: 'sup_status', packerId: 'sup_packer_id', packerName: 'sup_packer_name', active: 'sup_active_seconds', seg: 'sup_segment_started_at', scanned: 'sup_scanned_map', packedAt: 'sup_packed_at' },
  meals:       { status: 'mea_status', packerId: 'mea_packer_id', packerName: 'mea_packer_name', active: 'mea_active_seconds', seg: 'mea_segment_started_at', scanned: 'mea_scanned_map', packedAt: 'mea_packed_at' },
};
const SECTION_LABEL = { supplements: 'Supplements', meals: 'Meals' };
const sectionOf = (groupKey) => (groupKey === 'supplements' ? 'supplements' : 'meals');

export default function FloorPack() {
  const queryClient = useQueryClient();
  const { triggerFeedback, FeedbackWrapper } = useScanFeedback();

  // Packer identity
  const [packer, setPacker] = useState(null); // Production Team member (dispatch station) { id, name } or null

  // Order & scanning
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [section, setSection] = useState(null); // 'supplements' | 'meals' | null (which section is being packed)
  const [scannedMap, setScannedMap] = useState({});
  const [scanInput, setScanInput] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [packing, setPacking] = useState(false);
  const [showBackConfirm, setShowBackConfirm] = useState(false);
  const [lastScanResult, setLastScanResult] = useState(null); // { type: 'success'|'error', message: string }

  // Timer: pause/resume
  const [packingStartedAt, setPackingStartedAt] = useState(null);
  const [isPaused, setIsPaused] = useState(false);
  const [accumulatedSeconds, setAccumulatedSeconds] = useState(0);
  const segmentStartRef = useRef(null);

  const bufferRef = useRef('');
  const timerRef = useRef(null);
  const saveDebounceRef = useRef(null);

  // ── Data queries ──
  const { data: orders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ['floor-pack-orders'],
    queryFn: async () => {
      const pending = await base44.entities.SalesOrder.filter(
        { lifecycle_state: 'paid_unfulfilled', status: 'pending' },
        '-order_date', 500,
      );
      const picking = await base44.entities.SalesOrder.filter(
        { lifecycle_state: 'paid_unfulfilled', status: 'picking' },
        '-order_date', 500,
      );
      const map = new Map();
      [...picking, ...pending].forEach(o => { if (!map.has(o.id)) map.set(o.id, o); });
      return Array.from(map.values()).sort((a, b) => {
        if (a.status === 'picking' && b.status !== 'picking') return -1;
        if (b.status === 'picking' && a.status !== 'picking') return 1;
        return new Date(b.order_date || 0) - new Date(a.order_date || 0);
      });
    },
  });

  const { data: orderLines = [], isLoading: loadingLines } = useQuery({
    queryKey: ['floor-pack-order-lines', selectedOrder?.id],
    queryFn: () => base44.entities.SalesOrderLine.filter(
      { sales_order_id: selectedOrder.id }, 'sku', 200,
    ),
    enabled: !!selectedOrder?.id,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['floor-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'sku', 2000),
    staleTime: 5 * 60 * 1000,
  });

  const { data: packBoms = [] } = useQuery({
    queryKey: ['floor-pack-boms'],
    queryFn: () => base44.entities.PackBom.filter({ active: true }, 'package_sku', 200),
    staleTime: 5 * 60 * 1000,
  });

  const skuNameMap = useMemo(() => {
    const map = {};
    products.forEach(p => { if (p.sku) map[p.sku.toLowerCase()] = p.name || p.sku; });
    return map;
  }, [products]);

  // Product type lookup: sku → type (supplement, sauce, finished_meal, etc.)
  const skuTypeMap = useMemo(() => {
    const map = {};
    products.forEach(p => { if (p.sku) map[p.sku.toLowerCase()] = { type: p.type, sellable: !!p.sellable }; });
    return map;
  }, [products]);

  const resolvedName = (sku, fallbackName) => {
    if (!sku) return fallbackName || 'Unknown';
    return skuNameMap[sku.toLowerCase()] || fallbackName || sku;
  };

  // ── Build grouped pack list ──
  const groups = useMemo(() => {
    const parentLines = orderLines.filter(ol => ol.is_package_parent);
    const componentLines = orderLines.filter(ol => ol.is_package_component && !ol.is_package_parent && ol.status !== 'cancelled');
    const standaloneLines = orderLines.filter(ol => !ol.is_package_parent && !ol.is_package_component && ol.status !== 'cancelled');
    const result = [];

    parentLines.forEach(parent => {
      const children = componentLines.filter(c => c.parent_line_id === parent.id);
      if (children.length === 0) return;
      result.push({
        groupKey: `pkg-${parent.id}`,
        label: friendlyPackageName(parent.sku, parent.name),
        subtitle: `${parent.sku} · ${children.reduce((s, c) => s + (c.qty || 0), 0)} meals`,
        colorTheme: resolvePackColor(parent.sku, packBoms),
        items: children.map(c => ({
          key: `sol-${c.id}`, sku: c.sku || '', skuLower: (c.sku || '').toLowerCase(),
          name: resolvedName(c.sku, c.name), qty: c.qty || 0, variantTitle: c.variant_title || '',
        })),
      });
    });

    const parentIds = new Set(parentLines.map(p => p.id));
    const orphans = componentLines.filter(c => !parentIds.has(c.parent_line_id));
    if (orphans.length > 0) {
      result.push({
        groupKey: 'orphan', label: 'Package Items', subtitle: null,
        items: orphans.map(c => ({
          key: `sol-${c.id}`, sku: c.sku || '', skuLower: (c.sku || '').toLowerCase(),
          name: resolvedName(c.sku, c.name), qty: c.qty || 0, variantTitle: c.variant_title || '',
        })),
      });
    }

    const byoLines = standaloneLines.filter(ol => ol.line_type === 'byo' || (ol.portion_weight_g && !ol.variant_title));
    const trueStandalone = standaloneLines.filter(ol => !byoLines.includes(ol));

    // Find BYO color from PackBoms
    const byoPackBom = packBoms.find(pb => pb.package_type === 'byo');

    if (byoLines.length > 0) {
      result.push({
        groupKey: 'byo', label: 'Build Your Own',
        subtitle: `${byoLines.reduce((s, ol) => s + (ol.qty || 0), 0)} meals · 300g portions`,
        colorTheme: byoPackBom?.pack_color_theme || 'blue',
        items: byoLines.map(ol => ({
          key: `sol-${ol.id}`, sku: ol.sku || '', skuLower: (ol.sku || '').toLowerCase(),
          name: resolvedName(ol.sku, ol.name), qty: ol.qty || 0, variantTitle: ol.variant_title || '',
        })),
      });
    }
    // Split standalone lines into Meals vs Supplements so each is its own section/group.
    const isSupplementLine = (ol) => {
      const info = skuTypeMap[(ol.sku || '').toLowerCase()];
      return info?.type === 'supplement' || (info?.type === 'sauce' && info?.sellable);
    };
    const mapStandalone = (ol) => ({
      key: `sol-${ol.id}`, sku: ol.sku || '', skuLower: (ol.sku || '').toLowerCase(),
      name: resolvedName(ol.sku, ol.name), qty: ol.qty || 0, variantTitle: ol.variant_title,
    });
    const standaloneSupps = trueStandalone.filter(isSupplementLine);
    const standaloneMeals = trueStandalone.filter(ol => !isSupplementLine(ol));
    if (standaloneMeals.length > 0) {
      result.push({ groupKey: 'standalone', label: 'Meals', subtitle: null, items: standaloneMeals.map(mapStandalone) });
    }
    if (standaloneSupps.length > 0) {
      result.push({ groupKey: 'supplements', label: 'Supplements', subtitle: null, items: standaloneSupps.map(mapStandalone) });
    }
    return result;
  }, [orderLines, skuNameMap, skuTypeMap, packBoms]);

  // Which sections this order actually contains, the groups for the active section, and
  // the active section's items (everything downstream — scan set, totals, finish gate —
  // is scoped to these so a section can be packed independently).
  const sectionsPresent = useMemo(() => {
    const set = new Set();
    groups.forEach(g => set.add(sectionOf(g.groupKey)));
    return ['supplements', 'meals'].filter(s => set.has(s));
  }, [groups]);
  const sectionGroups = useMemo(
    () => (section ? groups.filter(g => sectionOf(g.groupKey) === section) : groups),
    [groups, section],
  );
  const allPackItems = useMemo(() => sectionGroups.flatMap(g => g.items), [sectionGroups]);

  // Build barcode/SKU → product SKU lookup.
  // Handles leading-zero ambiguity: scanners may add or strip a leading '0'.
  // When multiple products share near-identical barcodes (e.g. 0759649607889 vs 759649607889),
  // we store ALL variants but track collisions so processCode can disambiguate using the order context.
  const allProductLookup = useMemo(() => {
    const map = {};
    const addBarcode = (bc, sku) => {
      const key = bc.toLowerCase();
      // If already mapped to a different SKU, store as array for disambiguation
      if (map[key] && map[key] !== sku) {
        map[key] = Array.isArray(map[key]) ? [...map[key], sku] : [map[key], sku];
      } else if (!map[key]) {
        map[key] = sku;
      }
    };
    products.forEach(p => {
      const sku = (p.sku || '').toLowerCase();
      if (p.barcode) {
        const bc = p.barcode.trim();
        addBarcode(bc, sku);
        // Also index the zero-stripped and zero-prefixed variants
        if (bc.startsWith('0')) addBarcode(bc.replace(/^0+/, ''), sku);
        else addBarcode('0' + bc, sku);
      }
      map[sku] = sku;
    });
    return map;
  }, [products]);

  // Build order SKU set + a reverse lookup that maps full product SKUs to their
  // decomposed line SKU. Needed because PackBom component_skus can be abbreviated
  // (e.g. "ChiBreButandSti") while the actual Product.sku is longer
  // (e.g. "ChiBreButandStialowitaSweandSouSau"). The barcode resolves to the
  // full product SKU, but the order line uses the PackBom abbreviated SKU.
  const { orderSkuSet, productSkuToLineSku } = useMemo(() => {
    const lineSkus = allPackItems.map(i => i.skuLower);
    const set = new Set(lineSkus);
    const mapping = {}; // fullProductSku → lineSkuUsedInOrder

    // For each product, check if its full SKU starts with any line SKU (or vice versa)
    products.forEach(p => {
      const fullSku = (p.sku || '').toLowerCase();
      if (!fullSku) return;
      // Direct match — already in set, no mapping needed
      if (set.has(fullSku)) return;
      // Check prefix: does the full product SKU start with any abbreviated line SKU?
      for (const lineSku of lineSkus) {
        if (fullSku.startsWith(lineSku) || lineSku.startsWith(fullSku)) {
          mapping[fullSku] = lineSku;
          break;
        }
      }
    });

    return { orderSkuSet: set, productSkuToLineSku: mapping };
  }, [allPackItems, products]);

  // ── Refs to avoid stale closures in HID keydown handler ──
  const allProductLookupRef = useRef(allProductLookup);
  const orderSkuSetRef = useRef(orderSkuSet);
  const productSkuToLineSkuRef = useRef(productSkuToLineSku);
  const allPackItemsRef = useRef(allPackItems);
  const skuNameMapRef = useRef(skuNameMap);
  const scannedMapRef = useRef(scannedMap);
  const packingStartedAtRef = useRef(packingStartedAt);
  const isPausedRef = useRef(isPaused);

  useEffect(() => { allProductLookupRef.current = allProductLookup; }, [allProductLookup]);
  useEffect(() => { orderSkuSetRef.current = orderSkuSet; }, [orderSkuSet]);
  useEffect(() => { productSkuToLineSkuRef.current = productSkuToLineSku; }, [productSkuToLineSku]);
  useEffect(() => { allPackItemsRef.current = allPackItems; }, [allPackItems]);
  useEffect(() => { skuNameMapRef.current = skuNameMap; }, [skuNameMap]);
  useEffect(() => { scannedMapRef.current = scannedMap; }, [scannedMap]);

  // ── Auto-save scan progress after each scan (debounced 2s) ──
  useEffect(() => {
    if (!selectedOrder?.id || !packingStartedAt || !section) return;
    // Don't save empty maps (initial load)
    const hasScans = Object.keys(scannedMap).length > 0;
    if (!hasScans) return;
    clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => {
      base44.entities.SalesOrder.update(selectedOrder.id, {
        [SECTION_COLS[section].scanned]: JSON.stringify(scannedMap),
      }).catch(() => {}); // silent — best-effort background save
    }, 2000);
    return () => clearTimeout(saveDebounceRef.current);
  }, [scannedMap, selectedOrder?.id, packingStartedAt, section]);
  useEffect(() => { packingStartedAtRef.current = packingStartedAt; }, [packingStartedAt]);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);

  // ── Scan processing ──
  const processCode = (code) => {
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;

    const started = packingStartedAtRef.current;
    const paused = isPausedRef.current;
    const lookup = allProductLookupRef.current;
    const skuSet = orderSkuSetRef.current;
    const items = allPackItemsRef.current;
    const nameMap = skuNameMapRef.current;
    const scanned = scannedMapRef.current;

    if (!started) {
      setLastScanResult({ type: 'error', message: 'Press "Start Packing" first' });
      triggerFeedback('error');
      return;
    }
    if (paused) {
      setLastScanResult({ type: 'error', message: 'Packing is paused — press Resume first' });
      triggerFeedback('error');
      return;
    }

    const rawLookup = lookup[trimmed];
    if (!rawLookup) {
      setLastScanResult({ type: 'error', message: `Unknown barcode: "${code.trim()}"` });
      triggerFeedback('error');
      return;
    }

    // Disambiguate barcode collisions: if multiple SKUs share the same barcode,
    // pick the one that's actually in this order (via direct or prefix match).
    const skuMapping = productSkuToLineSkuRef.current;
    const candidates = Array.isArray(rawLookup) ? rawLookup : [rawLookup];

    let matchedSku = null;
    for (const candidate of candidates) {
      if (skuSet.has(candidate)) { matchedSku = candidate; break; }
      if (skuMapping[candidate]) { matchedSku = skuMapping[candidate]; break; }
    }

    if (!matchedSku) {
      // Show all candidate names so the user knows what was detected
      const names = candidates.map(c => nameMap[c] || c).filter(Boolean);
      const displayName = names.join(' / ');
      setLastScanResult({ type: 'error', message: `Wrong item — "${displayName}" is not in this order` });
      triggerFeedback('error');
      return;
    }

    const item = items.find(i => i.skuLower === matchedSku);
    const currentCount = scanned[matchedSku] || 0;
    if (item && currentCount >= item.qty) {
      setLastScanResult({ type: 'error', message: `Already scanned all ${item.qty} of ${item.name}` });
      triggerFeedback('error');
      return;
    }

    setScannedMap(prev => ({ ...prev, [matchedSku]: (prev[matchedSku] || 0) + 1 }));
    setLastScanResult({ type: 'success', message: `✓ ${item?.name || matchedSku} (${currentCount + 1}/${item?.qty || '?'})` });
    triggerFeedback('success');
  };

  // HID barcode scanner — uses refs so handler never goes stale
  useEffect(() => {
    if (!selectedOrder) return;
    const handleKeyDown = (e) => {
      const active = document.activeElement;
      if (active && active.tagName === 'INPUT' && active.type !== 'hidden') return;
      if (e.key === 'Enter') {
        e.preventDefault(); // prevent form submission from Enter key
        if (bufferRef.current.length > 3) {
          processCode(bufferRef.current);
          setScanInput('');
        }
        bufferRef.current = '';
        return;
      }
      if (e.key.length === 1) {
        bufferRef.current += e.key;
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => { bufferRef.current = ''; }, 300);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedOrder]);

  const totalNeeded = allPackItems.reduce((s, i) => s + (i.qty || 0), 0);
  const totalScanned = Object.values(scannedMap).reduce((s, v) => s + v, 0);
  const allDone = totalScanned >= totalNeeded && totalNeeded > 0;

  const handleScanSubmit = (e) => {
    e.preventDefault();
    processCode(scanInput);
    setScanInput('');
  };

  // ── Timer helpers ──
  const getCurrentSegmentSeconds = () => {
    if (!segmentStartRef.current) return 0;
    return Math.floor((Date.now() - segmentStartRef.current) / 1000);
  };

  // Append a packing lifecycle event for KPIs. Non-blocking — never interrupts packing.
  const logPackingEvent = (event_type, extra = {}) => {
    if (!selectedOrder) return;
    base44.entities.PackingEventLog.create({
      sales_order_id: selectedOrder.id,
      order_number: selectedOrder.order_number || selectedOrder.shopify_order_id || '',
      event_type,
      member_id: packer?.id || '',
      member_name: packer?.name || '',
      timestamp: new Date().toISOString(),
      ...extra,
    }).catch(() => {});
  };

  // Auto-select the section: if only one section is left to pack, go straight in; if both
  // are still open, the Section chooser (in render) lets the packer pick.
  useEffect(() => {
    if (!selectedOrder || section || loadingLines) return;
    const open = sectionsPresent.filter(s => selectedOrder[SECTION_COLS[s].status] !== 'done');
    if (open.length === 1) setSection(open[0]);
    else if (open.length === 0 && sectionsPresent.length > 0) setSection(sectionsPresent[0]);
    // open.length > 1 → render the chooser (section stays null)
  }, [selectedOrder?.id, section, loadingLines, sectionsPresent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-start / restore the active section's timer + scan progress on entry — entering the
  // section starts the clock (no manual "Start Packing").
  useEffect(() => {
    if (!selectedOrder || !section) return;
    const cols = SECTION_COLS[section];
    setAccumulatedSeconds(selectedOrder[cols.active] || 0);
    setPackingStartedAt(selectedOrder[cols.seg] || selectedOrder.picking_started_at || new Date().toISOString());
    let restored = {};
    if (selectedOrder[cols.scanned]) { try { const s = JSON.parse(selectedOrder[cols.scanned]); if (s && typeof s === 'object') restored = s; } catch { /* ignore */ } }
    setScannedMap(restored);
    setIsPaused(false);
    const segAt = selectedOrder[cols.seg];
    if (segAt) {
      segmentStartRef.current = new Date(segAt).getTime();
    } else {
      segmentStartRef.current = Date.now();
      const now = new Date().toISOString();
      base44.entities.SalesOrder.update(selectedOrder.id, {
        status: selectedOrder.status === 'pending' ? 'picking' : selectedOrder.status,
        picking_started_at: selectedOrder.picking_started_at || now,
        [cols.status]: 'in_progress',
        [cols.packerId]: packer?.id || '',
        [cols.packerName]: packer?.name || '',
        [cols.seg]: now,
      }).catch(() => {});
      logPackingEvent('started', { section });
    }
  }, [selectedOrder?.id, section]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePause = async () => {
    if (!section) return;
    const cols = SECTION_COLS[section];
    const newTotal = accumulatedSeconds + getCurrentSegmentSeconds();
    setAccumulatedSeconds(newTotal);
    segmentStartRef.current = null;
    setIsPaused(true);
    await base44.entities.SalesOrder.update(selectedOrder.id, {
      [cols.active]: newTotal,
      [cols.seg]: null,
      [cols.scanned]: JSON.stringify(scannedMap),
    });
    logPackingEvent('paused', { section });
    toast('Packing paused');
  };

  const handleResume = async () => {
    if (!section) return;
    const cols = SECTION_COLS[section];
    const now = new Date().toISOString();
    segmentStartRef.current = Date.now();
    setIsPaused(false);
    await base44.entities.SalesOrder.update(selectedOrder.id, { [cols.seg]: now });
    logPackingEvent('resumed', { section });
    toast.success('Resumed packing — scan items!');
  };

  const handleFinishPacking = async () => {
    if (!section) return;
    const cols = SECTION_COLS[section];
    const incomplete = allPackItems.find(i => (scannedMap[i.skuLower] || 0) < i.qty);
    if (incomplete) {
      toast.error(`Still need to scan ${incomplete.name} (${scannedMap[incomplete.skuLower] || 0}/${incomplete.qty})`);
      return;
    }
    setPacking(true);
    try {
      const now = new Date().toISOString();
      const totalSec = accumulatedSeconds + getCurrentSegmentSeconds();
      // This section's snapshot (KPI attribution is per section, from the 'completed' event).
      const snap = computePackedSnapshot(sectionGroups, skuTypeMap);
      await base44.entities.SalesOrder.update(selectedOrder.id, {
        [cols.status]: 'done',
        [cols.active]: totalSec,
        [cols.seg]: null,
        [cols.packedAt]: now,
        [cols.packerId]: packer?.id || '',
        [cols.packerName]: packer?.name || '',
        [cols.scanned]: JSON.stringify(scannedMap),
      });
      logPackingEvent('completed', { section, ...snap, active_seconds: totalSec });

      // Re-fetch the latest order so a concurrent section completion isn't missed, then roll
      // the whole order up to 'packed' only once every present section is done.
      const fresh = (await base44.entities.SalesOrder.filter({ id: selectedOrder.id }))[0] || selectedOrder;
      const allDoneNow = sectionsPresent.every(s => (s === section ? true : fresh[SECTION_COLS[s].status] === 'done'));
      if (allDoneNow) {
        const rollupSnap = computePackedSnapshot(groups, skuTypeMap);
        const otherActive = sectionsPresent
          .filter(s => s !== section)
          .reduce((sum, s) => sum + (Number(fresh[SECTION_COLS[s].active]) || 0), 0);
        await base44.entities.SalesOrder.update(selectedOrder.id, {
          status: 'packed',
          packed_at: now,
          packing_active_seconds: totalSec + otherActive,
          packing_duration_seconds: totalSec + otherActive,
          packed_by_name: packer?.name || fresh.packed_by_name || '',
          packed_by_member_id: packer?.id || fresh.packed_by_member_id || '',
          packing_scanned_map: '',
          ...rollupSnap,
        });
        toast.success(`Order ${selectedOrder.order_number || selectedOrder.shopify_order_id} fully packed!`);
      } else {
        const remaining = sectionsPresent.filter(s => s !== section).map(s => SECTION_LABEL[s]).join(', ');
        toast.success(`${SECTION_LABEL[section]} packed — ${remaining} still to pack`);
      }
      queryClient.invalidateQueries({ queryKey: ['floor-pack-orders'] });
    } catch (err) {
      toast.error('Failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setPacking(false);
      setSelectedOrder(null);
      setSection(null);
      setScannedMap({});
      setPackingStartedAt(null);
      setIsPaused(false);
      setAccumulatedSeconds(0);
      segmentStartRef.current = null;
    }
  };

  // Back button — if timer is running (not paused, not finished), prompt first
  const handleBackPress = () => {
    if (packingStartedAt && !isPaused) {
      setShowBackConfirm(true);
      return;
    }
    // Already paused or never started — just exit
    doExit();
  };

  const doExit = async () => {
    setShowBackConfirm(false);
    if (section && packingStartedAt && selectedOrder) {
      const cols = SECTION_COLS[section];
      const totalSoFar = accumulatedSeconds + getCurrentSegmentSeconds();
      segmentStartRef.current = null;
      setIsPaused(true);
      await base44.entities.SalesOrder.update(selectedOrder.id, {
        [cols.status]: 'in_progress',
        [cols.active]: totalSoFar,
        [cols.seg]: null,
        [cols.scanned]: JSON.stringify(scannedMap),
      });
      logPackingEvent('paused', { section });
      queryClient.invalidateQueries({ queryKey: ['floor-pack-orders'] });
    }
    setSelectedOrder(null);
    setSection(null);
    setScannedMap({});
    setPackingStartedAt(null);
    setIsPaused(false);
    setAccumulatedSeconds(0);
    segmentStartRef.current = null;
  };

  // ── Step 0: Packer selection ──
  if (!packer) {
    return (
      <FeedbackWrapper>
        <PackerSelectModal onSelect={setPacker} />
      </FeedbackWrapper>
    );
  }

  // ── Step 1: Order picker ──
  if (!selectedOrder) {
    return (
      <FeedbackWrapper>
        <FloorOrderPicker orders={orders} loading={loadingOrders} onSelect={setSelectedOrder} />
      </FeedbackWrapper>
    );
  }

  // ── Step 1.5: Section chooser (only when the order has BOTH sections still open) ──
  if (selectedOrder && !section) {
    if (loadingLines) {
      return <FeedbackWrapper><div className="py-16 text-center text-sm text-muted-foreground">Loading order…</div></FeedbackWrapper>;
    }
    const openSections = sectionsPresent.filter(s => selectedOrder[SECTION_COLS[s].status] !== 'done');
    if (openSections.length > 1) {
      return (
        <FeedbackWrapper>
          <div className="space-y-5 max-w-md mx-auto">
            <div className="flex items-center gap-3">
              <button onClick={() => setSelectedOrder(null)} className="p-2 -ml-2 rounded-xl hover:bg-muted"><ArrowLeft className="w-5 h-5" /></button>
              <div>
                <h1 className="text-xl font-bold">{selectedOrder.order_number || selectedOrder.shopify_order_id}</h1>
                <p className="text-xs text-muted-foreground">{selectedOrder.customer_name} — what are you packing?</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3">
              {openSections.map(s => (
                <button key={s} onClick={() => setSection(s)} className="bg-card border-2 border-border rounded-2xl p-6 flex items-center justify-between active:scale-[0.98] hover:border-primary/50 transition-transform">
                  <span className="text-lg font-bold">{SECTION_LABEL[s]}</span>
                  <PackageCheck className="w-6 h-6 text-primary" />
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-center">Each part is packed separately — supplements and meals are tracked on their own.</p>
          </div>
        </FeedbackWrapper>
      );
    }
    // single open section → the auto-select effect sets it; brief loader meanwhile
    return <FeedbackWrapper><div className="py-16 text-center text-sm text-muted-foreground">Opening…</div></FeedbackWrapper>;
  }

  // ── Step 2: Packing ──
  return (
    <FeedbackWrapper>
      <div className="space-y-4 pb-24">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={handleBackPress} className="p-2 -ml-2 rounded-xl hover:bg-muted">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold">Pack {SECTION_LABEL[section]} — {selectedOrder.order_number || selectedOrder.shopify_order_id}</h1>
            <p className="text-xs text-muted-foreground">{selectedOrder.customer_name} · Packer: <strong>{packer.name}</strong></p>
          </div>
          <Badge className="bg-blue-100 text-blue-700 tabular-nums">{totalScanned}/{totalNeeded}</Badge>
        </div>

        {/* Timer with pause/resume */}
        <FloorPackTimer
          startedAt={packingStartedAt}
          onStart={() => {}}
          onPause={handlePause}
          onResume={handleResume}
          isPaused={isPaused}
          accumulatedSeconds={accumulatedSeconds}
          disabled={allPackItems.length === 0}
        />

        {/* Progress bar + Scanner — only when packing is active */}
        {packingStartedAt && (
          <>
            <div className="w-full bg-muted rounded-full h-3">
              <div
                className="bg-green-500 h-3 rounded-full transition-all duration-300"
                style={{ width: `${totalNeeded ? (totalScanned / totalNeeded) * 100 : 0}%` }}
              />
            </div>

            {/* Scanner — disabled when paused */}
            <form onSubmit={handleScanSubmit} className="flex gap-2">
              <div className="relative flex-1">
                <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  value={scanInput}
                  onChange={e => setScanInput(e.target.value)}
                  placeholder={isPaused ? 'Paused — resume to scan' : 'Scan meal barcode...'}
                  className="h-14 text-lg font-mono pl-11"
                  disabled={isPaused}
                  autoFocus={!isPaused}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-14 w-14 shrink-0"
                onClick={() => !isPaused && setShowCamera(true)}
                disabled={isPaused}
              >
                <ScanBarcode className="w-6 h-6" />
              </Button>
            </form>

            {/* Last scan result banner */}
            <ScanResultBanner result={lastScanResult} onDismiss={() => setLastScanResult(null)} />

            {showCamera && !isPaused && (
              <CameraScanner
                active={showCamera}
                onScan={(code) => {
                  const trimmed = code.trim();
                  if (!trimmed) return;
                  setShowCamera(false);
                  setScanInput('');
                  setTimeout(() => processCode(trimmed), 50);
                }}
                onClose={() => setShowCamera(false)}
              />
            )}
          </>
        )}

        {/* Grouped pack items */}
        {loadingLines ? (
          <div className="flex items-center justify-center py-16 gap-3">
            <div className="w-5 h-5 border-2 border-border border-t-primary rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">Loading order items…</span>
          </div>
        ) : (
          <>
            <FloorPackList groups={sectionGroups} scannedMap={scannedMap} />
            {allPackItems.length === 0 && (
              <div className="text-center py-12 text-sm text-muted-foreground">
                No items found for this order.
              </div>
            )}
          </>
        )}

        {/* Finish bar */}
        {packingStartedAt && allPackItems.length > 0 && (
          <div className="fixed bottom-[68px] left-0 right-0 px-4 pb-4 pt-2 bg-gradient-to-t from-background via-background to-transparent z-30">
            <Button
              onClick={handleFinishPacking}
              disabled={packing || !allDone || isPaused}
              className="w-full h-14 text-base gap-2 bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
            >
              <PackageCheck className="w-5 h-5" />
              {packing ? 'Saving...' : allDone ? 'Finish Packing' : `Scan all items (${totalScanned}/${totalNeeded})`}
            </Button>
          </div>
        )}
        {/* Back confirmation dialog */}
        {showBackConfirm && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6">
            <div className="bg-card rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
              <h2 className="text-lg font-bold">Save progress?</h2>
              <p className="text-sm text-muted-foreground">
                The timer is still running. Going back will pause the timer and save your progress so you can resume later.
              </p>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 h-12"
                  onClick={() => setShowBackConfirm(false)}
                >
                  Stay
                </Button>
                <Button
                  className="flex-1 h-12 bg-primary"
                  onClick={doExit}
                >
                  Save & Exit
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </FeedbackWrapper>
  );
}