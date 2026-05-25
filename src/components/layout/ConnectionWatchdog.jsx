import React, { useEffect, useRef, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { WifiOff, RefreshCw } from 'lucide-react';

const SLOW_THRESHOLD_MS = 20_000;

export default function ConnectionWatchdog() {
  const isFetching = useIsFetching();
  const queryClient = useQueryClient();
  const [showBanner, setShowBanner] = useState(false);
  const fetchStartRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (isFetching > 0) {
      if (!fetchStartRef.current) {
        fetchStartRef.current = Date.now();
        timerRef.current = setTimeout(() => {
          setShowBanner(true);
        }, SLOW_THRESHOLD_MS);
      }
    } else {
      fetchStartRef.current = null;
      clearTimeout(timerRef.current);
      timerRef.current = null;
      setShowBanner(false);
    }
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
