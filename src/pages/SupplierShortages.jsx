import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import { shortageStatusLabel, shortageKind } from '@/lib/shortageEngine';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PageHelp from '@/components/help/PageHelp';
import POFilters from '@/components/purchasing/POFilters';
import POPagination from '@/components/purchasing/POPagination';
import { usePersistentState, useScrollRestoration } from '@/lib/usePersistentState';

const STATUS_FILTER_OPTIONS = [
  'All statuses',
  'Awaiting remaining receival',
  'Awaiting credit note',
  'Partially credited',
  'Marked for review',
  'Resolved',
  'Cancelled',
];

const HELP_ITEMS = [
  { title: 'What are shortages?', text: 'When a GRN is short-received or an invoice bills for undelivered stock, the system tracks one central shortage per PO line — either awaiting the remaining receival or awaiting a supplier credit note.' },
  { title: 'How they resolve', text: 'An "awaiting receival" shortage closes automatically when the outstanding stock is received on a later GRN. An "awaiting credit note" shortage closes when a matching credit note is allocated on the PO\'s Credits & Returns tab.' },
  { title: 'Required action', text: 'The Action column tells you what is outstanding. Click any row to open the purchase order and act on it.' },
];

const TONE_CLASSES = {
  amber: 'bg-amber-100 text-amber-700',
  blue:  'bg-blue-100 text-blue-700',
  green: 'bg-green-100 text-green-700',
  gray:  'bg-gray-100 text-gray-600',
};

const RESOLVED_STATUSES = ['resolved', 'credit_received', 'cancelled', 'written_off'];
const isOpenShortage = (s) => !RESOLVED_STATUSES.includes(s.status);

function requiredAction(s) {
  if (RESOLVED_STATUSES.includes(s.status)) return '—';
  if (s.status === 'partially_credited') return 'Resolve credit variance';
  const k = shortageKind(s.decision);
  if (k === 'credit') return 'Allocate credit note';
  if (k === 'await') return s.expected_delivery_date ? `Receive remainder (by ${s.expected_delivery_date})` : 'Receive remainder';
  if (k === 'review') return 'Review & decide';
  return 'Follow up';
}

const STATUS_TABS = [
  { key: 'open', label: 'Open' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'all', label: 'All' },
];

const fmtQty = (v) => (v == null || v === '' ? '—' : Number(v));
const fmtR = (v) => `R ${(parseFloat(v) || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function SupplierShortages() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles); // eslint-disable-line no-unused-vars

  // View/filter state persists for the session so returning from a PO restores
  // the same tab, filters and page instead of resetting to defaults.
  const [statusTab, setStatusTab] = usePersistentState('shortages:statusTab', 'open');
  const [statusFilter, setStatusFilter] = usePersistentState('shortages:statusFilter', 'All statuses');
  const [page, setPage] = usePersistentState('shortages:page', 1);
  const [pageSize, setPageSize] = usePersistentState('shortages:pageSize', 50);
  const [filters, setFilters] = usePersistentState('shortages:filters', { search: '', supplierId: 'all', dateFrom: null, dateTo: null, sortBy: 'date_desc' });

  const { data: shortages = [], isLoading } = useQuery({
    queryKey: ['supplier-shortages'],
    queryFn: () => base44.entities.SupplierShortage.list('-created_date', 5000),
  });

  // Restore scroll position when returning from a PO.
  useScrollRestoration('shortages:scroll', !isLoading);
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-for-shortages-filter'],
    queryFn: () => base44.entities.Supplier.list('name', 500),
  });
  const { data: pos = [] } = useQuery({
    queryKey: ['pos-for-shortages'],
    queryFn: () => base44.entities.PurchaseOrder.list('-created_date', 5000),
  });
  const { data: grns = [] } = useQuery({
    queryKey: ['grns-for-shortages'],
    queryFn: () => base44.entities.GoodsReceivedNote.list('-received_date', 5000),
  });

  const poById = useMemo(() => Object.fromEntries(pos.map(p => [p.id, p])), [pos]);
  const grnById = useMemo(() => Object.fromEntries(grns.map(g => [g.id, g])), [grns]);

  // Enrich each shortage with PO/GRN reference fields for display
  const enriched = useMemo(() => shortages.map(s => {
    const po = poById[s.purchase_order_id];
    const grn = grnById[s.grn_id];
    return {
      ...s,
      po_number: po?.po_number || '—',
      order_date: po?.order_date || '—',
      grn_number: grn?.grn_number || '—',
      grn_received_date: grn?.received_date || '—',
    };
  }), [shortages, poById, grnById]);

  const filtered = useMemo(() => {
    let result = enriched.filter(s => {
      if (statusTab === 'open' && !isOpenShortage(s)) return false;
      if (statusTab === 'resolved' && isOpenShortage(s)) return false;
      if (statusFilter !== 'All statuses' && shortageStatusLabel(s).label !== statusFilter) return false;
      if (filters.supplierId !== 'all' && s.supplier_id !== filters.supplierId) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!(s.product_name || '').toLowerCase().includes(q) &&
            !(s.product_sku || '').toLowerCase().includes(q) &&
            !(s.supplier_name || '').toLowerCase().includes(q) &&
            !(s.po_number || '').toLowerCase().includes(q)) return false;
      }
      if (filters.dateFrom && s.created_date && new Date(s.created_date) < filters.dateFrom) return false;
      if (filters.dateTo && s.created_date) {
        const toEnd = new Date(filters.dateTo); toEnd.setHours(23, 59, 59, 999);
        if (new Date(s.created_date) > toEnd) return false;
      }
      return true;
    });
    const sorted = [...result];
    switch (filters.sortBy) {
      case 'date_asc':      sorted.sort((a, b) => (a.created_date || '').localeCompare(b.created_date || '')); break;
      case 'total_desc':    sorted.sort((a, b) => (b.shortage_value || 0) - (a.shortage_value || 0)); break;
      case 'total_asc':     sorted.sort((a, b) => (a.shortage_value || 0) - (b.shortage_value || 0)); break;
      case 'supplier_asc':  sorted.sort((a, b) => (a.supplier_name || '').localeCompare(b.supplier_name || '')); break;
      case 'supplier_desc': sorted.sort((a, b) => (b.supplier_name || '').localeCompare(a.supplier_name || '')); break;
      default:              sorted.sort((a, b) => (b.created_date || '').localeCompare(a.created_date || ''));
    }
    return sorted;
  }, [enriched, statusTab, statusFilter, filters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const openCount = enriched.filter(isOpenShortage).length;
  const resolvedCount = enriched.length - openCount;
  const totalOpenValue = enriched.filter(isOpenShortage).reduce((sum, s) => sum + (s.shortage_value || 0), 0);

  const openRow = (s) => {
    if (s.purchase_order_id) navigate(`/purchasing/workspace/${s.purchase_order_id}?tab=credits`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-amber-600" /> Supplier Shortages
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">One central record per PO line — awaiting receival or awaiting credit</p>
        </div>
        {totalOpenValue > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-right">
            <p className="text-[10px] text-amber-600 uppercase font-semibold">Open Shortage Value</p>
            <p className="text-lg font-bold text-amber-700">{fmtR(totalOpenValue)}</p>
          </div>
        )}
      </div>

      <PageHelp items={HELP_ITEMS} />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => { setStatusTab(tab.key); setPage(1); }}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
                statusTab === tab.key ? 'bg-primary/10 text-primary ring-2 ring-primary/30' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {tab.label} ({tab.key === 'open' ? openCount : tab.key === 'resolved' ? resolvedCount : enriched.length})
            </button>
          ))}
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="h-8 w-56 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_OPTIONS.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <POFilters filters={filters} onChange={(f) => { setFilters(f); setPage(1); }} suppliers={suppliers} />

      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          {enriched.length === 0 ? 'No shortages recorded yet.' : 'No shortages match your filter.'}
        </div>
      ) : (
        <>
          <div className="border border-border rounded-xl overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="bg-muted/50 border-b border-border text-[10px] uppercase text-muted-foreground">
                  <th className="text-left px-3 py-2 font-semibold">PO</th>
                  <th className="text-left px-3 py-2 font-semibold">Supplier</th>
                  <th className="text-left px-3 py-2 font-semibold">Product</th>
                  <th className="text-left px-3 py-2 font-semibold">Order Date</th>
                  <th className="text-left px-3 py-2 font-semibold">GRN</th>
                  <th className="text-left px-3 py-2 font-semibold">GRN Date</th>
                  <th className="text-left px-3 py-2 font-semibold">Invoice</th>
                  <th className="text-left px-3 py-2 font-semibold">Credit Note</th>
                  <th className="text-right px-3 py-2 font-semibold">Ord</th>
                  <th className="text-right px-3 py-2 font-semibold">Rec</th>
                  <th className="text-right px-3 py-2 font-semibold">Short</th>
                  <th className="text-right px-3 py-2 font-semibold">Value</th>
                  <th className="text-left px-3 py-2 font-semibold">Status</th>
                  <th className="text-left px-3 py-2 font-semibold">Action</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginated.map(s => {
                  const { label, tone } = shortageStatusLabel(s);
                  return (
                    <tr key={s.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => openRow(s)}>
                      <td className="px-3 py-2 font-mono text-xs">{s.po_number}</td>
                      <td className="px-3 py-2">{s.supplier_name || '—'}</td>
                      <td className="px-3 py-2">
                        <span className="font-medium">{s.product_name}</span>
                        <span className="text-[10px] font-mono text-muted-foreground ml-1">{s.product_sku}</span>
                        {s.status === 'partially_credited' && s.resolution_notes && (
                          <p className="text-[10px] text-amber-700 mt-0.5 whitespace-normal max-w-xs">{s.resolution_notes}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{s.order_date}</td>
                      <td className="px-3 py-2 font-mono text-xs">{s.grn_number}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{s.grn_received_date}</td>
                      <td className="px-3 py-2 font-mono text-xs">{s.invoice_number || '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs">{s.credit_note_number || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtQty(s.ordered_qty)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtQty(s.received_qty)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-600">{fmtQty(s.shortage_qty)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtR(s.shortage_value)}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${TONE_CLASSES[tone] || TONE_CLASSES.amber}`}>{label}</span>
                      </td>
                      <td className="px-3 py-2 text-xs">{requiredAction(s)}</td>
                      <td className="px-2 py-2 text-muted-foreground"><ChevronRight className="w-4 h-4" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <POPagination
            page={safePage}
            totalPages={totalPages}
            totalItems={filtered.length}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(sz) => { setPageSize(sz); setPage(1); }}
          />
        </>
      )}
    </div>
  );
}
