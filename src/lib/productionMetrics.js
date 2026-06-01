import { getTaskActiveDuration } from '@/lib/taskDuration';

/**
 * Per-member production stats (cook/prep/portion), mirroring the Team Performance
 * calculations so the combined employee report matches that report exactly.
 * Pure (no I/O).
 */
export function computeMemberProductionStats(memberId, tasks = [], logsByTask = {}) {
  const done = tasks
    .filter(t => t.assigned_to === memberId && t.status === 'done' && t.started_at && t.finished_at)
    .map(t => ({ ...t, activeDuration: getTaskActiveDuration(t, logsByTask[t.id] || []) }))
    .sort((a, b) => new Date(b.finished_at) - new Date(a.finished_at));

  const durations = done.map(t => t.activeDuration);
  const count = done.length;
  const totalSec = durations.reduce((s, d) => s + d, 0);

  const byStation = {};
  done.forEach(t => {
    const st = t.station || 'other';
    if (!byStation[st]) byStation[st] = { count: 0, totalSec: 0 };
    byStation[st].count += 1;
    byStation[st].totalSec += t.activeDuration;
  });

  return {
    tasksCompleted: count,
    totalSec,
    avgSec: count > 0 ? totalSec / count : 0,
    minSec: count > 0 ? Math.min(...durations) : 0,
    maxSec: count > 0 ? Math.max(...durations) : 0,
    byStation,
    tasks: done,
  };
}
