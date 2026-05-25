/**
 * Calculate actual working duration for a task using event logs.
 * Subtracts all paused intervals from total elapsed time.
 * Falls back to started_at → finished_at if no logs exist.
 */
export function getTaskActiveDuration(task, logs = []) {
  if (!task.started_at || !task.finished_at) return 0;

  const startMs = new Date(task.started_at).getTime();
  const endMs = new Date(task.finished_at).getTime();
  const totalMs = endMs - startMs;

  if (!logs.length) return Math.max(0, totalMs);

  // Calculate paused intervals
  let pausedMs = 0;
  let lastPauseAt = null;
  const sorted = [...logs].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  for (const log of sorted) {
    if (log.event_type === 'paused') {
      lastPauseAt = new Date(log.timestamp).getTime();
    } else if (log.event_type === 'resumed' && lastPauseAt) {
      pausedMs += new Date(log.timestamp).getTime() - lastPauseAt;
      lastPauseAt = null;
    }
  }

  return Math.max(0, totalMs - pausedMs);
}

export function formatDurationShort(ms) {
  if (!ms || ms <= 0) return '—';
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function formatDurationLong(ms) {
  if (!ms || ms <= 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}