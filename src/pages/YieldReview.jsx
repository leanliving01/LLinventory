import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Gauge, CheckCircle2, XCircle, Flag, AlertTriangle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';

const STATUS_STYLES = {
  pending_review: 'bg-amber-100 text-amber-700',
  approved_record_only: 'bg-green-100 text-green-700',
  approved_update_average: 'bg-green-100 text-green-700',
  approved_do_not_update: 'bg-blue-100 text-blue-700',
  rejected: 'bg-red-100 text-red-600',
  flagged_unusual: 'bg-purple-100 text-purple-700',
};

const STATUS_LABELS = {
  pending_review: 'Pending Review',
  approved_record_only: 'Approved (Record)',
  approved_update_average: 'Approved (Update Avg)',
  approved_do_not_update: 'Approved (No Update)',
  rejected: 'Rejected',
  flagged_unusual: 'Flagged',
};

const APPROVAL_OPTIONS = [
  { value: 'approved_record_only', label: 'Approve — Record Only' },
  { value: 'approved_update_average', label: 'Approve — Update Rolling Average' },
  { value: 'approved_do_not_update', label: 'Approve — Do Not Update Average' },
  { value: 'rejected', label: 'Reject' },
  { value: 'flagged_unusual', label: 'Flag as Unusual' },
];

export default function YieldReview() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const [statusFilter, setStatusFilter] = useState('pending_review');
  const [expandedId, setExpandedId] = useState(null);
  const [reviewAction, setReviewAction] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: records = [], isLoading } = useQuery({
    queryKey: ['yield-records'],
    queryFn: () => base44.entities.YieldRecord.list('-production_date', 200),
  });

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return records;
    return records.filter(r => r.status === statusFilter);
  }, [records, statusFilter]);

  const statusCounts = useMemo(() => {
    const c = {};
    records.forEach(r => { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }, [records]);

  const handleReview = async (record) => {
    if (!reviewAction) { toast.error('Select an action'); return; }
    setSaving(true);

    await base44.entities.YieldRecord.update(record.id, {
      status: reviewAction,
      pm_review_notes: reviewNotes || null,
      pm_reviewed_by: user?.full_name || '',
      pm_reviewed_at: new Date().toISOString(),
    });

    toast.success(`Yield record ${STATUS_LABELS[reviewAction]?.toLowerCase()}`);
    setSaving(false);
    setExpandedId(null);
    setReviewAction('');
    setReviewNotes('');
    queryClient.invalidateQueries({ queryKey: ['yield-records'] });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Gauge className="w-6 h-6 text-primary" /> Yield Review
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Review and approve cooking run yield records
        </p>
      </div>

      {/* Status tabs */}
      <div className="flex gap-2 flex-wrap">
        {['pending_review', 'approved_record_only', 'approved_update_average', 'rejected', 'flagged_unusual', 'all'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
              statusFilter === s ? 'bg-primary/10 text-primary ring-2 ring-primary/30' : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {STATUS_LABELS[s] || 'All'} ({s === 'all' ? records.length : (statusCounts[s] || 0)})
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">No yield records match this filter</div>
      ) : (
        <div className="space-y-3">
          {filtered.slice(0, 15).map(record => {
            const isExpanded = expandedId === record.id;
            return (
              <div key={record.id} className="bg-card border border-border rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : record.id)}
                  className="w-full text-left px-5 py-4 flex items-center justify-between hover:bg-muted/20 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={`text-[10px] ${STATUS_STYLES[record.status]}`}>
                          {STATUS_LABELS[record.status]}
                        </Badge>
                        {record.significant_variance_flag && (
                          <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-600">
                            <AlertTriangle className="w-3 h-3 mr-1" /> Significant Variance
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm font-semibold">{record.bulk_product_name}</p>
                      <p className="text-xs text-muted-foreground">{record.production_date} · {record.supplier_name || 'No supplier'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground">Yield</p>
                      <p className={`font-bold ${(record.yield_variance_pct || 0) > 0 ? 'text-green-600' : (record.yield_variance_pct || 0) < -5 ? 'text-red-600' : 'text-amber-600'}`}>
                        {record.actual_yield_pct?.toFixed(1)}%
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground">Variance</p>
                      <p className="font-medium">{record.yield_variance_pct > 0 ? '+' : ''}{record.yield_variance_pct?.toFixed(1)}%</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground">Cost/kg</p>
                      <p className="font-medium">R {(record.actual_cost_per_cooked_kg || 0).toFixed(2)}</p>
                    </div>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-5 pb-5 border-t border-border pt-4 space-y-4">
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div><span className="text-muted-foreground text-xs">Raw Issued</span><p className="font-medium">{record.actual_raw_issued_kg} kg</p></div>
                      <div><span className="text-muted-foreground text-xs">Wastage</span><p className="font-medium">{record.wastage_qty_kg || 0} kg</p></div>
                      <div><span className="text-muted-foreground text-xs">Effective Raw</span><p className="font-medium">{record.effective_raw_for_yield_kg} kg</p></div>
                      <div><span className="text-muted-foreground text-xs">Cooked Output</span><p className="font-medium">{record.actual_cooked_output_kg} kg</p></div>
                      <div><span className="text-muted-foreground text-xs">Expected Yield</span><p className="font-medium">{record.bom_expected_yield_pct}%</p></div>
                      <div><span className="text-muted-foreground text-xs">BOM Cost/kg</span><p className="font-medium">R {(record.bom_expected_cost_per_cooked_kg || 0).toFixed(2)}</p></div>
                    </div>

                    {record.pm_reviewed_by && (
                      <div className="bg-muted/30 rounded-lg p-3 text-xs">
                        <p><span className="text-muted-foreground">Reviewed by:</span> {record.pm_reviewed_by}</p>
                        {record.pm_review_notes && <p className="mt-1">{record.pm_review_notes}</p>}
                      </div>
                    )}

                    {record.status === 'pending_review' && perms.yield_review && (
                      <div className="border border-border rounded-lg p-4 space-y-3">
                        <h4 className="text-sm font-semibold">Review Action</h4>
                        <Select value={reviewAction} onValueChange={setReviewAction}>
                          <SelectTrigger><SelectValue placeholder="Select action..." /></SelectTrigger>
                          <SelectContent>
                            {APPROVAL_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Input value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} placeholder="Review notes (optional)..." />
                        <Button onClick={() => handleReview(record)} disabled={saving || !reviewAction} className="gap-2 w-full h-11">
                          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                          Submit Review
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length > 15 && (
            <p className="text-center text-xs text-muted-foreground">Showing 15 of {filtered.length}</p>
          )}
        </div>
      )}
    </div>
  );
}