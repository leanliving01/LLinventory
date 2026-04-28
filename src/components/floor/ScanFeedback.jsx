import React, { useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

/**
 * Global scan feedback — wraps children and provides:
 *  - Green border flash (#a1c848)
 *  - Device vibration
 *  - Beep sound
 *
 * Usage:
 *   const { triggerFeedback, FeedbackWrapper } = useScanFeedback();
 *   // call triggerFeedback('success' | 'error') on scan
 *   // wrap your UI with <FeedbackWrapper>...</FeedbackWrapper>
 */

// Audio context singleton
let audioCtx = null;
function playBeep(success = true) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = success ? 880 : 300;
    osc.type = success ? 'sine' : 'square';
    gain.gain.value = 0.15;
    osc.start();
    osc.stop(audioCtx.currentTime + (success ? 0.12 : 0.25));
  } catch {}
}

function vibrate(success = true) {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(success ? 100 : [100, 50, 100]);
    }
  } catch {}
}

export function useScanFeedback() {
  const [flash, setFlash] = useState(null); // 'success' | 'error' | null
  const timeoutRef = useRef(null);

  const triggerFeedback = useCallback((type = 'success') => {
    const isSuccess = type === 'success';
    playBeep(isSuccess);
    vibrate(isSuccess);
    setFlash(type);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setFlash(null), 500);
  }, []);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  const FeedbackWrapper = useCallback(({ children }) => (
    <div className="relative min-h-screen">
      {/* Flash border overlay */}
      {flash && (
        <div
          className={cn(
            "pointer-events-none fixed inset-0 z-[100] border-[6px] rounded-xl transition-opacity duration-300",
            flash === 'success' ? "border-[#a1c848]" : "border-destructive",
            "animate-pulse"
          )}
          style={{ boxShadow: flash === 'success'
            ? '0 0 30px rgba(161,200,72,0.5), inset 0 0 30px rgba(161,200,72,0.15)'
            : '0 0 30px rgba(220,38,38,0.5), inset 0 0 30px rgba(220,38,38,0.15)'
          }}
        />
      )}
      {children}
    </div>
  ), [flash]);

  return { triggerFeedback, FeedbackWrapper };
}