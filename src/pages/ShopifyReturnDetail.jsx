import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44, supabase } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ArrowLeft, RotateCcw, Save, CheckCircle2, Truck, Loader2, PackageCheck,
  ShoppingBag, ClipboardList, Boxes, DollarSign, Send, ShieldAlert, FileText, History, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import { writeAuditLog } from '@/lib/auditLog';
import { formatDateTimeSAST } from '@/lib/dateUtils';
import ShopifyReturnReceipt from '@/components/returns/ShopifyReturnReceipt';
import ReturnSection from '@/components/returns/ReturnSection';
import WorkflowAuditTimeline from '@/components/returns/WorkflowAuditTimeline';
import {
  STATUS_LABELS, STATUS_COLORS, COURIER_LABELS, NOT_RECEIVING_REASONS,
  EXCEPTION_STATUS_LABELS, EXCEPTION_STATUS_COLORS, nextAction, refundIsOpen, refundCompleted,
} from '@/lib/shopifyReturns';
import { REFUND_DECISIONS, REFUND_STATUSES } from '@/lib/salesResends';
import { createResendFromOrder } from '@/lib/createResend';
import { logWorkflowEvent } from '@/lib/salesWorkflowEvents';

export default function ShopifyReturnDetail() {
  const { returnId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const canProcess = !!perms.shopify_returns_process || user?.role === 'admin';
  const canApprove = !!perms.returns_manager_approve || user?.role === 'admin';

  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null);

  const { data: ret, isLoading } = useQuery({
    queryKey: ['shopify-return', returnId],
    queryFn: async () => (await base44.entities.ShopifyReturn.filter({ id: returnId }))[0] || null,
    enabled: !!returnId,
  });
  const { data: lines = [] } = useQuery({
    queryKey: ['shopify-return-lines', returnId],
    queryFn: () => base44.entities.ShopifyReturnLine.filter({ return_id: returnId }, '-created_date', 200),
    enabled: !!returnId,
  });

  useEffect(() => {
    if (ret) setForm({
      stock_path: ret.stock_path || 'undecided',
      not_receiving_reason: ret.not_receiving_reason || '',
      courier_responsibility: ret.courier_responsibility || '',
      courier_company: ret.courier_company || '',
      courier_tracking_ref: ret.courier_tracking_ref || '',
      courier_collection_date: ret.courier_collection_date || '',
      courier_notes: ret.courier_notes || '',
      notes: ret.notes || '',
      refund_decision: ret.refund_decision || 'undecided',
      refund_amount: ret.refund_amount || 0,
      refund_status: ret.refund_status || '',
      exception_notes: ret.exception_notes || '',
    });
  }, [ret]);

  if (isLoading || !ret || !form) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  const isDraft = ret.status === 'draft_return';
  const userName = user?.full_name || user?.email || 'system';
  const set = (patch) => setForm(f => ({ ...f, ...patch }));
  const action = nextAction(ret);
  const exceptionPending = ret.exception_status === 'pending';

  const persist = async (patch, successMsg, auditAction, eventType) => {
    setSaving(true);
    await base44.entities.ShopifyReturn.update(ret.id, patch);
    setSaving(false);
    if (auditAction) writeAuditLog({ action: auditAction, entity_type: 'ShopifyReturn', entity_id: ret.id, description: `${auditAction} return ${ret.return_number}` });
    if (eventType) logWorkflowEvent({ entityType: 'shopify_return', entityId: ret.id, eventType, actor: userName, description: successMsg });
    queryClient.invalidateQueries({ queryKey: ['shopify-return', returnId] });
    queryClient.invalidateQueries({ queryKey: ['shopify-returns'] });
    if (successMsg) toast.success(successMsg);
  };

  const saveDraft = () => persist({
    stock_path: form.stock_path,
    not_receiving_reason: form.not_receiving_reason || null,
    courier_responsibility: form.courier_responsibility || null,
    notes: form.notes || null,
  }, 'Draft saved', 'save');

  const approve = () => {
    if (form.stock_path === 'undecided') { toast.error('Choose whether stock is expected back'); return; }
    if (form.stock_path === 'not_receiving') {
      if (!form.not_receiving_reason) { toast.error('Select a reason'); return; }
      persist({
        status: 'not_receiving_stock_back', stock_path: 'not_receiving',
        not_receiving_reason: form.not_receiving_reason, notes: form.notes || null,
        approved_at: new Date().toISOString(), approved_by: userName,
      }, 'Return approved — not receiving stock back', 'approve', 'status');
    } else {
      if (!form.courier_responsibility) { toast.error('Select who books the courier'); return; }
      persist({
        status: 'expected_return', stock_path: 'expecting',
        courier_responsibility: form.courier_responsibility,
        courier_status: form.courier_responsibility === 'us' ? 'to_be_booked' : null,
        notes: form.notes || null,
        approved_at: new Date().toISOString(), approved_by: userName,
      }, 'Return approved — expecting stock back', 'approve', 'status');
    }
  };

  const confirmCourierBooked = () => persist({
    courier_status: 'booked',
    courier_booked_at: new Date().toISOString(),
    courier_booked_by: userName,
    courier_company: form.courier_company || null,
    courier_tracking_ref: form.courier_tracking_ref || null,
    courier_collection_date: form.courier_collection_date || null,
    courier_notes: form.courier_notes || null,
  }, 'Courier booking confirmed', 'courier', 'courier_booked');

  const markCompleted = () => persist({ status: 'completed', completed_at: new Date().toISOString() }, 'Return completed', 'complete', 'status');

  const saveRefund = () => persist({
    refund_decision: form.refund_decision || 'undecided',
    refund_amount: Number(form.refund_amount) || 0,
    refund_status: form.refund_status || null,
    refund_recorded_at: new Date().toISOString(),
    refund_recorded_by: userName,
  }, 'Refund details saved', 'refund', 'refund');

  const completeRefund = () => {
    if (exceptionPending) { toast.error('Refund blocked — manager approval is still pending on this return.'); return; }
    persist({
      refund_status: 'paid',
      refund_completed_at: new Date().toISOString(),
      refund_completed_by: userName,
      refund_amount: Number(form.refund_amount) || ret.refund_amount || 0,
    }, 'Refund marked completed', 'refund', 'refund');
  };

  const resolveException = async (decision) => {
    if (!canApprove) { toast.error('You do not have manager-approval permission'); return; }
    setSaving(true);
    const { error } = await supabase.rpc('resolve_return_exception', {
      p_return_id: ret.id, p_decision: decision, p_user: userName, p_notes: form.exception_notes || null,
    });
    setSaving(false);
    if (error) { toast.error(`Could not resolve: ${error.message}`); return; }
    toast.success(decision === 'approve' ? 'Exception approved' : 'Exception rejected');
    queryClient.invalidateQueries({ queryKey: ['shopify-return', returnId] });
    queryClient.invalidateQueries({ queryKey: ['shopify-returns'] });
  };

  const createLinkedResend = async () => {
    if (exceptionPending) { toast.error('Re-send blocked — manager approval is still pending on this return.'); return; }
    if (!ret.sales_order_id) { toast.error('No linked sales order to re-send against'); return; }
    setSaving(true);
    try {
      const id = await createResendFromOrder(ret.sales_order_id, { returnId: ret.id });
      toast.success('Draft re-send created from return');
      navigate(`/sales/resends/${id}`);
    } catch (e) {
      toast.error(e.message || 'Could not create re-send');
      setSaving(false);
    }
  };

  const showCourier = form.stock_path === 'expecting' || ret.stock_path === 'expecting';
  const showReceipt = ['expected_return', 'partially_received', 'received_pending_qc'].includes(ret.status);
  // Courier-booked gate (Phase 3): our courier must be booked before receiving.
  const courierGateActive = ret.courier_responsibility === 'us'
    && !['booked', 'in_transit', 'collected'].includes(ret.courier_status);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1100px] mx-auto pb-24">
      <button onClick={() => navigate('/sales/returns')} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back to Returns
      </button>

      {/* Header */}
      <div className="flex items-start gap-3">
        <RotateCcw className="w-6 h-6 text-primary mt-1" />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{ret.return_number}</h1>
            <Badge className={`${STATUS_COLORS[ret.status] || ''}`}>{STATUS_LABELS[ret.status] || ret.status}</Badge>
            <Badge variant="outline" className="text-[10px] capitalize">{ret.created_via === 'manual' ? 'manual' : ret.source}</Badge>
            {ret.exception_status && ret.exception_status !== 'none' && (
              <Badge className={`text-[10px] ${EXCEPTION_STATUS_COLORS[ret.exception_status]}`}>
                {EXCEPTION_STATUS_LABELS[ret.exception_status]}
              </Badge>
            )}
          </div>
          <div className="text-sm text-muted-foreground mt-0.5">
            {ret.order_number && (
              <>Order {ret.sales_order_id
                ? <Link to={`/sales/orders/${ret.sales_order_id}`} className="text-primary hover:underline">{ret.order_number}</Link>
                : ret.order_number} · </>
            )}
            {ret.customer_name || '—'}{ret.customer_email ? ` · ${ret.customer_email}` : ''}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Return Value</div>
          <div className="text-xl font-bold">R {(ret.total_return_value || 0).toFixed(2)}</div>
          {(ret.total_write_off_value || 0) > 0 && (
            <div className="text-xs text-rose-600">Write-off: R {ret.total_write_off_value.toFixed(2)}</div>
          )}
        </div>
      </div>

      {/* Next-action banner */}
      {action && (
        <div className={`rounded-xl border p-3 flex items-center gap-3 ${action.blocked ? 'border-orange-300 bg-orange-50' : 'border-primary/40 bg-primary/5'}`}>
          {action.blocked ? <AlertTriangle className="w-5 h-5 text-orange-600" /> : <CheckCircle2 className="w-5 h-5 text-primary" />}
          <div className="flex-1">
            <div className="text-xs text-muted-foreground">Next action</div>
            <div className="font-semibold text-sm">{action.label}</div>
            {action.reason && <div className="text-xs text-orange-700">{action.reason}</div>}
          </div>
        </div>
      )}

      {/* Order Information */}
      <ReturnSection title="Order Information" icon={ShoppingBag}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm pt-2">
          <Field label="Order #" value={ret.order_number || '—'} />
          <Field label="Customer" value={ret.customer_name || '—'} />
          <Field label="Email" value={ret.customer_email || '—'} />
          <Field label="Order Link" value={ret.sales_order_id ? <Link to={`/sales/orders/${ret.sales_order_id}`} className="text-primary hover:underline">Open order</Link> : '—'} />
        </div>
      </ReturnSection>

      {/* Return Information */}
      <ReturnSection title="Return Information" icon={ClipboardList}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm pt-2 mb-3">
          <Field label="Return Date" value={ret.return_date ? formatDateTimeSAST(ret.return_date) : '—'} />
          <Field label="Source" value={ret.created_via === 'manual' ? 'Manual' : (ret.shopify_status || ret.source || '—')} />
          <Field label="Shopify Reason" value={ret.shopify_reason || '—'} />
          <Field label="Reference" value={ret.shopify_reference || ret.shopify_refund_id || ret.shopify_return_id || '—'} />
        </div>
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground bg-muted/40">
                <th className="text-left px-3 py-2">SKU</th>
                <th className="text-left px-3 py-2">Product</th>
                <th className="px-2 py-2">Returned</th>
                <th className="px-2 py-2">Received</th>
                <th className="px-2 py-2">To Stock</th>
                <th className="px-2 py-2">Written Off</th>
                <th className="text-right px-3 py-2">Value</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2 font-mono text-xs">{l.sku || '—'}{!l.product_id && <span className="text-amber-600"> · unmapped</span>}</td>
                  <td className="px-3 py-2">{l.product_name}{l.variant_title ? <span className="text-muted-foreground"> — {l.variant_title}</span> : ''}</td>
                  <td className="px-2 py-2 text-center">{l.qty_returned}</td>
                  <td className="px-2 py-2 text-center">{l.qty_received || '—'}</td>
                  <td className="px-2 py-2 text-center text-emerald-600">{l.qty_to_stock || '—'}</td>
                  <td className="px-2 py-2 text-center text-rose-600">{l.qty_written_off || '—'}</td>
                  <td className="px-3 py-2 text-right">R {(l.return_value || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ReturnSection>

      {/* Stock Expected Back Decision */}
      {(isDraft || ret.stock_path !== 'undecided') && (
        <ReturnSection title="Stock Expected Back Decision" icon={Boxes} highlight={isDraft}
          status={ret.stock_path === 'expecting' ? 'Expecting stock' : ret.stock_path === 'not_receiving' ? 'Not receiving' : 'Undecided'}>
          {isDraft && canProcess ? (
            <div className="pt-2">
              <div className="flex flex-wrap gap-2">
                <PathButton active={form.stock_path === 'not_receiving'} onClick={() => set({ stock_path: 'not_receiving' })}
                  title="Not Receiving Stock Back" desc="Track for reporting / write-off only — no stock returns." />
                <PathButton active={form.stock_path === 'expecting'} onClick={() => set({ stock_path: 'expecting' })}
                  title="Expecting Stock Back" desc="Stock will physically return — courier + receipt + QC." />
              </div>
              {form.stock_path === 'not_receiving' && (
                <div className="mt-3 max-w-sm">
                  <label className="text-xs text-muted-foreground">Reason</label>
                  <Select value={form.not_receiving_reason} onValueChange={v => set({ not_receiving_reason: v })}>
                    <SelectTrigger><SelectValue placeholder="Select reason..." /></SelectTrigger>
                    <SelectContent>
                      {NOT_RECEIVING_REASONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {form.stock_path === 'expecting' && (
                <div className="mt-3">
                  <label className="text-xs text-muted-foreground">Who arranges the courier?</label>
                  <div className="flex gap-2 mt-1">
                    <PathButton small active={form.courier_responsibility === 'us'} onClick={() => set({ courier_responsibility: 'us' })} title="We are booking the courier" />
                    <PathButton small active={form.courier_responsibility === 'customer'} onClick={() => set({ courier_responsibility: 'customer' })} title="Customer is booking their own" />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="pt-2 text-sm">
              {ret.stock_path === 'not_receiving' ? (
                <p>Not receiving stock back — reason: <strong>{NOT_RECEIVING_REASONS.find(r => r.value === ret.not_receiving_reason)?.label || ret.not_receiving_reason || '—'}</strong>. No stock will be added back (reporting only).</p>
              ) : (
                <p>Expecting stock back. Courier: <strong>{ret.courier_responsibility === 'us' ? 'we book' : 'customer books'}</strong>.</p>
              )}
            </div>
          )}
        </ReturnSection>
      )}

      {/* Courier Collection */}
      {showCourier && !isDraft && (
        <ReturnSection title="Courier Collection" icon={Truck}
          status={ret.courier_responsibility === 'customer' ? 'Customer courier' : (COURIER_LABELS[ret.courier_status] || 'To Be Booked')}
          statusClass={ret.courier_status === 'booked' || ret.courier_status === 'in_transit' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}
          highlight={courierGateActive}>
          {ret.courier_responsibility === 'customer' ? (
            <div className="space-y-2 pt-2">
              <p className="text-sm">Customer is arranging their own courier — we are not responsible for booking this collection.</p>
              <Textarea placeholder="Customer courier / tracking / follow-up notes..." value={form.courier_notes} onChange={e => set({ courier_notes: e.target.value })} />
              {canProcess && <Button variant="outline" size="sm" onClick={() => persist({ courier_notes: form.courier_notes || null }, 'Notes saved', null, 'courier_booked')}>Save Notes</Button>}
            </div>
          ) : (
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-2 text-sm">
                <Truck className="w-4 h-4 text-muted-foreground" />
                Courier status:
                <Badge className={ret.courier_status === 'booked' ? 'bg-emerald-100 text-emerald-700' : ret.courier_status === 'in_transit' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}>
                  {COURIER_LABELS[ret.courier_status] || 'To Be Booked'}
                </Badge>
                {ret.courier_booked_at && <span className="text-xs text-muted-foreground">booked {formatDateTimeSAST(ret.courier_booked_at)} by {ret.courier_booked_by}</span>}
              </div>
              {courierGateActive && (
                <p className="text-xs text-orange-700">⚠ This collection still needs to be booked. The return cannot be received until the courier is confirmed booked (or an authorised override is used at receiving).</p>
              )}
              {canProcess && ret.courier_status !== 'booked' && ret.courier_status !== 'in_transit' && (
                <div className="grid grid-cols-2 gap-2 max-w-xl">
                  <Input placeholder="Courier company (optional)" value={form.courier_company} onChange={e => set({ courier_company: e.target.value })} />
                  <Input placeholder="Tracking / reference (optional)" value={form.courier_tracking_ref} onChange={e => set({ courier_tracking_ref: e.target.value })} />
                  <Input type="date" value={form.courier_collection_date || ''} onChange={e => set({ courier_collection_date: e.target.value })} />
                  <Input placeholder="Notes (optional)" value={form.courier_notes} onChange={e => set({ courier_notes: e.target.value })} />
                  <Button className="col-span-2 gap-1.5" onClick={confirmCourierBooked} disabled={saving}>
                    <CheckCircle2 className="w-4 h-4" /> Confirm Courier Booked
                  </Button>
                </div>
              )}
              {canProcess && ret.courier_status === 'booked' && (
                <Button variant="outline" size="sm" onClick={() => persist({ courier_status: 'in_transit' }, 'Marked in transit', null, 'courier_booked')}>Mark Collected / In Transit</Button>
              )}
            </div>
          )}
        </ReturnSection>
      )}

      {/* Warehouse Receiving + Quality Check */}
      {showReceipt && canProcess && (
        <ReturnSection title="Warehouse Receiving & Quality Check" icon={PackageCheck} highlight={!courierGateActive}>
          <div className="pt-2">
            <ShopifyReturnReceipt
              ret={ret}
              lines={lines}
              courierGateActive={courierGateActive}
              canApprove={canApprove}
              userName={userName}
              onDone={() => {
                queryClient.invalidateQueries({ queryKey: ['shopify-return', returnId] });
                queryClient.invalidateQueries({ queryKey: ['shopify-return-lines', returnId] });
                queryClient.invalidateQueries({ queryKey: ['shopify-returns'] });
              }}
            />
          </div>
        </ReturnSection>
      )}

      {/* Exceptions / Manager Approval */}
      {ret.exception_status && ret.exception_status !== 'none' && (
        <ReturnSection title="Exceptions / Manager Approval" icon={ShieldAlert} highlight={exceptionPending}
          status={EXCEPTION_STATUS_LABELS[ret.exception_status]} statusClass={EXCEPTION_STATUS_COLORS[ret.exception_status]}>
          <div className="pt-2 space-y-3 text-sm">
            <p>Reason: <strong>{ret.exception_reason || 'QC flagged a risky outcome'}</strong></p>
            {ret.exception_resolved_at && (
              <p className="text-xs text-muted-foreground">
                {ret.exception_status === 'approved' ? 'Approved' : 'Rejected'} by {ret.exception_resolved_by} on {formatDateTimeSAST(ret.exception_resolved_at)}
              </p>
            )}
            {exceptionPending && (
              <>
                <p className="text-xs text-orange-700">Refunds and re-sends are blocked on this return until a manager approves or rejects the exception.</p>
                <Textarea placeholder="Approval / rejection notes..." value={form.exception_notes} onChange={e => set({ exception_notes: e.target.value })} />
                {canApprove ? (
                  <div className="flex gap-2">
                    <Button onClick={() => resolveException('approve')} disabled={saving} className="gap-1.5"><CheckCircle2 className="w-4 h-4" /> Approve</Button>
                    <Button variant="outline" onClick={() => resolveException('reject')} disabled={saving}>Reject</Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">You do not have manager-approval permission. Ask a manager to resolve this.</p>
                )}
              </>
            )}
          </div>
        </ReturnSection>
      )}

      {/* Refund Decision */}
      <ReturnSection title="Refund Decision" icon={DollarSign}
        status={refundCompleted(ret) ? 'Refund completed' : refundIsOpen(ret) ? 'Refund open' : null}
        statusClass={refundCompleted(ret) ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}>
        <div className="pt-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-w-2xl">
            <div>
              <label className="text-xs text-muted-foreground">Decision</label>
              <Select value={form.refund_decision} onValueChange={v => set({ refund_decision: v })} disabled={!canProcess}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{REFUND_DECISIONS.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Refund amount (R)</label>
              <Input type="number" min="0" step="0.01" value={form.refund_amount} onChange={e => set({ refund_amount: e.target.value })} disabled={!canProcess} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Refund status</label>
              <Select value={form.refund_status} onValueChange={v => set({ refund_status: v })} disabled={!canProcess}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{REFUND_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {canProcess && (
            <div className="flex flex-wrap gap-2 mt-2">
              <Button variant="outline" size="sm" onClick={saveRefund} disabled={saving} className="gap-1.5"><Save className="w-4 h-4" /> Save Refund Details</Button>
              {refundIsOpen(ret) && (
                <Button size="sm" onClick={completeRefund} disabled={saving || exceptionPending} className="gap-1.5"><CheckCircle2 className="w-4 h-4" /> Mark Refund Completed</Button>
              )}
            </div>
          )}
          {ret.refund_completed_at && (
            <p className="text-xs text-emerald-700 mt-1">Refund completed {formatDateTimeSAST(ret.refund_completed_at)} by {ret.refund_completed_by}.</p>
          )}
          <p className="text-xs text-muted-foreground mt-1">Refunds are recorded for tracking only — they never move stock.</p>
        </div>
      </ReturnSection>

      {/* Re-send Decision */}
      <ReturnSection title="Re-send Decision" icon={Send} defaultOpen={false}
        status={ret.linked_resend_id ? 'Re-send linked' : null} statusClass="bg-blue-100 text-blue-700">
        <div className="pt-2 space-y-2">
          <p className="text-sm text-muted-foreground">Ship a replacement against the original order. A re-send deducts stock on approval (separate from the original sale).</p>
          {canProcess && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={createLinkedResend} disabled={saving || exceptionPending} className="gap-1.5"><Send className="w-4 h-4" /> Create Re-send from this return</Button>
              {ret.linked_resend_id && <Link to={`/sales/resends/${ret.linked_resend_id}`} className="text-xs text-primary hover:underline self-center">View linked re-send →</Link>}
            </div>
          )}
          {exceptionPending && <p className="text-xs text-orange-700">Re-send creation is blocked until the manager exception is resolved.</p>}
        </div>
      </ReturnSection>

      {/* Notes */}
      <ReturnSection title="Notes" icon={FileText} defaultOpen={false}>
        <div className="pt-2">
          <Textarea value={form.notes} onChange={e => set({ notes: e.target.value })} placeholder="Internal notes..." disabled={!canProcess} />
          {canProcess && <Button variant="outline" size="sm" className="mt-2" onClick={() => persist({ notes: form.notes || null }, 'Notes saved')} disabled={saving}>Save Notes</Button>}
        </div>
      </ReturnSection>

      {/* Audit History */}
      <ReturnSection title="Audit History" icon={History} defaultOpen={false}>
        <div className="pt-3">
          <WorkflowAuditTimeline entityType="shopify_return" entityId={ret.id} />
        </div>
      </ReturnSection>

      {/* Sticky action bar */}
      {canProcess && (
        <div className="sticky bottom-0 bg-card border-t -mx-4 md:-mx-6 px-4 md:px-6 py-3 flex justify-end gap-2">
          {isDraft && <Button variant="outline" onClick={saveDraft} disabled={saving} className="gap-1.5"><Save className="w-4 h-4" /> Save Draft</Button>}
          {isDraft && <Button onClick={approve} disabled={saving} className="gap-1.5"><CheckCircle2 className="w-4 h-4" /> Approve Return</Button>}
          {ret.status === 'not_receiving_stock_back' && (
            <Button onClick={markCompleted} disabled={saving} className="gap-1.5"><CheckCircle2 className="w-4 h-4" /> Mark Completed (Write-Off)</Button>
          )}
          {!isDraft && !['completed', 'not_receiving_stock_back'].includes(ret.status)
            && ['returned_to_stock', 'written_off', 'partially_returned_partially_written_off'].includes(ret.status)
            && !exceptionPending && (
            <Button onClick={markCompleted} disabled={saving} className="gap-1.5"><PackageCheck className="w-4 h-4" /> Mark Completed</Button>
          )}
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

function PathButton({ active, onClick, title, desc, small }) {
  return (
    <button onClick={onClick}
      className={`text-left rounded-lg border px-3 py-2 transition-colors ${small ? '' : 'flex-1 min-w-[220px]'} ${active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted'}`}>
      <div className="font-medium text-sm">{title}</div>
      {desc && <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>}
    </button>
  );
}
