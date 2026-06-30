import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { FileText, ScanLine } from 'lucide-react';
import InvoiceScanDialog from '@/components/purchasing/InvoiceScanDialog';
import ScanDraftsBanner from '@/components/purchasing/ScanDraftsBanner';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import InvoiceCard from '@/components/invoices/InvoiceCard';
import InvoiceDrawer from '@/components/invoices/InvoiceDrawer';
import PageHelp from '@/components/help/PageHelp';
import POFilters from '@/components/purchasing/POFilters';
import POPagination from '@/components/purchasing/POPagination';
import SyncStatusBanner from '@/components/shopify/SyncStatusBanner';

const HELP_ITEMS = [
  { title: 'Sync invoices', text: 'Click "Sync from Xero" to pull all ACCPAY (purchase) bills from Xero. The system auto-matches invoice lines to your Supplier Product catalog using Xero item codes.' },
  { title: 'Unmatched lines', text: 'Invoice lines that could not be auto-matched show as "unmatched". Open the invoice and manually match them to a Supplier Product, or mark them as non-stock items.' },
  { title: 'Three-way match', text: 'Once all lines are matched, the invoice status changes to "matched". You can then link it to a PO and GRN for full three-way reconciliation.' },
];

const STATUS_TABS = [
  { key: 'pending_match', label: 'Needs Matching' },
  { key: 'matched', label: 'Matched' },
  { key: 'approved', label: 'Approved' },
  { key: 'all', label: 'All' },
];

export default function PurchaseInvoices() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);

  const [statusTab, setStatusTab] = useState('all');
  const [selected, setSelected] = useState(null);
  const [showScan, setShowScan] = useState(false);
  const [resumeDraft, setResumeDraft] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [filters, setFilters] = useState({
    search: '',
    supplierId: 'all',
    dateFrom: null,
    dateTo: null,
    sortBy: 'date_desc',
  });

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['purchase-invoices'],
    queryFn: () => base44.entities.PurchaseInvoice.list('-invoice_date', 5000),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-for-invoice-filter'],
    queryFn: () => base44.entities.Supplier.list('name', 500),
  });

  const filtered = useMemo(() => {
    const result = invoices.filter(inv => {
      if (statusTab !== 'all' && inv.status !== statusTab) return false;
      if (filters.supplierId !== 'all' && inv.supplier_id !== filters.supplierId) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!(inv.invoice_number || '').toLowerCase().includes(q) &&
            !(inv.supplier_name || '').toLowerCase().includes(q)) return false;
      }
      if (filters.dateFrom && inv.invoice_date && new Date(inv.invoice_date) < filters.dateFrom) return false;
      if (filters.dateTo && inv.invoice_date && new Date(inv.invoice_date) > filters.dateTo) return false;
      return true;
    });

    // Sort
    const sorted = [...result];
    switch (filters.sortBy) {
      case 'date_desc':     sorted.sort((a, b) => (b.invoice_date || '').localeCompare(a.invoice_date || '')); break;
      case 'date_asc':      sorted.sort((a, b) => (a.invoice_date || '').localeCompare(b.invoice_date || '')); break;
      case 'total_desc':    sorted.sort((a, b) => (b.total || 0) - (a.total || 0)); break;
      case 'total_asc':     sorted.sort((a, b) => (a.total || 0) - (b.total || 0)); break;
      case 'supplier_asc':  sorted.sort((a, b) => (a.supplier_name || '').localeCompare(b.supplier_name || '')); break;
      case 'supplier_desc': sorted.sort((a, b) => (b.supplier_name || '').localeCompare(a.supplier_name || '')); break;
    }
    return sorted;
  }, [invoices, statusTab, filters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  const statusCounts = useMemo(() => {
    const c = { all: invoices.length };
    invoices.forEach(inv => { c[inv.status] = (c[inv.status] || 0) + 1; });
    return c;
  }, [invoices]);

  const totalUnmatched = invoices.reduce((s, inv) => s + (inv.unmatched_line_count || 0), 0);

  // Refetch invoices whenever the xero_invoices sync state changes (progress, completion)
  const { data: syncStates = [] } = useQuery({
    queryKey: ['sync-states'],
    queryFn: () => base44.entities.SyncState.filter({}),
    refetchInterval: (q) => {
      const states = q.state.data || [];
      return states.some(s => s.sync_status === 'running' || s.sync_status === 'cancelling') ? 3000 : 30000;
    },
  });
  const xeroInvoiceState = syncStates.find(s => s.source_key === 'xero_invoices');
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['purchase-invoices'] });
  }, [xeroInvoiceState?.records_synced, xeroInvoiceState?.sync_status, queryClient]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="w-6 h-6 text-primary" /> Purchase Invoices
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Xero invoice sync and product matching
          </p>
        </div>
        <div className="flex items-center gap-2">
          {totalUnmatched > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-xs font-medium text-amber-700">
              {totalUnmatched} unmatched line{totalUnmatched !== 1 ? 's' : ''} across all invoices
            </div>
          )}
          <Button onClick={() => setShowScan(true)} className="gap-2">
            <ScanLine className="w-4 h-4" /> Scan Invoice
          </Button>
        </div>
      </div>

      {perms.xero_invoice_sync && (
        <SyncStatusBanner syncKeys={['xero_invoices']} title="Xero Invoice Sync" />
      )}

      <ScanDraftsBanner onResume={(d) => { setResumeDraft(d); setShowScan(true); }} />

      <PageHelp items={HELP_ITEMS} />

      {/* Status tabs */}
      <div className="flex gap-2 flex-wrap">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setStatusTab(tab.key)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
              statusTab === tab.key
                ? 'bg-primary/10 text-primary ring-2 ring-primary/30'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {tab.label} ({statusCounts[tab.key] || 0})
          </button>
        ))}
      </div>

      {/* Filters */}
      <POFilters filters={filters} onChange={setFilters} suppliers={suppliers} />

      {/* List */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          {invoices.length === 0 ? 'No invoices yet. Click "Sync from Xero" to pull bills.' : 'No invoices match your filter.'}
        </div>
      ) : (
        <>
          <div className="grid gap-3">
            {paginated.map(inv => (
              <InvoiceCard key={inv.id} invoice={inv} onClick={setSelected} />
            ))}
          </div>
          <POPagination
            page={page}
            totalPages={totalPages}
            totalItems={filtered.length}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          />
        </>
      )}

      {selected && (
        <InvoiceDrawer
          invoice={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => {
            queryClient.invalidateQueries({ queryKey: ['purchase-invoices'] });
            base44.entities.PurchaseInvoice.filter({ id: selected.id }).then(res => {
              if (res[0]) setSelected(res[0]); else setSelected(null);
            });
          }}
          canEdit={perms.product_review}
        />
      )}

      {showScan && (
        <InvoiceScanDialog
          resumeDraft={resumeDraft}
          onClose={() => { setShowScan(false); setResumeDraft(null); }}
          onSaved={() => {
            setShowScan(false);
            setResumeDraft(null);
            queryClient.invalidateQueries({ queryKey: ['purchase-invoices'] });
          }}
        />
      )}
    </div>
  );
}