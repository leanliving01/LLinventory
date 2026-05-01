import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileText, RefreshCw, Search, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import InvoiceCard from '@/components/invoices/InvoiceCard';
import InvoiceDrawer from '@/components/invoices/InvoiceDrawer';
import PageHelp from '@/components/help/PageHelp';

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

  const [statusTab, setStatusTab] = useState('pending_match');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['purchase-invoices'],
    queryFn: () => base44.entities.PurchaseInvoice.list('-created_date', 500),
  });

  const filtered = useMemo(() => {
    return invoices.filter(inv => {
      if (statusTab !== 'all' && inv.status !== statusTab) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(inv.invoice_number || '').toLowerCase().includes(q) &&
            !(inv.supplier_name || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [invoices, statusTab, search]);

  const statusCounts = useMemo(() => {
    const c = { all: invoices.length };
    invoices.forEach(inv => { c[inv.status] = (c[inv.status] || 0) + 1; });
    return c;
  }, [invoices]);

  const totalUnmatched = invoices.reduce((s, inv) => s + (inv.unmatched_line_count || 0), 0);

  const handleSync = async () => {
    setSyncing(true);
    const res = await base44.functions.invoke('syncXeroInvoices', { since: '2026-01-01' });
    setSyncing(false);
    if (res.data.error) {
      toast.error(res.data.error);
    } else {
      const s = res.data.summary;
      toast.success(`Synced: ${s.invoices_created} new, ${s.invoices_updated} updated, ${s.auto_matched_lines} auto-matched, ${s.unmatched_lines} unmatched`);
      queryClient.invalidateQueries({ queryKey: ['purchase-invoices'] });
    }
  };

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
          {perms.xero_invoice_sync && (
            <Button onClick={handleSync} disabled={syncing} className="gap-2 h-11 px-5">
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {syncing ? 'Syncing...' : 'Sync from Xero'}
            </Button>
          )}
        </div>
      </div>

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

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search invoice number or supplier..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch('')} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          {invoices.length === 0 ? 'No invoices yet. Click "Sync from Xero" to pull bills.' : 'No invoices match your filter.'}
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.slice(0, 15).map(inv => (
            <InvoiceCard key={inv.id} invoice={inv} onClick={setSelected} />
          ))}
          {filtered.length > 15 && (
            <p className="text-center text-xs text-muted-foreground py-2">
              Showing 15 of {filtered.length}
            </p>
          )}
        </div>
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
    </div>
  );
}