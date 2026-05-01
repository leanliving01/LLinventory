import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ClipboardList, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import UnmatchedLineCard from '@/components/review-queue/UnmatchedLineCard';
import CreateProductFromLineModal from '@/components/review-queue/CreateProductFromLineModal';
import PageHelp from '@/components/help/PageHelp';

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

  const [search, setSearch] = useState('');
  const [createLineData, setCreateLineData] = useState(null); // { line, invoice }

  // Fetch all unmatched invoice lines
  const { data: unmatchedLines = [], isLoading: loadingLines } = useQuery({
    queryKey: ['unmatched-invoice-lines'],
    queryFn: () => base44.entities.PurchaseInvoiceLine.filter({ match_status: 'unmatched' }, '-created_date', 500),
  });

  // Fetch invoices for context (supplier name etc)
  const { data: invoices = [] } = useQuery({
    queryKey: ['purchase-invoices-for-queue'],
    queryFn: () => base44.entities.PurchaseInvoice.list('-created_date', 500),
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
    if (!search) return unmatchedLines;
    const q = search.toLowerCase();
    return unmatchedLines.filter(l =>
      (l.xero_description || '').toLowerCase().includes(q) ||
      (l.xero_item_code || '').toLowerCase().includes(q) ||
      (invoiceMap[l.invoice_id]?.supplier_name || '').toLowerCase().includes(q)
    );
  }, [unmatchedLines, search, invoiceMap]);

  // Group by supplier for display
  const grouped = useMemo(() => {
    const groups = {};
    filtered.forEach(l => {
      const inv = invoiceMap[l.invoice_id];
      const supplierName = inv?.supplier_name || 'Unknown Supplier';
      if (!groups[supplierName]) groups[supplierName] = { supplier_id: inv?.supplier_id, lines: [] };
      groups[supplierName].lines.push({ line: l, invoice: inv });
    });
    return Object.entries(groups).sort((a, b) => b[1].lines.length - a[1].lines.length);
  }, [filtered, invoiceMap]);

  const handleMatch = async (line, sp) => {
    await base44.entities.PurchaseInvoiceLine.update(line.id, {
      supplier_product_id: sp.id,
      product_id: sp.product_id,
      product_name: sp.product_name,
      product_sku: sp.product_sku,
      match_status: 'manually_matched',
    });
    // Also save the xero_item_code on the SupplierProduct for future auto-matching
    if (line.xero_item_code && !sp.xero_item_code) {
      await base44.entities.SupplierProduct.update(sp.id, { xero_item_code: line.xero_item_code });
    }
    await recountInvoice(line.invoice_id);
    queryClient.invalidateQueries({ queryKey: ['unmatched-invoice-lines'] });
    toast.success(`Matched to ${sp.product_name}`);
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

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search description, item code, or supplier..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch('')} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

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
            {unmatchedLines.length === 0 ? 'No unmatched invoice lines. Everything is matched.' : 'No results match your search.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([supplierName, group]) => (
            <div key={supplierName}>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                {supplierName}
                <span className="text-xs font-normal bg-muted px-2 py-0.5 rounded-full">{group.lines.length}</span>
              </h3>
              <div className="space-y-2">
                {group.lines.slice(0, 15).map(({ line, invoice }) => (
                  <UnmatchedLineCard
                    key={line.id}
                    line={line}
                    invoice={invoice}
                    supplierProducts={spBySupplier[group.supplier_id] || []}
                    onMatch={handleMatch}
                    onCreateProduct={(l, inv) => setCreateLineData({ line: l, invoice: inv })}
                    onMarkNonStock={handleMarkNonStock}
                  />
                ))}
                {group.lines.length > 15 && (
                  <p className="text-xs text-muted-foreground text-center py-1">
                    + {group.lines.length - 15} more — use search to narrow
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
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