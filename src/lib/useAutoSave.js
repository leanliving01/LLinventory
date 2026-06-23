import { useCallback, useEffect, useRef, useState } from 'react';

// Debounced auto-save.
//
// Call `trigger()` whenever the data changes; the save runs `delay` ms after the
// LAST change (so rapid typing collapses into one write). `flush()` saves
// immediately and is fired on tab-hide / page-unload / unmount so nothing typed
// is lost if the user navigates away or the connection drops. `cancel()` drops a
// pending save (use before a manual save / submit so they don't race).
//
// status: 'idle' | 'unsaved' | 'saving' | 'saved' | 'error'
export function useAutoSave(saveFn, { delay = 2500 } = {}) {
  const [status, setStatus] = useState('idle');
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const timer = useRef(null);
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const saveFnRef = useRef(saveFn);
  saveFnRef.current = saveFn; // always call the freshest closure (latest counts)

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!dirty.current || inFlight.current) return;
    dirty.current = false;
    inFlight.current = true;
    setStatus('saving');
    try {
      await saveFnRef.current();
      setStatus('saved');
      setLastSavedAt(Date.now());
    } catch {
      dirty.current = true; // keep dirty so the next change (or flush) retries
      setStatus('error');
    } finally {
      inFlight.current = false;
    }
  }, []);

  const trigger = useCallback(() => {
    dirty.current = true;
    setStatus(s => (s === 'saving' ? s : 'unsaved'));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  }, [delay, flush]);

  const cancel = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    dirty.current = false;
  }, []);

  // A manual save handled the persistence — reflect it in the indicator.
  const markSaved = useCallback(() => {
    dirty.current = false;
    setStatus('saved');
    setLastSavedAt(Date.now());
  }, []);

  // Best-effort save when the tab is hidden, the page is closing, or the
  // component unmounts (e.g. the user navigates back).
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  return { status, lastSavedAt, trigger, flush, cancel, markSaved };
}
