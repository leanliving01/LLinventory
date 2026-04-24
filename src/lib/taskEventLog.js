import { base44 } from '@/api/base44Client';

/**
 * Log a task lifecycle event (started, paused, resumed, completed, undone).
 */
export async function logTaskEvent(task, eventType) {
  await base44.entities.ProductionTaskLog.create({
    task_id: task.id,
    run_id: task.run_id,
    event_type: eventType,
    station: task.station,
    task_name: task.meal_name || task.name,
    assigned_name: task.assigned_name || '',
    timestamp: new Date().toISOString(),
  });
}