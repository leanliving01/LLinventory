// Shared labels, colours, and reason options for the Re-sends module.

export const RESEND_STATUS_LABELS = {
  draft: 'Draft',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  picked_packed: 'Picked / Packed',
  sent: 'Sent',
  cancelled: 'Cancelled',
  completed: 'Completed',
};

export const RESEND_STATUS_COLORS = {
  draft: 'bg-slate-100 text-slate-700',
  pending_approval: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  picked_packed: 'bg-indigo-100 text-indigo-700',
  sent: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-rose-100 text-rose-700',
  completed: 'bg-green-100 text-green-700',
};

export const RESEND_REASONS = [
  { value: 'incorrect_item', label: 'Incorrect item packed' },
  { value: 'missing_item', label: 'Missing item from order' },
  { value: 'damaged_item', label: 'Damaged item received' },
  { value: 'wrong_order', label: 'Customer received wrong order' },
  { value: 'quality_issue', label: 'Quality issue' },
  { value: 'replacement_after_return', label: 'Replacement after return' },
  { value: 'replacement_without_return', label: 'Replacement without return' },
  { value: 'goodwill', label: 'Goodwill resend' },
  { value: 'other', label: 'Other' },
];

export const REFUND_DECISIONS = [
  { value: 'undecided', label: 'Undecided' },
  { value: 'refund', label: 'Refund only' },
  { value: 'resend', label: 'Resend / replacement only' },
  { value: 'both', label: 'Refund + Resend' },
  { value: 'none', label: 'No refund' },
];

export const REFUND_STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'paid', label: 'Paid' },
  { value: 'rejected', label: 'Rejected' },
];

export function reasonLabel(value) {
  return RESEND_REASONS.find(r => r.value === value)?.label || value || '—';
}

// Dashboard queue membership for re-sends (Phase 4).
export function resendMatchesQueue(rs, queue) {
  switch (queue) {
    case 'resend_awaiting_decision':
      // Draft or pending approval — still needs a confirm/approve decision.
      return ['draft', 'pending_approval'].includes(rs.status)
        || (rs.manager_approval_required && rs.exception_status !== 'approved' && rs.status !== 'cancelled');
    case 'resend_to_pack':
      // Approved (stock deducted) but not yet sent — needs picking/packing/dispatch.
      return ['approved', 'picked_packed'].includes(rs.status);
    case 'resend_sent':
      return rs.status === 'sent';
    case 'resend_completed':
      return rs.status === 'completed';
    case 'resend_all':
      return true;
    default:
      return rs.status === queue;
  }
}
