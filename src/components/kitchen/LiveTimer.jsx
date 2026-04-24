import { useState, useEffect } from 'react';

/**
 * Formats milliseconds → HH:MM:SS string.
 */
export function formatDuration(ms) {
  if (!ms || ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Shared LiveTimer that correctly handles pauses.
 *
 * Props:
 *  - startedAt: ISO string of when the task was started
 *  - taskId: used to query pause/resume logs for accurate elapsed time
 *  - isActive: true only when task status === 'in_progress'
 *  - logs: optional array of ProductionTaskLog entries for this task (to calculate paused time)
 *  - className: optional
 */
export default function LiveTimer({ startedAt, isActive, logs = [], className = '' }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!isActive || !startedAt) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isActive, startedAt]);

  if (!startedAt) return <span className={className}>00:00:00</span>;

  // Calculate total paused time from logs
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

  // If currently paused, add time from last pause to now
  if (lastPauseAt && !isActive) {
    pausedMs += Date.now() - lastPauseAt;
  }

  const startMs = new Date(startedAt).getTime();
  const currentMs = isActive ? now : (lastPauseAt || now);
  const elapsed = Math.max(0, currentMs - startMs - pausedMs);

  return <span className={className}>{formatDuration(elapsed)}</span>;
}