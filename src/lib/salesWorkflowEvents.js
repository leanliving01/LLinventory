import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';

// Generic per-record audit/timeline for returns, refunds (return lens) and
// re-sends. Mirrors the SalesOrderEvent pattern but spans both entity types.
// RPCs (receive_shopify_return / approve_resend / resolve_return_exception)
// also write rows server-side; this helper covers client-driven state changes.

/**
 * Append a workflow event. Non-fatal — never throws into the calling action.
 * @param {{ entityType: 'shopify_return'|'sales_resend', entityId: string,
 *           eventType: string, description: string, actor?: string, meta?: object }} e
 */
export async function logWorkflowEvent({ entityType, entityId, eventType, description, actor = null, meta = null }) {
  if (!entityType || !entityId) return;
  try {
    await base44.entities.SalesWorkflowEvent.create({
      id: crypto.randomUUID(),
      entity_type: entityType,
      entity_id: entityId,
      event_type: eventType,
      description: description || null,
      actor: actor || null,
      meta: meta || null,
    });
  } catch {
    /* audit logging is best-effort */
  }
}

/** React-Query hook for a record's event timeline (newest first). */
export function useWorkflowEvents(entityType, entityId) {
  return useQuery({
    queryKey: ['workflow-events', entityType, entityId],
    queryFn: () => base44.entities.SalesWorkflowEvent.filter(
      { entity_type: entityType, entity_id: entityId }, '-created_date', 200,
    ),
    enabled: !!entityType && !!entityId,
    staleTime: 15000,
  });
}

export const EVENT_TYPE_LABELS = {
  created: 'Created',
  status: 'Status change',
  courier_booked: 'Courier booked',
  received: 'Received',
  qc: 'Quality check',
  exception: 'Manager exception',
  refund: 'Refund',
  resend: 'Re-send',
};
