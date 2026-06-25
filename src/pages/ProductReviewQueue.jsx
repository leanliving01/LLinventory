import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ClipboardList } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import UnmatchedLineCard from '@/components/review-queue/UnmatchedLineCard';
import CreateProductFromLineModal from '@/components/review-queue/CreateProductFromLineModal';
import MatchToExistingModal from '@/components/review-queue/MatchToExistingModal';
import PurchasingUnitsReviewTab from '@/components/review-queue/PurchasingUnitsReviewTab';
import { findPossibleMatches, findExistingLink } from '@/lib/reviewQueueMatching';
import PageHelp from '@/components/help/PageHelp';
import POFilters from '@/components/purchasing/POFilters';
import POPagination from '@/components/purchasing/POPagination';

const HELP_ITEMS = [
  { title: 'What is this queue?', text: 'Lines from synced Xero invoices and scanned supplier PDFs that cannot be automatically matched to a Supplier Product appear here for manual review.' },
  { title: 'Possible matches', text: 'The system checks the supplier SKU / item code, plus the product name and description, against existing products. Likely duplicates are flagged so you can confirm instead of creating a new product.' },
  { title: 'Match to existing product', text: 'Click "Match Existing": pick a suggested match (or search the catalogue), confirm the supplier SKU and Purchase UoM, and capture the purchasing unit (label, conversion, cost). The item code is saved against the supplier product for future auto-matching.' },
  { title: 'Repeated SKUs are grouped', text: 'When the same supplier SKU appears on several invoices it is collapsed into one card. Matching, creating, non-stock, or ignoring resolves every invoice line at once.' },
  { title: 'Create a new product', text: 'Click "Create Product" to create a brand new Product and Supplier Product link in one step, including the Purchase UoM. Details are pre-filled from the line.' },
  { title: 'Ignore', text: 'If a line has already been added/linked elsewhere or isn\'t needed, click "Ignore" so it stops reappearing in the queue.' },
  { title: 'Mark as non-stock', text: 'Click "Non-stock" for items like delivery charges or admin fees that don\'t need product tracking.' },
];

export default function ProductReviewQueue() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);

  const [tab, setTab] = useState('lines');                // 'lines' | 'units'
  const [createGroup, setCreateGroup] = useState(null);   // lineGroup → Create Product modal
  const [matchGroup, setMatchGroup] = useState(null);     // lineGroup → Match Existing modal
  const [productionOnly, setProductionOnly] = useState(true); // only show production-supplier lines
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [filters, setFilters] = useState({
    search: '',
    supplierId: 'all',
    dateFrom: null,
    dateTo: null,
    sortBy: 'date_desc',
  });

  // Fetch all unmatched invoice lines
  const { data: unmatchedLines = [], isLoading: loadingLines } = useQuery({
    queryKey: ['unmatched-invoice-lines'],
    queryFn: () => base44.entities.PurchaseInvoiceLine.filter({ match_status: 'unmatched' }, '-created_date', 5000),
  });

  // Fetch invoices for context (supplier name etc)
  const { data: invoices = [] } = useQuery({
    queryKey: ['purchase-invoices-for-queue'],
    queryFn: () => base44.entities.PurchaseInvoice.list('-created_date', 5000),
  });

  // Pending purchasing-unit proposals (just for the tab badge count).
  const { data: unitProposals = [] } = useQuery({
    queryKey: ['purchase-unit-proposals'],
    queryFn: () => base44.entities.PurchaseUnitProposal.filter({ status: 'pending' }, '-confidence', 300),
  });

  // Full product catalogue — "Match to existing" searches this, then links it to the supplier.
  const { data: products = [] } = useQuery({
    queryKey: ['products-for-queue'],
    queryFn: () => base44.entities.Product.list('name', 5000),
  });

  // Suppliers + which are production suppliers — the queue only surfaces lines
  // from production suppliers (the rest are hidden, not deleted).
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-production-flag'],
    queryFn: () => base44.entities.Supplier.list('name', 1000),
  });
  const productionSupplierIds = useMemo(
    () => new Set(suppliers.filter(s => s.is_production_supplier).map(s => s.id)),
    [suppliers],
  );

  // Build invoice lookup
  const invoiceMap = useMemo(() => {
    const map = {};
    invoices.forEach(inv => { map[inv.id] = inv; });
    return map;
  }, [invoices]);

  // Get unique supplier IDs from unmatched lines
  const supplierIds = useMemo(() => {
    const ids = new Set();
    unmatchedLines.forEach(l => {
      const inv = invoiceMap[l.invoice_id];
      if (inv?.supplier_id) ids.add(inv.supplier_id);
    });
    return Array.from(ids);
  }, [unmatchedLines, invoiceMap]);

  // Fetch supplier products for all relevant suppliers
  const { data: allSPs = [] } = useQuery({
    queryKey: ['sps-for-queue', supplierIds.join(',')],
    queryFn: () => base44.entities.SupplierProduct.filter({ active: true }, 'product_name', 2000),
    enabled: supplierIds.length > 0,
  });

  // Group SPs by supplier
  const spBySupplier = useMemo(() => {
    const map = {};
    allSPs.forEach(sp => {
      if (!map[sp.supplier_id]) map[sp.supplier_id] = [];
      map[sp.supplier_id].push(sp);
    });
    return map;
  }, [allSPs]);

  // Lines that are ALREADY linked to a product for their supplier (exact supplier
  // SKU or description match). These are auto-resolved and never shown — the queue
  // only surfaces genuinely new / unlinked supplier items.
  const autoLinkable = useMemo(() => {
    const out = [];
    for (const l of unmatchedLines) {
      const inv = invoiceMap[l.invoice_id];
      if (!inv?.supplier_id) continue;
      const sp = findExistingLink(l, spBySupplier[inv.supplier_id] || []);
      if (sp) out.push({ line: l, sp });
    }
    return out;
  }, [unmatchedLines, invoiceMap, spBySupplier]);
  const autoLinkedIds = useMemo(() => new Set(autoLinkable.map(x => x.line.id)), [autoLinkable]);

  // Write the auto-resolved links to the DB so they drop out of the queue
  // permanently (and the invoice line is correctly costed). Idempotent: each line
  // is processed at most once per page session.
  const resolvedRef = useRef(new Set());
  useEffect(() => {
    const todo = autoLinkable.filter(x => !resolvedRef.current.has(x.line.id));
    if (todo.length === 0) return;
    let cancelled = false;
    (async () => {
      const invoiceIds = new Set();
      let n = 0;
      for (const { line, sp } of todo) {
        resolvedRef.current.add(line.id);
        try {
          await base44.entities.PurchaseInvoiceLine.update(line.id, {
            supplier_product_id: sp.id,
            product_id: sp.product_id,
            product_name: sp.product_name,
            product_sku: sp.product_sku,
            match_status: 'auto_matched',
          });
          invoiceIds.add(line.invoice_id);
          n++;
        } catch { /* leave for manual review */ }
      }
      if (cancelled) return;
      for (const id of invoiceIds) await recountInvoice(id);
      if (n > 0) {
        queryClient.invalidateQueries({ queryKey: ['unmatched-invoice-lines'] });
        toast.success(`Auto-linked ${n} already-known item${n > 1 ? 's' : ''} to existing products`);
      }
    })();
    return () => { cancelled = true; };
  }, [autoLinkable]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter
  const filtered = useMemo(() => {
    const result = unmatchedLines.filter(l => {
      // Hide lines already linked to a product (auto-resolved above).
      if (autoLinkedIds.has(l.id)) return false;
      const inv = invoiceMap[l.invoice_id];
      // Production-supplier scope: hide lines from non-production suppliers.
      if (productionOnly && !(inv?.supplier_id && productionSupplierIds.has(inv.supplier_id))) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!((l.xero_description || '').toLowerCase().includes(q) ||
              (l.xero_item_code || '').toLowerCase().includes(q) ||
              (inv?.supplier_name || '').toLowerCase().includes(q))) return false;
      }
      if (filters.supplierId !== 'all' && inv?.supplier_id !== filters.supplierId) return false;
      const dateField = l.created_date;
      if (filters.dateFrom && dateField) {
        if (new Date(dateField) < filters.dateFrom) return false;
      }
      if (filters.dateTo && dateField) {
        const toEnd = new Date(filters.dateTo);
        toEnd.setHours(23, 59, 59, 999);
        if (new Date(dateField) > toEnd) return false;
      }
      return true;
    });

    const sorted = [...result];
    const [field, dir] = filters.sortBy.split('_');
    const mult = dir === 'asc' ? 1 : -1;
    sorted.sort((a, b) => {
      if (field === 'date') {
        return mult * ((a.created_date || '').localeCompare(b.created_date || ''));
      }
      if (field === 'supplier') {
        const aS = invoiceMap[a.invoice_id]?.supplier_name || '';
        const bS = invoiceMap[b.invoice_id]?.supplier_name || '';
        return mult * aS.localeCompare(bS);
      }
      return 0;
    });
    return sorted;
  }, [unmatchedLines, filters, invoiceMap, productionOnly, productionSupplierIds, autoLinkedIds]);

  // Lines that still need manual action (excludes auto-linked already-known items).
  const toLinkCount = useMemo(
    () => unmatchedLines.filter(l => !autoLinkedIds.has(l.id)).length,
    [unmatchedLines, autoLinkedIds],
  );

  // How many unmatched lines belong to non-production suppliers (hidden by the scope).
  const hiddenNonProductionCount = useMemo(() => (
    unmatchedLines.filter(l => {
      const inv = invoiceMap[l.invoice_id];
      return !(inv?.supplier_id && productionSupplierIds.has(inv.supplier_id));
    }).length
  ), [unmatchedLines, invoiceMap, productionSupplierIds]);

  // Supplier dropdown options
  const supplierOptions = useMemo(() => {
    const map = {};
    unmatchedLines.forEach(l => {
      const inv = invoiceMap[l.invoice_id];
      if (inv?.supplier_id && inv?.supplier_name) map[inv.supplier_id] = inv.supplier_name;
    });
    return Object.entries(map)
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [unmatchedLines, invoiceMap]);

  // Collapse filtered lines into supplier + SKU groups, so a SKU that appears on
  // several invoices shows as one card. Lines with no SKU stay as their own card.
  const lineGroups = useMemo(() => {
    const order = [];
    const byKey = new Map();
    filtered.forEach(l => {
      const inv = invoiceMap[l.invoice_id];
      const sku = (l.xero_item_code || '').trim().toLowerCase();
      const key = (sku && inv?.supplier_id) ? `${inv.supplier_id}|${sku}` : `line-${l.id}`;
      let g = byKey.get(key);
      if (!g) {
        g = { key, supplier_id: inv?.supplier_id, representativeLine: l, representativeInvoice: inv, lines: [] };
        byKey.set(key, g);
        order.push(g);
      }
      g.lines.push({ line: l, invoice: inv });
    });
    return order;
  }, [filtered, invoiceMap]);

  const totalPages = Math.max(1, Math.ceil(lineGroups.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = lineGroups.slice((safePage - 1) * pageSize, safePage * pageSize);

  const handleFiltersChange = (newFilters) => {
    setFilters(newFilters);
    setPage(1);
  };

  // Group paginated cards by supplier for display
  const grouped = useMemo(() => {
    const groups = {};
    paginated.forEach(g => {
      const supplierName = g.representativeInvoice?.supplier_name || 'Unknown Supplier';
      if (!groups[supplierName]) groups[supplierName] = { supplier_id: g.supplier_id, items: [] };
      groups[supplierName].items.push(g);
    });
    return Object.entries(groups).sort((a, b) => b[1].items.length - a[1].items.length);
  }, [paginated]);

  // Possible-duplicate matches for each visible card (supplier SKU / item code /
  // description across products + supplier products), keyed by group.key.
  const matchesByGroup = useMemo(() => {
    const map = {};
    paginated.forEach(g => {
      map[g.key] = findPossibleMatches(g, {
        products,
        supplierProducts: spBySupplier[g.supplier_id] || [],
        limit: 4,
      });
    });
    return map;
  }, [paginated, products, spBySupplier]);

  // Resolve every line in a group to a matched supplier product, then recount
  // each affected invoice. Used by both Match Existing and Create Product.
  const resolveGroupLines = async (lineGroup, sp, product) => {
    const invoiceIds = new Set();
    for (const { line } of lineGroup.lines) {
      await base44.entities.PurchaseInvoiceLine.update(line.id, {
        supplier_product_id: sp.id,
        product_id: product.id,
        product_name: product.name,
        product_sku: product.sku,
        match_status: 'manually_matched',
      });
      invoiceIds.add(line.invoice_id);
    }
    for (const id of invoiceIds) await recountInvoice(id);
  };

  // Match a whole supplier+SKU group to an existing CATALOGUE product, capturing a
  // full purchasing unit (label / conversion / yield / nominal cost → price/stock).
  const handleMatch = async (lineGroup, { product, form }) => {
    const inv = lineGroup.representativeInvoice;
    if (!inv?.supplier_id) { toast.error('Invoice has no supplier'); return; }
    try {
      const cf = parseFloat(form.conversion_factor) || 1;
      const yf = parseFloat(form.yield_factor) || 1;
      const nc = parseFloat(form.nominal_cost) || 0;

      // Upsert the supplier_products link (UNIQUE on product_id + supplier_id).
      const existing = await base44.entities.SupplierProduct.filter({ supplier_id: inv.supplier_id, product_id: product.id });

      if (form.is_default) {
        const siblings = await base44.entities.SupplierProduct.filter({ product_id: product.id });
        for (const s of siblings.filter(s => s.is_default_supplier && s.id !== existing[0]?.id)) {
          await base44.entities.SupplierProduct.update(s.id, { is_default_supplier: false });
        }
      }

      const spPayload = {
        supplier_id: inv.supplier_id,
        supplier_name: inv.supplier_name || '',
        product_id: product.id,
        product_name: product.name || '',
        product_sku: product.sku || '',
        supplier_sku: (form.supplier_sku || '').trim(),
        supplier_description: (form.supplier_description || '').trim(),
        xero_item_code: lineGroup.representativeLine.xero_item_code || null,
        purchase_uom: form.purchase_uom || 'each',
        purchase_uom_label: (form.purchase_uom_label || '').trim(),
        purchase_uom_name: (form.purchase_uom_label || '').trim(),
        conversion_factor: cf,
        yield_factor: yf,
        effective_internal_qty: Math.round(cf * yf * 1000) / 1000,
        nominal_cost: nc,
        price_per_stock_unit: cf > 0 && yf > 0 ? nc / (cf * yf) : 0,
        last_purchase_price: nc,
        is_default_supplier: !!form.is_default,
        active: true,
      };
      let sp = existing[0];
      if (sp) {
        await base44.entities.SupplierProduct.update(sp.id, spPayload);
      } else {
        sp = await base44.entities.SupplierProduct.create(spPayload);
      }

      await resolveGroupLines(lineGroup, sp, product);
      queryClient.invalidateQueries({ queryKey: ['unmatched-invoice-lines'] });
      queryClient.invalidateQueries({ queryKey: ['sps-for-queue'] });
      const n = lineGroup.lines.length;
      toast.success(`Matched to ${product.name} & linked to ${inv.supplier_name}${n > 1 ? ` (${n} lines)` : ''}`);
      setMatchGroup(null);
    } catch (err) {
      toast.error(err.message || 'Match failed');
    }
  };

  const handleMarkNonStock = async (lineGroup) => {
    const invoiceIds = new Set();
    for (const { line } of lineGroup.lines) {
      await base44.entities.PurchaseInvoiceLine.update(line.id, { match_status: 'non_stock_item' });
      invoiceIds.add(line.invoice_id);
    }
    for (const id of invoiceIds) await recountInvoice(id);
    queryClient.invalidateQueries({ queryKey: ['unmatched-invoice-lines'] });
    const n = lineGroup.lines.length;
    toast.success(`Marked as non-stock item${n > 1 ? ` (${n} lines)` : ''}`);
  };

  // Ignore a whole group: it has been reviewed (already added / linked / not
  // needed) and should stop reappearing in the queue for this supplier/import.
  const handleIgnore = async (lineGroup) => {
    const invoiceIds = new Set();
    for (const { line } of lineGroup.lines) {
      await base44.entities.PurchaseInvoiceLine.update(line.id, { match_status: 'ignored' });
      invoiceIds.add(line.invoice_id);
    }
    for (const id of invoiceIds) await recountInvoice(id);
    queryClient.invalidateQueries({ queryKey: ['unmatched-invoice-lines'] });
    const n = lineGroup.lines.length;
    toast.success(`Ignored${n > 1 ? ` (${n} lines)` : ''} — won't reappear in the queue`);
  };

  const handleProductCreated = async (line, sp) => {
    const product = { id: sp.product_id, name: sp.product_name, sku: sp.product_sku };
    if (createGroup) await resolveGroupLines(createGroup, sp, product);
    queryClient.invalidateQueries({ queryKey: ['unmatched-invoice-lines'] });
    queryClient.invalidateQueries({ queryKey: ['sps-for-queue'] });
    setCreateGroup(null);
  };

  const recountInvoice = async (invoiceId) => {
    const updatedLines = await base44.entities.PurchaseInvoiceLine.filter({ invoice_id: invoiceId }, 'id', 200);
    const unmatchedCount = updatedLines.filter(l => l.match_status === 'unmatched').length;
    await base44.entities.PurchaseInvoice.update(invoiceId, {
      unmatched_line_count: unmatchedCount,
      status: unmatchedCount === 0 ? 'matched' : 'pending_match',
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-primary" /> Product Review Queue
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Link new supplier items (Xero + scanned PDFs) to products. Already-linked items are auto-matched and hidden.
          </p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-right">
          <p className="text-[10px] text-amber-600 uppercase font-semibold">Items to Link</p>
          <p className="text-lg font-bold text-amber-700">{toLinkCount}</p>
        </div>
      </div>

      <PageHelp items={HELP_ITEMS} />

      {/* Tabs: unmatched invoice lines vs. flagged purchasing units */}
      <div className="flex items-center gap-1 border-b border-border">
        {[
          { key: 'lines', label: 'Items to Link', count: toLinkCount },
          { key: 'units', label: 'Product Auditing', count: unitProposals.length },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 ${
              tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${tab === t.key ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'units' && <PurchasingUnitsReviewTab />}

      {tab === 'lines' && (
      <>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={productionOnly}
            onChange={e => { setProductionOnly(e.target.checked); setPage(1); }}
            className="rounded"
          />
          <span className="font-medium">Production suppliers only</span>
        </label>
        {productionOnly && hiddenNonProductionCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {hiddenNonProductionCount} line{hiddenNonProductionCount !== 1 ? 's' : ''} from non-production suppliers hidden
          </span>
        )}
      </div>

      <POFilters filters={filters} onChange={handleFiltersChange} suppliers={supplierOptions} />

      {/* Grouped list */}
      {loadingLines ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
            <ClipboardList className="w-8 h-8 text-green-500" />
          </div>
          <p className="text-sm font-medium text-foreground">All clear!</p>
          <p className="text-xs text-muted-foreground mt-1">
            {toLinkCount === 0 ? 'Every supplier item is linked to a product.' : 'No results match your filter.'}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-6">
            {grouped.map(([supplierName, group]) => (
              <div key={supplierName}>
                <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                  {supplierName}
                  <span className="text-xs font-normal bg-muted px-2 py-0.5 rounded-full">{group.items.length}</span>
                </h3>
                <div className="space-y-2">
                  {group.items.map(lineGroup => (
                    <UnmatchedLineCard
                      key={lineGroup.key}
                      lineGroup={lineGroup}
                      possibleMatches={matchesByGroup[lineGroup.key] || []}
                      onOpenMatch={setMatchGroup}
                      onCreateProduct={setCreateGroup}
                      onMarkNonStock={handleMarkNonStock}
                      onIgnore={handleIgnore}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <POPagination
            page={safePage}
            totalPages={totalPages}
            totalItems={filtered.length}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={v => { setPageSize(v); setPage(1); }}
          />
        </>
      )}
      </>
      )}

      {createGroup && (
        <CreateProductFromLineModal
          line={createGroup.representativeLine}
          invoice={createGroup.representativeInvoice}
          onCreated={handleProductCreated}
          onCancel={() => setCreateGroup(null)}
        />
      )}

      {matchGroup && (
        <MatchToExistingModal
          lineGroup={matchGroup}
          invoice={matchGroup.representativeInvoice}
          products={products}
          possibleMatches={matchesByGroup[matchGroup.key] || []}
          onMatch={handleMatch}
          onCancel={() => setMatchGroup(null)}
        />
      )}
    </div>
  );
}