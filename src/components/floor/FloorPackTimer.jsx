import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Packing timer — shows elapsed time, with Start / Stop controls.
 * Props:
 *  - startedAt: ISO string or null — if set, timer is running from that moment
 *  - onStart(): called when user presses Start
 *  - disabled: boolean
 */
export default function FloorPackTimer({ startedAt, onStart, disabled }) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (startedAt) {
      const start = new Date(startedAt).getTime();
      const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
      tick();
      intervalRef.current = setInterval(tick, 1000);
      return () => clearInterval(intervalRef.current);
    } else {
      setElapsed(0);
      clearInterval(intervalRef.current);
    }
  }, [startedAt]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  if (!startedAt) {
    return (
      <Button
        onClick={onStart}
        disabled={disabled}
        className="w-full h-14 text-base gap-2 bg-blue-600 hover:bg-blue-700 text-white"
      >
        <Play className="w-5 h-5" />
        Start Packing
      </Button>
    );
  }

  return (
    <div className="flex items-center justify-center gap-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-2">
      <Clock className="w-4 h-4 text-blue-600" />
      <span className="text-lg font-bold font-mono text-blue-700 dark:text-blue-300 tabular-nums">{timeStr}</span>
    </div>
  );
}