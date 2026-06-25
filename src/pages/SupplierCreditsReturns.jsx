import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import {
  CreditCard, AlertTriangle, RotateCcw, CheckCircle2, XCircle,
  Loader2, FileText
} from 'lucide-react';
import { toast } from 'sonner';
import CreditNoteMatchingDrawer from '@/components/credits/CreditNoteMatchingDrawer';

const STATUS_BADGE = {
  credit_required: 'bg-amber-100 text-amber-700',
  credit_requested: 'bg-blue-100 text-blue-700',
  credit_note_received: 'bg-indigo-100 text-indigo-700',
  partially_credited: 'bg-orange-100 text-orange-700',
  matched: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
  // return statuses
  pending_return: 'bg-amber-100 text-amber-700',
  returned: 'bg-blue-100 text-blue-700',
  credit_received: 'bg-green-100 text-green-700',
  disputed: 'bg-red-100 text-red-600',
};

const STATUS_LABELS = {
  credit_required: 'Credit Required',
  credit_requested: 'Credit Requested',
  credit_note_received: 'CN Received',
  partially_credited: 'Partially Credited',
  matched: 'Matched',
  cancelled: 'Cancelled',
  pending_return: 'Pending Return',
  returned: 'Returned',
  credit_received: 'Credit Received',
  disputed: 'Disputed',
};

const ALL_STATUSES = [
  'credit_required',
  'credit_requested',
  'credit_note_received',
  'partially_credited',
  'matched',
  'cancelled',
];

export default function SupplierCreditsReturns() {
  const queryClient = useQueryClient();
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('open');
  const [matchingDrawerItem, setMatchingDrawerItem] = useState(null);
  const [actioning, setActioning] = useState(null);

  const { data: shortages = [], isLoading: loadingShortages } = useQuery({
    queryKey: ['supplier-shortages'],
    queryFn: () => base44.entities.SupplierShortage.list('-created_date', 5000),
  });

  const { data: returns_ = [], isLoading: loadingReturns } = useQuery({
    queryKey: ['supplier-returns'],
    queryFn: () => base44.entities.SupplierReturn.list('-created_date', 2000),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => base44.entities.Supplier.list('name', 500),
  });

  // Build unified list
  const unifiedItems = useMemo(() => {
    const items = [];

    // Shortages: show those not yet matched or cancelled
    for (const s of shortages) {
      const status = s.credit_follow_up_status || 'credit_required';
      if (status === 'matched' || status === 'cancelled') {
        // include only if statusFilter explicitly asks for them
        if (statusFilter !== 'all' && statusFilter !== status) continue;
      }
      items.push({
        ...s,
        _source: 'shortage',
        _displayStatus: status,
        _qty: s.shortage_qty,
        _value: s.shortage_value,
        _uom: s.purchase_uom,
        _date: s.created_date,
        _product: s.product_name,
        _sku: s.product_sku,
        _creditNoteNumber: s.credit_note_number || '',
      });
    }

    // Returns: show those where credit is expected and not yet received
    for (const r of returns_) {
      if (!r.credit_expected) continue;
      if (r.status === 'credit_received') {
        if (statusFilter !== 'all' && statusFilter !== 'matched') continue;
      }
      items.push({
        ...r,
        _source: 'return',
        _displayStatus: r.credit_follow_up_status || (r.status === 'credit_received' ? 'matched' : 'credit_required'),
        _qty: r.total_return_value ? '—' : null,
        _value: r.total_return_value,
        _uom: '',
        _date: r.return_date || r.created_date,
        _product: `Return ${r.return_number}`,
        _sku: '',
        _creditNoteNumber: r.credit_note_number || '',
      });
    }

    return items;
  }, [shortages, returns_, statusFilter]);

  const filtered = useMemo(() => {
    return unifiedItems.filter(item => {
      if (supplierFilter !== 'all' && item.supplier_id !== supplierFilter) return false;
      if (statusFilter === 'open') {
        // open = anything not matched or cancelled
        return item._displayStatus !== 'matched' && item._displayStatus !== 'cancelled'
          && item._displayStatus !== 'credit_received';
      }
      if (statusFilter === 'all') return true;
      return item._displayStatus === statusFilter;
    });
  }, [unifiedItems, supplierFilter, statusFilter]);

  const isLoading = loadingShortages || loadingReturns;

  const handleMarkRequested = async (item) => {
    setActioning(item.id);
    try {
      if (item._source === 'shortage') {
        await base44.entities.SupplierShortage.update(item.id, {
          credit_follow_up_status: 'credit_requested',
        });
        queryClient.invalidateQueries({ queryKey: ['supplier-shortages'] });
      } else {
        await base44.entities.SupplierReturn.update(item.id, {
          credit_follow_up_status: 'credit_requested',
        });
        queryClient.invalidateQueries({ queryKey: ['supplier-returns'] });
      }
      toast.success('Marked as credit requested');
    } catch (err) {
      toast.error('Failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setActioning(null);
    }
  };

  const handleCancel = async (item) => {
    setActioning(item.id);
    try {
      if (item._source === 'shortage') {
        await base44.entities.SupplierShortage.update(item.id, {
          credit_follow_up_status: 'cancelled',
          status: 'cancelled',
        });
        queryClient.invalidateQueries({ queryKey: ['supplier-shortages'] });
      } else {
        await base44.entities.SupplierReturn.update(item.id, {
          credit_follow_up_status: 'cancelled',
        });
        queryClient.invalidateQueries({ queryKey: ['supplier-returns'] });
      }
      toast.success('Cancelled');
    } catch (err) {
      toast.error('Failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setActioning(null);
    }
  };

  const totalOpenValue = filtered
    .filter(i => i._displayStatus !== 'matched' && i._displayStatus !== 'cancelled')
    .reduce((s, i) => s + (parseFloat(i._value) || 0), 0);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-primary" />
            Supplier Credits &amp; Returns
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track outstanding credit notes from short deliveries and returns
          </p>
        </div>
        {totalOpenValue > 0 && (
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Open credit value</div>
            <div className="text-2xl font-bold text-amber-600">R {totalOpenValue.toFixed(2)}</div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <SearchableSelect
          value={supplierFilter}
          onValueChange={setSupplierFilter}
          options={[
            { value: 'all', label: 'All Suppliers' },
            ...suppliers.map(s => ({ value: s.id, label: s.name })),
          ]}
          placeholder="All suppliers"
          searchPlaceholder="Search suppliers..."
          triggerClassName="w-52"
        />

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open (pending action)</SelectItem>
            <SelectItem value="all">All</SelectItem>
            {ALL_STATUSES.map(s => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s] || s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground ml-auto">
          {filtered.length} item{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-400" />
          <p className="font-medium">No outstanding credits</p>
          <p className="text-sm mt-1">All follow-ups are resolved.</p>
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase">Supplier</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase">Source</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase">Product / Ref</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase">Qty</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase">UOM</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase">Value</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase">Status</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase">Invoice #</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase">Credit Note #</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase">Date</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(item => {
                const isActioning = actioning === item.id;
                const status = item._displayStatus;
                const canRequest = status === 'credit_required';
                const canMatch = status !== 'matched' && status !== 'cancelled';
                const canCancel = status !== 'matched' && status !== 'cancelled';

                return (
                  <tr key={`${item._source}-${item.id}`} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-medium">{item.supplier_name}</td>
                    <td className="px-4 py-3">
                      {item._source === 'shortage' ? (
                        <span className="flex items-center gap-1 text-xs text-amber-700">
                          <AlertTriangle className="w-3.5 h-3.5" /> Shortage
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-blue-700">
                          <RotateCcw className="w-3.5 h-3.5" /> Return
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{item._product}</div>
                      {item._sku && <div className="text-xs text-muted-foreground">{item._sku}</div>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {item._qty != null && item._qty !== '—' ? Number(item._qty).toFixed(2) : item._qty || '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{item._uom || '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      R {(parseFloat(item._value) || 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={`text-[10px] ${STATUS_BADGE[status] || 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABELS[status] || status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                      {item.invoice_number || '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {item._creditNoteNumber ? (
                        <span className="flex items-center gap-1">
                          <FileText className="w-3.5 h-3.5" />{item._creditNoteNumber}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {item._date ? item._date.slice(0, 10) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {canRequest && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs px-2"
                            disabled={isActioning}
                            onClick={() => handleMarkRequested(item)}
                          >
                            {isActioning ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Mark Requested'}
                          </Button>
                        )}
                        {canMatch && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs px-2"
                            onClick={() => setMatchingDrawerItem(item)}
                          >
                            Match CN
                          </Button>
                        )}
                        {canCancel && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs px-2 text-red-600 hover:text-red-700"
                            disabled={isActioning}
                            onClick={() => handleCancel(item)}
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Credit Note Matching Drawer */}
      {matchingDrawerItem && (
        <CreditNoteMatchingDrawer
          open={!!matchingDrawerItem}
          onClose={() => {
            setMatchingDrawerItem(null);
            queryClient.invalidateQueries({ queryKey: ['supplier-shortages'] });
            queryClient.invalidateQueries({ queryKey: ['supplier-returns'] });
          }}
          triggerItem={matchingDrawerItem}
          supplierId={matchingDrawerItem.supplier_id}
        />
      )}
    </div>
  );
}
