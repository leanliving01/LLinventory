import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, RotateCcw, Save, CheckCircle2, Truck, Loader2, ExternalLink, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import { writeAuditLog } from '@/lib/auditLog';
import { formatDateTimeSAST } from '@/lib/dateUtils';
import ShopifyReturnReceipt from '@/components/returns/ShopifyReturnReceipt';
import {
  STATUS_LABELS, STATUS_COLORS, COURIER_LABELS, NOT_RECEIVING_REASONS,
} from '@/lib/shopifyReturns';
import { REFUND_DECISIONS, REFUND_STATUSES } from '@/lib/salesResends';
import { createResendFromOrder } from '@/lib/createResend';
import { Send } from 'lucide-react';

export default function ShopifyReturnDetail() {
  const { returnId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const canProcess = !!perms.shopify_returns_process || user?.role === 'admin';

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
    });
  }, [ret]);

  if (isLoading || !ret || !form) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  const isDraft = ret.status === 'draft_return';
  const userName = user?.full_name || user?.email || 'system';
  const set = (patch) => setForm(f => ({ ...f, ...patch }));

  const persist = async (patch, successMsg, audit) => {
    setSaving(true);
    await base44.entities.ShopifyReturn.update(ret.id, patch);
    setSaving(false);
    if (audit) writeAuditLog({ action: audit, entity_type: 'ShopifyReturn', entity_id: ret.id, description: `${audit} return ${ret.return_number}` });
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
      }, 'Return approved — not receiving stock back', 'approve');
    } else {
      if (!form.courier_responsibility) { toast.error('Select who books the courier'); return; }
      persist({
        status: 'expected_return', stock_path: 'expecting',
        courier_responsibility: form.courier_responsibility,
        courier_status: form.courier_responsibility === 'us' ? 'to_be_booked' : null,
        notes: form.notes || null,
        approved_at: new Date().toISOString(), approved_by: userName,
      }, 'Return approved — expecting stock back', 'approve');
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
  }, 'Courier booking confirmed', 'courier');

  const markCompleted = () => persist({ status: 'completed', completed_at: new Date().toISOString() }, 'Return completed', 'complete');

  const saveRefund = () => persist({
    refund_decision: form.refund_decision || 'undecided',
    refund_amount: Number(form.refund_amount) || 0,
    refund_status: form.refund_status || null,
    refund_recorded_at: new Date().toISOString(),
    refund_recorded_by: userName,
  }, 'Refund details saved', 'refund');

  const createLinkedResend = async () => {
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

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1100px] mx-auto">
      <button onClick={() => navigate('/sales/returns')} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back to Returns
      </button>

      {/* Header */}
      <div className="flex items-start gap-3">
        <RotateCcw className="w-6 h-6 text-primary mt-1" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{ret.return_number}</h1>
            <Badge className={`${STATUS_COLORS[ret.status] || ''}`}>{STATUS_LABELS[ret.status] || ret.status}</Badge>
            <Badge variant="outline" className="text-[10px] capitalize">{ret.source}</Badge>
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

      {/* Shopify details */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Field label="Return Date" value={ret.return_date ? formatDateTimeSAST(ret.return_date) : '—'} />
        <Field label="Shopify Status" value={ret.shopify_status || '—'} />
        <Field label="Shopify Reason" value={ret.shopify_reason || '—'} />
        <Field label="Reference" value={ret.shopify_reference || ret.shopify_refund_id || ret.shopify_return_id || '—'} />
      </div>

      {/* Returned line items */}
      <Section title="Returned Items">
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
      </Section>

      {/* Stock path (draft only) */}
      {isDraft && canProcess && (
        <Section title="Stock Decision">
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
        </Section>
      )}

      {/* Not receiving summary (post-approve) */}
      {ret.status === 'not_receiving_stock_back' && (
        <Section title="Not Receiving Stock Back">
          <p className="text-sm">Reason: <strong>{NOT_RECEIVING_REASONS.find(r => r.value === ret.not_receiving_reason)?.label || ret.not_receiving_reason || '—'}</strong></p>
          <p className="text-xs text-muted-foreground mt-1">Recorded for reporting only. No stock was added back. Value locked at R {(ret.total_return_value || 0).toFixed(2)}.</p>
          {canProcess && ret.status !== 'completed' && (
            <Button variant="outline" size="sm" className="mt-2 gap-1.5" onClick={markCompleted}><CheckCircle2 className="w-4 h-4" /> Mark Completed (Write-Off)</Button>
          )}
        </Section>
      )}

      {/* Courier section */}
      {showCourier && !isDraft && (
        <Section title="Courier / Collection">
          {ret.courier_responsibility === 'customer' ? (
            <div className="space-y-2">
              <p className="text-sm">Customer is arranging their own courier.</p>
              <Textarea placeholder="Customer courier / tracking / follow-up notes..." value={form.courier_notes} onChange={e => set({ courier_notes: e.target.value })} />
              {canProcess && <Button variant="outline" size="sm" onClick={() => persist({ courier_notes: form.courier_notes || null }, 'Notes saved')}>Save Notes</Button>}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Truck className="w-4 h-4 text-muted-foreground" />
                Courier status:
                <Badge className={ret.courier_status === 'booked' ? 'bg-emerald-100 text-emerald-700' : ret.courier_status === 'in_transit' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}>
                  {COURIER_LABELS[ret.courier_status] || 'To Be Booked'}
                </Badge>
                {ret.courier_booked_at && <span className="text-xs text-muted-foreground">booked {formatDateTimeSAST(ret.courier_booked_at)} by {ret.courier_booked_by}</span>}
              </div>
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
                <Button variant="outline" size="sm" onClick={() => persist({ courier_status: 'in_transit' }, 'Marked in transit')}>Mark Collected / In Transit</Button>
              )}
            </div>
          )}
        </Section>
      )}

      {/* Receipt + QC */}
      {showReceipt && canProcess && (
        <Section title="Receive & Quality Check">
          <ShopifyReturnReceipt ret={ret} lines={lines} onDone={() => {
            queryClient.invalidateQueries({ queryKey: ['shopify-return', returnId] });
            queryClient.invalidateQueries({ queryKey: ['shopify-return-lines', returnId] });
            queryClient.invalidateQueries({ queryKey: ['shopify-returns'] });
          }} />
        </Section>
      )}

      {/* Refund + replacement */}
      <Section title="Refund & Replacement">
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
            <Button variant="outline" size="sm" onClick={createLinkedResend} disabled={saving} className="gap-1.5"><Send className="w-4 h-4" /> Create Re-send from this return</Button>
            {ret.linked_resend_id && <Link to={`/sales/resends/${ret.linked_resend_id}`} className="text-xs text-primary hover:underline self-center">View linked re-send →</Link>}
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-1">Refunds are recorded for tracking only — they do not move stock. Use a re-send to ship a replacement (deducts stock on approval).</p>
      </Section>

      {/* Notes + actions */}
      <Section title="Notes">
        <Textarea value={form.notes} onChange={e => set({ notes: e.target.value })} placeholder="Internal notes..." disabled={!canProcess} />
      </Section>

      {canProcess && (
        <div className="sticky bottom-0 bg-card border-t -mx-4 md:-mx-6 px-4 md:px-6 py-3 flex justify-end gap-2">
          {isDraft && <Button variant="outline" onClick={saveDraft} disabled={saving} className="gap-1.5"><Save className="w-4 h-4" /> Save Draft</Button>}
          {isDraft && <Button onClick={approve} disabled={saving} className="gap-1.5"><CheckCircle2 className="w-4 h-4" /> Approve Return</Button>}
          {!isDraft && !['completed'].includes(ret.status) && ['returned_to_stock', 'written_off', 'partially_returned_partially_written_off'].includes(ret.status) && (
            <Button onClick={markCompleted} disabled={saving} className="gap-1.5"><PackageCheck className="w-4 h-4" /> Mark Completed</Button>
          )}
          {!isDraft && <Button variant="outline" onClick={() => persist({ notes: form.notes || null }, 'Saved')} disabled={saving}>Save Notes</Button>}
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

function Section({ title, children }) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{title}</h2>
      {children}
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
