import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Packing timer with pause/resume.
 * Tracks actual packing time (excludes paused time).
 *
 * Props:
 *  - startedAt: ISO string or null — if set, packing session has begun
 *  - onStart(): called when user presses Start
 *  - onPause(): called when user pauses
 *  - onResume(): called when user resumes
 *  - isPaused: boolean
 *  - accumulatedSeconds: number — seconds already accumulated from previous segments
 *  - disabled: boolean
 */
export default function FloorPackTimer({ startedAt, onStart, onPause, onResume, isPaused, accumulatedSeconds = 0, disabled }) {
  const [displaySeconds, setDisplaySeconds] = useState(0);
  const intervalRef = useRef(null);
  const segmentStartRef = useRef(null);

  // Track accumulated separately so interval closure always reads latest value
  const accRef = useRef(accumulatedSeconds);
  useEffect(() => { accRef.current = accumulatedSeconds; }, [accumulatedSeconds]);

  useEffect(() => {
    clearInterval(intervalRef.current);

    if (!startedAt) {
      setDisplaySeconds(0);
      segmentStartRef.current = null;
      return;
    }

    if (isPaused) {
      // Show accumulated time frozen
      setDisplaySeconds(accumulatedSeconds);
      segmentStartRef.current = null;
      return;
    }

    // Running — only reset segment start if not already tracking
    // This prevents the timer from resetting on re-renders
    if (!segmentStartRef.current) {
      segmentStartRef.current = Date.now();
    }
    const tick = () => {
      const segmentElapsed = Math.floor((Date.now() - segmentStartRef.current) / 1000);
      setDisplaySeconds(accRef.current + segmentElapsed);
    };
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => clearInterval(intervalRef.current);
  }, [startedAt, isPaused]);

  const mins = Math.floor(displaySeconds / 60);
  const secs = displaySeconds % 60;
  const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  // Not started yet
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
    <div className="flex items-center gap-3">
      {/* Timer display */}
      <div className="flex-1 flex items-center justify-center gap-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-2">
        <Clock className="w-4 h-4 text-blue-600" />
        <span className="text-lg font-bold font-mono text-blue-700 dark:text-blue-300 tabular-nums">{timeStr}</span>
        {isPaused && (
          <span className="text-xs font-medium text-orange-600 dark:text-orange-400 ml-1">PAUSED</span>
        )}
      </div>

      {/* Pause / Resume button */}
      {isPaused ? (
        <Button
          onClick={onResume}
          className="h-11 gap-2 bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Play className="w-4 h-4" /> Resume
        </Button>
      ) : (
        <Button
          onClick={onPause}
          variant="outline"
          className="h-11 gap-2 border-orange-300 text-orange-700 hover:bg-orange-50"
        >
          <Pause className="w-4 h-4" /> Pause
        </Button>
      )}
    </div>
  );
}