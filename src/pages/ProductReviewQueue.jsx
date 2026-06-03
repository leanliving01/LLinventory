import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ClipboardList } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import UnmatchedLineCard from '@/components/review-queue/UnmatchedLineCard';
import CreateProductFromLineModal from '@/components/review-queue/CreateProductFromLineModal';
import PageHelp from '@/components/help/PageHelp';
import POFilters from '@/components/purchasing/POFilters';
import POPagination from '@/components/purchasing/POPagination';

const HELP_ITEMS = [
  { title: 'What is this queue?', text: 'When invoices are synced from Xero, lines that cannot be automatically matched to a Supplier Product appear here for manual review.' },
  { title: 'Match to existing product', text: 'Click "Match Existing" to search and link the line to an existing Supplier Product. The Xero item code will be saved for future auto-matching.' },
  { title: 'Create a new product', text: 'Click "Create Product" to create a brand new Product and Supplier Product link in one step. The system pre-fills details from the Xero line.' },
  { title: 'Mark as non-stock', text: 'Click "Non-stock" for items like delivery charges or admin fees that don\'t need product tracking.' },
];

export default function ProductReviewQueue() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);

  const [createLineData, setCreateLineData] = useState(null); // { line, invoice }
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

  // Full product catalogue — "Match to existing" searches this, then links it to the supplier.
  const { data: products = [] } = useQuery({
    queryKey: ['products-for-queue'],
    queryFn: () => base44.entities.Product.list('name', 5000),
  });

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

  // Filter
  const filtered = useMemo(() => {
    const result = unmatchedLines.filter(l => {
      const inv = invoiceMap[l.invoice_id];
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
  }, [unmatchedLines, filters, invoiceMap]);

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

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const handleFiltersChange = (newFilters) => {
    setFilters(newFilters);
    setPage(1);
  };

  // Group paginated slice by supplier for display
  const grouped = useMemo(() => {
    const groups = {};
    paginated.forEach(l => {
      const inv = invoiceMap[l.invoice_id];
      const supplierName = inv?.supplier_name || 'Unknown Supplier';
      if (!groups[supplierName]) groups[supplierName] = { supplier_id: inv?.supplier_id, lines: [] };
      groups[supplierName].lines.push({ line: l, invoice: inv });
    });
    return Object.entries(groups).sort((a, b) => b[1].lines.length - a[1].lines.length);
  }, [paginated, invoiceMap]);

  // Match a line to an existing CATALOGUE product, creating/updating the supplier link
  // with the supplier SKU + purchase UOM captured from the review form.
  const handleMatch = async (line, { product, supplierSku, description, purchaseUom, conversion, unitCost }) => {
    const inv = invoiceMap[line.invoice_id];
    if (!inv?.supplier_id) { toast.error('Invoice has no supplier'); return; }
    try {
      // Upsert the supplier_products link (UNIQUE on product_id + supplier_id).
      const existing = await base44.entities.SupplierProduct.filter({ supplier_id: inv.supplier_id, product_id: product.id });
      const spPayload = {
        supplier_id: inv.supplier_id,
        supplier_name: inv.supplier_name || '',
        product_id: product.id,
        product_name: product.name || '',
        product_sku: product.sku || '',
        supplier_sku: supplierSku || '',
        supplier_description: description || '',
        xero_item_code: line.xero_item_code || null,
        purchase_uom: purchaseUom || 'each',
        purchase_uom_label: purchaseUom || 'each',
        conversion_factor: parseFloat(conversion) || 1,
        last_purchase_price: parseFloat(unitCost) || 0,
        active: true,
      };
      let sp = existing[0];
      if (sp) {
        await base44.entities.SupplierProduct.update(sp.id, spPayload);
      } else {
        sp = await base44.entities.SupplierProduct.create(spPayload);
      }

      await base44.entities.PurchaseInvoiceLine.update(line.id, {
        supplier_product_id: sp.id,
        product_id: product.id,
        product_name: product.name,
        product_sku: product.sku,
        match_status: 'manually_matched',
      });
      await recountInvoice(line.invoice_id);
      queryClient.invalidateQueries({ queryKey: ['unmatched-invoice-lines'] });
      queryClient.invalidateQueries({ queryKey: ['sps-for-queue'] });
      toast.success(`Matched to ${product.name} & linked to ${inv.supplier_name}`);
    } catch (err) {
      toast.error(err.message || 'Match failed');
    }
  };

  const handleMarkNonStock = async (line) => {
    await base44.entities.PurchaseInvoiceLine.update(line.id, {
      match_status: 'non_stock_item',
    });
    await recountInvoice(line.invoice_id);
    queryClient.invalidateQueries({ queryKey: ['unmatched-invoice-lines'] });
    toast.success('Marked as non-stock item');
  };

  const handleProductCreated = async (line, sp) => {
    await base44.entities.PurchaseInvoiceLine.update(line.id, {
      supplier_product_id: sp.id,
      product_id: sp.product_id,
      product_name: sp.product_name,
      product_sku: sp.product_sku,
      match_status: 'manually_matched',
    });
    await recountInvoice(line.invoice_id);
    queryClient.invalidateQueries({ queryKey: ['unmatched-invoice-lines'] });
    queryClient.invalidateQueries({ queryKey: ['sps-for-queue'] });
    setCreateLineData(null);
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
            Match unmatched Xero invoice lines to products
          </p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-right">
          <p className="text-[10px] text-amber-600 uppercase font-semibold">Unmatched Lines</p>
          <p className="text-lg font-bold text-amber-700">{unmatchedLines.length}</p>
        </div>
      </div>

      <PageHelp items={HELP_ITEMS} />

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
            {unmatchedLines.length === 0 ? 'No unmatched invoice lines. Everything is matched.' : 'No results match your filter.'}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-6">
            {grouped.map(([supplierName, group]) => (
              <div key={supplierName}>
                <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                  {supplierName}
                  <span className="text-xs font-normal bg-muted px-2 py-0.5 rounded-full">{group.lines.length}</span>
                </h3>
                <div className="space-y-2">
                  {group.lines.map(({ line, invoice }) => (
                    <UnmatchedLineCard
                      key={line.id}
                      line={line}
                      invoice={invoice}
                      products={products}
                      onMatch={handleMatch}
                      onCreateProduct={(l, inv) => setCreateLineData({ line: l, invoice: inv })}
                      onMarkNonStock={handleMarkNonStock}
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

      {createLineData && (
        <CreateProductFromLineModal
          line={createLineData.line}
          invoice={createLineData.invoice}
          onCreated={handleProductCreated}
          onCancel={() => setCreateLineData(null)}
        />
      )}
    </div>
  );
}