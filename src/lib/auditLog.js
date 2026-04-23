import { base44 } from '@/api/base44Client';

/**
 * Write an audit log entry. Captures current user automatically via created_by.
 * @param {object} params
 * @param {'create'|'update'|'delete'|'sync'|'import'|'finalize'|'export'} params.action
 * @param {string} params.entity_type - e.g. 'ProductionRun', 'StockOnHand'
 * @param {string} [params.entity_id] - ID of affected record
 * @param {string} params.description - human-readable summary
 * @param {*} [params.old_value] - previous state (will be JSON-stringified)
 * @param {*} [params.new_value] - new state (will be JSON-stringified)
 */
export async function writeAuditLog({ action, entity_type, entity_id, description, old_value, new_value }) {
  const entry = {
    action,
    entity_type,
    description,
  };
  if (entity_id) entry.entity_id = entity_id;
  if (old_value !== undefined) entry.old_value = typeof old_value === 'string' ? old_value : JSON.stringify(old_value);
  if (new_value !== undefined) entry.new_value = typeof new_value === 'string' ? new_value : JSON.stringify(new_value);
  
  // Fire-and-forget — don't block the main flow
  base44.entities.AuditLog.create(entry).catch(() => {});
}