import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44, supabase } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Send, Save, CheckCircle2, Loader2, Trash2, Plus, XCircle, Truck, PackageCheck, ShieldAlert, History } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import { writeAuditLog } from '@/lib/auditLog';
import { formatDateTimeSAST } from '@/lib/dateUtils';
import { RESEND_STATUS_LABELS, RESEND_STATUS_COLORS, RESEND_REASONS } from '@/lib/salesResends';
import { EXCEPTION_STATUS_LABELS, EXCEPTION_STATUS_COLORS } from '@/lib/shopifyReturns';
import { logWorkflowEvent } from '@/lib/salesWorkflowEvents';
import WorkflowAuditTimeline from '@/components/returns/WorkflowAuditTimeline';

export default function SalesResendDetail() {
  const { resendId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const canProcess = !!perms.sales_resends_process || user?.role === 'admin';
  const canApprove = !!perms.returns_manager_approve || user?.role === 'admin';
  const userName = user?.full_name || user?.email || 'system';

  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null);
  const [rows, setRows] = useState([]);
  const [approveLoc, setApproveLoc] = useState('');
  const [addQuery, setAddQuery] = useState('');

  const { data: rs, isLoading } = useQuery({
    queryKey: ['sales-resend', resendId],
    queryFn: async () => (await base44.entities.SalesResend.filter({ id: resendId }))[0] || null,
    enabled: !!resendId,
  });
  const { data: lines = [] } = useQuery({
    queryKey: ['sales-resend-lines', resendId],
    queryFn: () => base44.entities.SalesResendLine.filter({ resend_id: resendId }, 'product_name', 200),
    enabled: !!resendId,
  });
  const { data: locations = [] } = useQuery({
    queryKey: ['stock-bearing-locations'],
    queryFn: () => base44.entities.Location.filter({ is_stock_bearing: true }, 'name', 200),
  });
  const { data: productMatches = [] } = useQuery({
    queryKey: ['product-search-resend', addQuery],
    queryFn: () => base44.entities.Product.filter({ sku: { $ilike: addQuery.trim() } }, 'name', 15),
    enabled: addQuery.trim().length >= 2,
  });

  useEffect(() => {
    if (rs) setForm({
      reason: rs.reason || '', notes: rs.notes || '',
      courier_company: rs.courier_company || '', courier_tracking_ref: rs.courier_tracking_ref || '',
      dispatch_date: rs.dispatch_date || '', courier_notes: rs.courier_notes || '',
      exception_notes: rs.exception_notes || '',
    });
  }, [rs]);
  useEffect(() => { setRows(lines.map(l => ({ ...l }))); }, [lines]);

  if (isLoading || !rs || !form) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  const editable = ['draft', 'pending_approval'].includes(rs.status) && canProcess;
  const set = (patch) => setForm(f => ({ ...f, ...patch }));

  const persistHeader = async (patch, msg, audit) => {
    setSaving(true);
    await base44.entities.SalesResend.update(rs.id, patch);
    setSaving(false);
    if (audit) writeAuditLog({ action: audit, entity_type: 'SalesResend', entity_id: rs.id, description: `${audit} re-send ${rs.resend_number}` });
    if (msg) logWorkflowEvent({ entityType: 'sales_resend', entityId: rs.id, eventType: 'status', actor: userName, description: msg });
    queryClient.invalidateQueries({ queryKey: ['sales-resend', resendId] });
    queryClient.invalidateQueries({ queryKey: ['sales-resends'] });
    if (msg) toast.success(msg);
  };

  // Manager toggle: flag (or unflag) this re-send as requiring approval.
  const setApprovalRequired = (val) =>
    persistHeader({ manager_approval_required: val, exception_status: val ? 'pending' : 'none' },
      val ? 'Flagged — requires manager approval' : 'Manager approval requirement removed');

  // Manager resolves the approval requirement.
  const resolveApproval = (decision) => {
    if (!canApprove) { toast.error('You do not have manager-approval permission'); return; }
    persistHeader({
      exception_status: decision === 'approve' ? 'approved' : 'rejected',
      exception_resolved_by: userName,
      exception_resolved_at: new Date().toISOString(),
      exception_notes: form.exception_notes || null,
    }, decision === 'approve' ? 'Re-send approved by manager' : 'Re-send rejected by manager');
  };

  const approvalBlocked = rs.manager_approval_required && rs.exception_status !== 'approved';

  const saveDraft = async () => {
    setSaving(true);
    // Reconcile lines: delete removed, upsert the rest.
    const keepIds = new Set(rows.map(r => r.id));
    const removed = lines.filter(l => !keepIds.has(l.id));
    for (const r of removed) await base44.entities.SalesResendLine.delete(r.id);
    for (const r of rows) {
      const payload = { qty: Number(r.qty) || 0, product_id: r.product_id || null, sku: r.sku || null, product_name: r.product_name || null, variant_title: r.variant_title || null, is_package_parent: !!r.is_package_parent, line_type: r.line_type || null, unit_price: Number(r.unit_price) || 0 };
      if (r._new) await base44.entities.SalesResendLine.create({ id: r.id, resend_id: rs.id, ...payload });
      else await base44.entities.SalesResendLine.update(r.id, payload);
    }
    await base44.entities.SalesResend.update(rs.id, {
      reason: form.reason || null, notes: form.notes || null,
      courier_company: form.courier_company || null, courier_tracking_ref: form.courier_tracking_ref || null,
      dispatch_date: form.dispatch_date || null, courier_notes: form.courier_notes || null,
    });
    setSaving(false);
    writeAuditLog({ action: 'save', entity_type: 'SalesResend', entity_id: rs.id, description: `Saved draft re-send ${rs.resend_number}` });
    queryClient.invalidateQueries({ queryKey: ['sales-resend-lines', resendId] });
    queryClient.invalidateQueries({ queryKey: ['sales-resend', resendId] });
    toast.success('Draft saved');
  };

  const approve = async () => {
    if (!form.reason) { toast.error('Select a reason before approving'); return; }
    if (!approveLoc) { toast.error('Pick a dispatch location'); return; }
    if (rows.length === 0) { toast.error('Add at least one item'); return; }
    if (approvalBlocked) { toast.error('Blocked — this re-send requires manager approval first.'); return; }
    await saveDraft();
    setSaving(true);
    const { data, error } = await supabase.rpc('approve_resend', { p_resend_id: rs.id, p_location_id: approveLoc, p_user: userName });
    setSaving(false);
    if (error) { toast.error(`Approve failed: ${error.message}`); return; }
    if (data?.status === 'error') {
      toast.error(data.error === 'manager_approval_required'
        ? 'Blocked — this re-send requires manager approval first.'
        : `Approve failed: ${data.error}`);
      return;
    }
    if (data?.missing_skus?.length) toast.warning(`No product for SKU(s): ${data.missing_skus.join(', ')}`);
    if (data?.missing_boms?.length) toast.warning(`No BOM for package(s): ${data.missing_boms.join(', ')}`);
    writeAuditLog({ action: 'approve', entity_type: 'SalesResend', entity_id: rs.id, description: `Approved re-send ${rs.resend_number} — stock deducted` });
    toast.success(`Approved — ${data?.rows_written || 0} item(s) deducted`);
    queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
    queryClient.invalidateQueries({ queryKey: ['sales-resend', resendId] });
  };

  const cancel = async () => {
    const warn = rs.stock_deducted ? 'This re-send is approved — cancelling will ADD the stock back. Continue?' : 'Cancel this re-send?';
    if (!window.confirm(warn)) return;
    setSaving(true);
    const { data, error } = await supabase.rpc('cancel_resend', { p_resend_id: rs.id, p_user: userName });
    setSaving(false);
    if (error) { toast.error(`Cancel failed: ${error.message}`); return; }
    writeAuditLog({ action: 'cancel', entity_type: 'SalesResend', entity_id: rs.id, description: `Cancelled re-send ${rs.resend_number}${rs.stock_deducted ? ' — stock reversed' : ''}` });
    logWorkflowEvent({ entityType: 'sales_resend', entityId: rs.id, eventType: 'resend', actor: userName, description: `Cancelled${rs.stock_deducted ? ' — stock reversed' : ''}` });
    toast.success(rs.stock_deducted ? `Cancelled — ${data?.rows_written || 0} item(s) returned to stock` : 'Cancelled');
    queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
    queryClient.invalidateQueries({ queryKey: ['sales-resend', resendId] });
  };

  const addItem = (p) => {
    setRows(rs2 => [...rs2, { id: crypto.randomUUID(), _new: true, product_id: p.id, sku: p.sku, product_name: p.name, variant_title: null, is_package_parent: false, line_type: 'standalone', qty: 1, unit_price: 0 }]);
    setAddQuery('');
  };

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1000px] mx-auto">
      <button onClick={() => navigate('/sales/resends')} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back to Re-sends
      </button>

      <div className="flex items-start gap-3">
        <Send className="w-6 h-6 text-primary mt-1" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{rs.resend_number}</h1>
            <Badge className={RESEND_STATUS_COLORS[rs.status] || ''}>{RESEND_STATUS_LABELS[rs.status] || rs.status}</Badge>
          </div>
          <div className="text-sm text-muted-foreground mt-0.5">
            {rs.order_number && (
              <>Order {rs.sales_order_id
                ? <Link to={`/sales/orders/${rs.sales_order_id}`} className="text-primary hover:underline">{rs.order_number}</Link>
                : rs.order_number} · </>
            )}{rs.customer_name || '—'}
            {rs.linked_return_id && <> · <Link to={`/sales/returns/${rs.linked_return_id}`} className="text-primary hover:underline">linked return</Link></>}
          </div>
        </div>
      </div>

      {/* Shipping snapshot */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Field label="Email" value={rs.customer_email || '—'} />
        <Field label="Phone" value={rs.customer_phone || '—'} />
        <Field label="City" value={rs.shipping_city || '—'} />
        <Field label="Address" value={rs.customer_address || '—'} />
      </div>

      {/* Reason */}
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Reason {editable && <span className="text-rose-500">*</span>}</label>
          <Select value={form.reason} onValueChange={v => set({ reason: v })} disabled={!editable}>
            <SelectTrigger><SelectValue placeholder="Select reason..." /></SelectTrigger>
            <SelectContent>{RESEND_REASONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {/* Line items */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Items to Re-send</h2>
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground bg-muted/40">
                <th className="text-left px-3 py-2">SKU</th><th className="text-left px-3 py-2">Product</th>
                <th className="px-2 py-2">Qty</th>{editable && <th className="px-2 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground text-xs">No items</td></tr>}
              {rows.map((l, i) => (
                <tr key={l.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2 font-mono text-xs">{l.sku || '—'}{l.is_package_parent && <span className="text-muted-foreground"> · pkg</span>}</td>
                  <td className="px-3 py-2">{l.product_name}{l.variant_title ? <span className="text-muted-foreground"> — {l.variant_title}</span> : ''}</td>
                  <td className="px-2 py-2 text-center">
                    {editable
                      ? <Input type="number" min="0" className="w-16 h-8" value={l.qty} onChange={e => setRows(rs2 => rs2.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
                      : l.qty}
                  </td>
                  {editable && <td className="px-2 py-2 text-center"><button onClick={() => setRows(rs2 => rs2.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4 text-rose-500" /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editable && (
          <div className="relative max-w-sm">
            <Input value={addQuery} onChange={e => setAddQuery(e.target.value)} placeholder="Add item — type a SKU..." className="h-9" />
            {addQuery.trim().length >= 2 && productMatches.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-card border rounded-lg shadow-lg max-h-56 overflow-y-auto">
                {productMatches.map(p => (
                  <button key={p.id} onClick={() => addItem(p)} className="w-full text-left px-3 py-2 hover:bg-muted text-sm flex items-center gap-2">
                    <Plus className="w-3.5 h-3.5 text-muted-foreground" /> <span className="font-mono text-xs">{p.sku}</span> {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Courier (optional) */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><Truck className="w-4 h-4" /> Dispatch / Courier (optional)</h2>
        <div className="grid grid-cols-2 gap-2 max-w-xl">
          <Input placeholder="Courier company" value={form.courier_company} onChange={e => set({ courier_company: e.target.value })} disabled={!canProcess} />
          <Input placeholder="Tracking / reference" value={form.courier_tracking_ref} onChange={e => set({ courier_tracking_ref: e.target.value })} disabled={!canProcess} />
          <Input type="date" value={form.dispatch_date || ''} onChange={e => set({ dispatch_date: e.target.value })} disabled={!canProcess} />
          <Input placeholder="Notes" value={form.courier_notes} onChange={e => set({ courier_notes: e.target.value })} disabled={!canProcess} />
        </div>
      </div>

      {/* Manager approval */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <ShieldAlert className="w-4 h-4" /> Manager Approval
          {rs.manager_approval_required && (
            <Badge className={`text-[10px] ${EXCEPTION_STATUS_COLORS[rs.exception_status] || ''}`}>
              {EXCEPTION_STATUS_LABELS[rs.exception_status] || rs.exception_status}
            </Badge>
          )}
        </h2>
        {editable && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!rs.manager_approval_required} onChange={e => setApprovalRequired(e.target.checked)} />
            This re-send requires manager approval before stock is deducted
          </label>
        )}
        {approvalBlocked && (
          <div className="rounded-lg border border-orange-300 bg-orange-50 p-3 space-y-2">
            <p className="text-sm text-orange-800">Approval required — this re-send cannot be approved (stock deducted) until a manager signs off.</p>
            <Textarea placeholder="Approval / rejection notes..." value={form.exception_notes} onChange={e => set({ exception_notes: e.target.value })} />
            {canApprove ? (
              <div className="flex gap-2">
                <Button onClick={() => resolveApproval('approve')} disabled={saving} className="gap-1.5"><CheckCircle2 className="w-4 h-4" /> Approve</Button>
                <Button variant="outline" onClick={() => resolveApproval('reject')} disabled={saving}>Reject</Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Ask a manager to approve this re-send.</p>
            )}
          </div>
        )}
        {rs.exception_resolved_at && (
          <p className="text-xs text-muted-foreground">
            {rs.exception_status === 'approved' ? 'Approved' : 'Rejected'} by {rs.exception_resolved_by} on {formatDateTimeSAST(rs.exception_resolved_at)}
          </p>
        )}
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Notes</h2>
        <Textarea value={form.notes} onChange={e => set({ notes: e.target.value })} placeholder="Internal notes..." disabled={!canProcess} />
      </div>

      {/* Audit history */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><History className="w-4 h-4" /> Audit History</h2>
        <div className="rounded-lg border bg-card p-3">
          <WorkflowAuditTimeline entityType="sales_resend" entityId={rs.id} />
        </div>
      </div>

      {rs.stock_deducted && rs.deducted_at && (
        <p className="text-xs text-emerald-600">Stock deducted {formatDateTimeSAST(rs.deducted_at)} by {rs.deducted_by || '—'}{rs.deduct_location_id ? ` from ${locations.find(l => l.id === rs.deduct_location_id)?.name || 'location'}` : ''}.</p>
      )}

      {/* Actions */}
      {canProcess && (
        <div className="sticky bottom-0 bg-card border-t -mx-4 md:-mx-6 px-4 md:px-6 py-3 flex flex-wrap items-center justify-end gap-2">
          {editable && <Button variant="outline" onClick={saveDraft} disabled={saving} className="gap-1.5"><Save className="w-4 h-4" /> Save Draft</Button>}
          {editable && (
            <>
              <Select value={approveLoc} onValueChange={setApproveLoc}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Dispatch location..." /></SelectTrigger>
                <SelectContent>{locations.map(loc => <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>)}</SelectContent>
              </Select>
              <Button onClick={approve} disabled={saving} className="gap-1.5"><CheckCircle2 className="w-4 h-4" /> Approve (deduct stock)</Button>
            </>
          )}
          {rs.status === 'approved' && <Button onClick={() => persistHeader({ status: 'picked_packed' }, 'Marked picked/packed', 'pack')} disabled={saving} className="gap-1.5"><PackageCheck className="w-4 h-4" /> Mark Picked/Packed</Button>}
          {rs.status === 'picked_packed' && <Button onClick={() => persistHeader({ status: 'sent', sent_at: new Date().toISOString() }, 'Marked sent', 'send')} disabled={saving} className="gap-1.5"><Send className="w-4 h-4" /> Mark Sent</Button>}
          {rs.status === 'sent' && <Button onClick={() => persistHeader({ status: 'completed', completed_at: new Date().toISOString() }, 'Completed', 'complete')} disabled={saving} className="gap-1.5"><CheckCircle2 className="w-4 h-4" /> Mark Completed</Button>}
          {!['cancelled', 'completed'].includes(rs.status) && <Button variant="outline" onClick={cancel} disabled={saving} className="gap-1.5 text-rose-600"><XCircle className="w-4 h-4" /> Cancel</Button>}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium truncate">{value}</div>
    </div>
  );
}
