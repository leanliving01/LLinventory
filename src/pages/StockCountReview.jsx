import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, Loader2, MapPin, CheckCircle2, Ban, ClipboardCheck, AlertTriangle, RefreshCw, Lock, Pencil, Eye,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { formatZAR } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import StockCountVarianceTable from '@/components/stock-count/StockCountVarianceTable';
import LockedCountReport from '@/components/stock-count/LockedCountReport';
import WebCountEntrySheet from '@/components/stock-count/WebCountEntrySheet';
import { buildVarianceRows, buildProgressRows, postStockCount, cancelStockCount, requestRecount, RECOUNT_STATUSES, COUNT_STATUS } from '@/lib/stockCount';

const STATUS_STYLES = {
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  under_review: 'bg-purple-100 text-purple-700',
  floor_completed: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
};

export default function StockCountReview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const canPost = !!perms.stocktake_create;
  const userName = user?.full_name || user?.email || 'System';

  const [posting, setPosting] = useState(false);
  const [recountMode, setRecountMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [requesting, setRequesting] = useState(false);
  const [entryMode, setEntryMode] = useState(false);

  const { data: header, isLoading: loadingHeader } = useQuery({
    queryKey: ['stock-count', id],
    queryFn: () => base44.entities.NewStockTake.filter({ id }).then(r => r[0]),
    // Poll while the floor is still counting so the web view tracks progress live.
    refetchInterval: (q) => {
      const s = q?.state?.data?.status;
      return s && !['completed', 'cancelled'].includes(s) ? 12000 : false;
    },
  });

  const locked = header?.status === 'completed';
  const live = header && !['completed', 'cancelled'].includes(header.status);

  const { data: lines = [], isLoading: loadingLines } = useQuery({
    queryKey: ['stock-count-lines', id],
    queryFn: () => base44.entities.StockTakeLine.filter({ stocktake_id: id }, 'product_name', 5000),
    refetchInterval: live ? 12000 : false,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products-active-for-review'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 5000),
  });
  const productById = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products]);

  // Live stock-on-hand for the count's locations — so the web shows system qty
  // (and forming variances) before the floor completes/snapshots.
  const locIds = useMemo(() => [...new Set(lines.map(l => l.location_id).filter(Boolean))], [lines]);
  const { data: sohRows = [] } = useQuery({
    queryKey: ['stock-count-soh', id, locIds.join(',')],
    queryFn: () => locIds.length
      ? base44.entities.StockOnHand.filter({ location_id: locIds }, 'product_name', 20000)
      : [],
    enabled: locIds.length > 0 && !locked,
    refetchInterval: live ? 12000 : false,
  });
  const sohByKey = useMemo(() => {
    const m = {};
    sohRows.forEach(s => { const k = `${s.product_id}_${s.location_id}`; m[k] = (m[k] || 0) + (Number(s.qty_on_hand) || 0); });
    return m;
  }, [sohRows]);

  // Locked = the official snapshot report; otherwise the live progress view (all lines).
  const rows = useMemo(
    () => (locked ? buildVarianceRows(lines, productById) : buildProgressRows(lines, productById, sohByKey)),
    [locked, lines, productById, sohByKey]
  );

  const totals = useMemo(() => {
    let surplus = 0, shortage = 0, value = 0, counted = 0;
    rows.forEach(r => {
      if (r._counted !== false) counted++;
      if (r._variance > 0) surplus++;
      else if (r._variance < 0) shortage++;
      value += r._varianceValue || 0;
    });
    return { surplus, shortage, value: Math.round(value * 100) / 100, counted, total: rows.length };
  }, [rows]);

  const isReviewable = header && ['floor_completed', 'under_review'].includes(header.status);
  const isWebEnterable = header && ['open', 'in_progress'].includes(header.status);
  const isRecounting = header && RECOUNT_STATUSES.includes(header.status);
  const isLocked = locked;
  const hasPrev = useMemo(() => rows.some(r => r.previous_counted_qty != null), [rows]);
  const multiLocation = useMemo(
    () => !header?.location_id || new Set(lines.map(l => l.location_id || '').filter(Boolean)).size > 1,
    [header, lines]
  );

  const toggle = (lineId) => setSelected(prev => {
    const next = new Set(prev);
    next.has(lineId) ? next.delete(lineId) : next.add(lineId);
    return next;
  });
  const toggleAll = () => setSelected(prev =>
    prev.size === rows.length ? new Set() : new Set(rows.map(r => r.id))
  );

  const handleRequestRecount = async () => {
    setRequesting(true);
    try {
      await requestRecount(id, [...selected], userName);
      setRecountMode(false);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['stock-count', id] });
      queryClient.invalidateQueries({ queryKey: ['stock-count-lines', id] });
      queryClient.invalidateQueries({ queryKey: ['stock-counts'] });
      toast.success('Recount requested — sent back to the floor');
    } catch (err) {
      toast.error('Failed: ' + (err.message || 'Unknown error'));
    } finally {
      setRequesting(false);
    }
  };

  const handlePost = async () => {
    setPosting(true);
    try {
      await postStockCount(id, userName);
      queryClient.invalidateQueries({ queryKey: ['stock-count', id] });
      queryClient.invalidateQueries({ queryKey: ['stock-count-lines', id] });
      queryClient.invalidateQueries({ queryKey: ['stock-counts'] });
      queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
      toast.success('Stock count posted — stock-on-hand updated');
    } catch (err) {
      toast.error('Post failed: ' + (err.message || 'Unknown error'));
    } finally {
      setPosting(false);
    }
  };

  const handleCancel = async () => {
    try {
      await cancelStockCount(id);
      queryClient.invalidateQueries({ queryKey: ['stock-count', id] });
      queryClient.invalidateQueries({ queryKey: ['stock-counts'] });
      toast.success('Count cancelled');
    } catch (err) {
      toast.error('Failed: ' + (err.message || 'Unknown error'));
    }
  };

  if (loadingHeader || loadingLines) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }
  if (!header) {
    return <div className="text-center py-16 text-sm text-muted-foreground">Count not found.</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={() => navigate('/stock/stock-take')} className="gap-1.5 text-muted-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <ClipboardCheck className="w-5 h-5 text-primary" />
        <span className="font-mono font-semibold text-base">{header.reference || header.id.slice(0, 8)}</span>
        <Badge className={`text-[10px] ${STATUS_STYLES[header.status] || 'bg-gray-100 text-gray-600'}`}>
          {COUNT_STATUS[header.status] || header.status}
        </Badge>
        <span className="text-[10px] text-muted-foreground uppercase">{header.count_type}</span>

        <div className="ml-auto flex items-center gap-2">
          {!isLocked && header.status !== 'cancelled' && canPost && (
            <Button variant="outline" size="sm" onClick={handleCancel} className="gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10">
              <Ban className="w-4 h-4" /> Cancel
            </Button>
          )}
          {isWebEnterable && !entryMode && (
            <Button variant="outline" size="sm" onClick={() => setEntryMode(true)} className="gap-1.5">
              <Pencil className="w-4 h-4" /> Enter Counts (Web)
            </Button>
          )}
          {isWebEnterable && entryMode && (
            <Button variant="outline" size="sm" onClick={() => setEntryMode(false)} className="gap-1.5">
              <Eye className="w-4 h-4" /> Progress View
            </Button>
          )}
          {canPost && isReviewable && !recountMode && (
            <Button variant="outline" size="sm" onClick={() => setRecountMode(true)} className="gap-1.5">
              <RefreshCw className="w-4 h-4" /> Request Recount
            </Button>
          )}
          {canPost && isReviewable && !recountMode && (
            <Button size="sm" onClick={handlePost} disabled={posting} className="gap-1.5 bg-green-600 hover:bg-green-700">
              {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Post Stock Take
            </Button>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="bg-card border border-border rounded-xl px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-muted-foreground" /> {header.location_name || '—'}</span>
        <span className="text-muted-foreground">{header.stocktake_date ? format(new Date(header.stocktake_date), 'dd MMM yyyy') : '—'}</span>
        <span className="text-muted-foreground">{totals.counted}/{totals.total} counted</span>
        {header.assigned_to_name && <span className="text-muted-foreground">Counter: {header.assigned_to_name}</span>}
        {header.posted_by && <span className="text-muted-foreground">Posted by {header.posted_by}</span>}
      </div>

      {/* Status hints */}
      {isWebEnterable && !entryMode && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            {totals.counted} of {totals.total} captured.
            {' '}Have a physical stock sheet? Use <strong>Enter Counts (Web)</strong> to type them in directly from this screen — no floor tablet needed.
          </span>
        </div>
      )}
      {isLocked && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Posted on {header.posted_at ? format(new Date(header.posted_at), 'dd MMM yyyy HH:mm') : ''} — stock-on-hand was updated. This report is locked.</span>
        </div>
      )}
      {isRecounting && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-orange-50 border border-orange-200 text-orange-700 text-sm">
          <RefreshCw className="w-4 h-4 mt-0.5 shrink-0" />
          <span>A recount is in progress on the floor for {header.uncounted_count || 0} item(s). The variance updates once the floor team resubmits.</span>
        </div>
      )}
      {live && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-sm">
          <Lock className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Stock is frozen for the items in this count — GRNs, production, sales, transfers and adjustments at these locations are blocked until the count is posted or cancelled.</span>
        </div>
      )}

      {/* Recount selection bar */}
      {recountMode && (
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-sm flex-wrap">
          <span className="font-medium">{selected.size} selected</span>
          <Button variant="ghost" size="sm" onClick={toggleAll}>
            {selected.size === rows.length ? 'Clear all' : 'Select all'}
          </Button>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setRecountMode(false); setSelected(new Set()); }}>Cancel</Button>
            <Button size="sm" onClick={handleRequestRecount} disabled={requesting || selected.size === 0} className="gap-1.5 bg-orange-600 hover:bg-orange-700">
              {requesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Request Recount ({selected.size})
            </Button>
          </div>
        </div>
      )}

      {/* Variance summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Counted lines" value={`${totals.counted}/${totals.total}`} />
        <SummaryCard label="Surplus (+)" value={totals.surplus} className="text-green-600" />
        <SummaryCard label="Shortage (−)" value={totals.shortage} className="text-red-600" />
        <SummaryCard label="Net variance value" value={formatZAR(totals.value)} className={totals.value < 0 ? 'text-red-600' : 'text-foreground'} />
      </div>

      {/* Web entry sheet — shown when user clicked "Enter Counts (Web)" */}
      {entryMode && isWebEnterable ? (
        <WebCountEntrySheet
          countId={id}
          header={header}
          lines={lines}
          products={products}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['stock-count-lines', id] });
          }}
          onSubmitted={() => {
            setEntryMode(false);
            queryClient.invalidateQueries({ queryKey: ['stock-count', id] });
            queryClient.invalidateQueries({ queryKey: ['stock-count-lines', id] });
            queryClient.invalidateQueries({ queryKey: ['stock-counts'] });
          }}
        />
      ) : isLocked ? (
        <LockedCountReport header={header} rows={rows} multiLocation={multiLocation} />
      ) : (
        <StockCountVarianceTable
          rows={rows}
          selectable={recountMode}
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
          showPrev={hasPrev}
          showLocation={multiLocation}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value, className = '' }) {
  return (
    <div className="bg-card border border-border rounded-xl px-4 py-3">
      <p className="text-[10px] text-muted-foreground uppercase font-semibold">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${className}`}>{value}</p>
    </div>
  );
}
