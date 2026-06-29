import React, { useEffect, useRef, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { WifiOff, RefreshCw } from 'lucide-react';

const SLOW_THRESHOLD_MS = 20_000;

export default function ConnectionWatchdog() {
  const isFetching = useIsFetching();
  const queryClient = useQueryClient();
  const [showBanner, setShowBanner] = useState(false);
  // useIsFetching() is an app-wide count of in-flight queries. The banner must
  // only fire on a genuine STALL — not just because the count stayed above 0
  // for a while. On a slow link a page can fire several queries that each take
  // a few seconds; they complete one by one (the count keeps dropping) but the
  // count rarely hits exactly 0, so a "fetching > 0 for 20s" rule would false-
  // alarm even though data is arriving fine. Instead we track the last time a
  // query COMPLETED (the count decreased) or everything settled, and only warn
  // when there's been no such progress for SLOW_THRESHOLD_MS.
  const prevCountRef = useRef(0);
  const lastProgressRef = useRef(Date.now());
  const timerRef = useRef(null);

  useEffect(() => {
    const prev = prevCountRef.current;
    prevCountRef.current = isFetching;

    if (isFetching === 0) {
      // Everything settled — clear the warning and reset the stall clock.
      clearTimeout(timerRef.current);
      timerRef.current = null;
      lastProgressRef.current = Date.now();
      setShowBanner(false);
      return;
    }

    // A query just finished (count dropped) — that's progress, so the
    // connection is working. Restart the stall clock and hide any warning.
    if (isFetching < prev) {
      lastProgressRef.current = Date.now();
      setShowBanner(false);
    }

    // (Re)arm a single timer to fire once we've gone SLOW_THRESHOLD_MS with no
    // progress at all — i.e. queries are stuck, not merely slow.
    clearTimeout(timerRef.current);
    const remaining = Math.max(0, SLOW_THRESHOLD_MS - (Date.now() - lastProgressRef.current));
    timerRef.current = setTimeout(() => setShowBanner(true), remaining);
    return () => {};
  }, [isFetching]);

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-destructive text-destructive-foreground px-4 py-3 rounded-xl shadow-lg text-sm font-medium">
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>Connection is slow — data may not have loaded</span>
      <button
        onClick={() => {
          setShowBanner(false);
          queryClient.refetchQueries({ type: 'active' });
        }}
        className="flex items-center gap-1 underline underline-offset-2 hover:opacity-80"
      >
        <RefreshCw className="w-3.5 h-3.5" /> Retry
      </button>
    </div>
  );
}
