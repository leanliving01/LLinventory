import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useId,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Loader2, Save, AlertTriangle } from 'lucide-react';

/**
 * App-wide "unsaved changes" guard.
 *
 * Standard SaaS behaviour: if the user has started editing something and tries
 * to leave the screen — via the sidebar, an in-page link, the browser/hardware
 * back button, a tab close, or a refresh — we intercept and ask them to confirm
 * before their work is lost.
 *
 * This app uses React Router's classic <BrowserRouter> (not a data router), so
 * `useBlocker` is unavailable. Instead a single provider (mounted inside the
 * Router) registers global interceptors and exposes a `useUnsavedChanges` hook
 * that each editing screen calls with its own "dirty" flag.
 *
 * Vectors covered centrally:
 *   1. Tab close / refresh / closing the app  → `beforeunload`
 *   2. Sidebar + in-page <a>/<Link> clicks     → capturing click interceptor
 *   3. Browser / Android hardware back button  → history sentinel + popstate
 *   4. Programmatic navigation (buttons, command palette) → useGuardedNavigate
 */

const NavigationGuardContext = createContext(null);

const DEFAULT_MESSAGE =
  'You have unsaved changes that will be lost if you leave this page.';

export function NavigationGuardProvider({ children }) {
  const navigate = useNavigate();
  // id -> { message, onSave } for every editor currently reporting unsaved work
  const guards = useRef(new Map());
  const [dirtyCount, setDirtyCount] = useState(0);
  // Pending intercepted navigation: { type: 'link'|'back'|'fn', to?, run? }
  const [pending, setPending] = useState(null);
  const [saving, setSaving] = useState(false);
  // When we deliberately let one navigation through, skip our own interceptors.
  const bypassRef = useRef(false);
  // True while the back-button confirmation dialog is open (ignore extra backs).
  const backPromptOpenRef = useRef(false);

  const sync = useCallback(() => setDirtyCount(guards.current.size), []);

  const register = useCallback((id, info) => {
    guards.current.set(id, info);
    sync();
  }, [sync]);

  const unregister = useCallback((id) => {
    if (guards.current.delete(id)) sync();
  }, [sync]);

  const isDirty = useCallback(() => guards.current.size > 0, []);

  // The "active" editor = the most recently registered one (the top-most form).
  // Its message + onSave drive the confirmation dialog.
  const activeGuard = useCallback(() => {
    let last = null;
    for (const v of guards.current.values()) last = v;
    return last;
  }, []);

  const dirty = dirtyCount > 0;

  // ── 1. Tab close / refresh / app close ───────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (isDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // ── 2. In-app link clicks (sidebar, breadcrumbs, in-page links) ──────────
  // Capturing listener runs before React Router's <Link> onClick, so we can
  // cancel the navigation and prompt instead.
  useEffect(() => {
    const onClick = (e) => {
      if (!isDirty()) return;
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const anchor = e.target?.closest?.('a[href]');
      if (!anchor) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download') || anchor.hasAttribute('data-allow-unsaved'))
        return;
      let url;
      try {
        url = new URL(anchor.href, window.location.origin);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return; // external / mailto / tel
      // Compare on path+query only — a pure "#" / hash-only anchor (dropdowns,
      // in-page jumps) is not a route change and must not be intercepted.
      const to = url.pathname + url.search;
      const current = window.location.pathname + window.location.search;
      if (to === current) return; // same route
      e.preventDefault();
      e.stopPropagation();
      setPending({ type: 'link', to: to + url.hash });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [isDirty]);

  // ── 3. Browser / hardware back button ────────────────────────────────────
  // Single-sentinel trap. On entering a dirty state we push ONE history entry
  // (same URL) on top of the editor. A back press pops that sentinel — leaving
  // us sitting on the editor entry — and we prompt. "Stay" re-pushes the
  // sentinel; "Leave" steps back once more to the page before the editor.
  // Depend on the boolean `dirty` so the sentinel is pushed once per session.
  useEffect(() => {
    if (!dirty) return;
    // Clear any leftover bypass so the first back press of this session prompts.
    bypassRef.current = false;
    window.history.pushState({ __navGuardSentinel: true }, '', window.location.href);
    const onPop = () => {
      if (bypassRef.current) {
        bypassRef.current = false;
        return;
      }
      if (!isDirty()) return;
      // Ignore extra back presses while the prompt is already open.
      if (backPromptOpenRef.current) {
        // Re-trap so we don't fall through to the previous page.
        window.history.pushState({ __navGuardSentinel: true }, '', window.location.href);
        return;
      }
      backPromptOpenRef.current = true;
      setPending({ type: 'back' });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [dirty, isDirty]);

  const closeDialog = useCallback(() => {
    // "Stay" after a back press: re-trap, because the back already popped the
    // sentinel and left us on the editor entry.
    if (pending?.type === 'back') {
      backPromptOpenRef.current = false;
      window.history.pushState({ __navGuardSentinel: true }, '', window.location.href);
    }
    setPending(null);
  }, [pending]);

  // Let the pending navigation through. We do NOT clear the whole guard
  // registry — the editor that actually leaves will unmount and unregister
  // itself, so any OTHER mounted editor stays protected.
  const proceed = useCallback(() => {
    const p = pending;
    setPending(null);
    if (!p) return;
    if (p.type === 'link' && p.to) {
      // `replace` consumes the back-button sentinel so history stays clean.
      navigate(p.to, { replace: true });
    } else if (p.type === 'back') {
      backPromptOpenRef.current = false;
      bypassRef.current = true;
      // The back press already popped the sentinel; one more step reaches the
      // page before the editor.
      window.history.go(-1);
    } else if (p.type === 'fn' && typeof p.run === 'function') {
      p.run();
    }
  }, [pending, navigate]);

  const saveAndLeave = useCallback(async () => {
    const g = activeGuard();
    if (!g?.onSave) {
      proceed();
      return;
    }
    setSaving(true);
    try {
      const result = await g.onSave();
      // onSave may return false to signal validation failure / abort.
      if (result === false) {
        setSaving(false);
        return;
      }
      setSaving(false);
      proceed();
    } catch {
      // Leave the dialog open — the page's onSave is expected to surface its
      // own error toast.
      setSaving(false);
    }
  }, [activeGuard, proceed]);

  // Programmatic guarded navigation for buttons, the command palette, etc.
  const requestNavigation = useCallback((to) => {
    if (isDirty()) setPending({ type: 'link', to });
    else navigate(to);
  }, [isDirty, navigate]);

  // Guarded arbitrary action (e.g. logout) — runs `fn` unless dirty.
  const requestAction = useCallback((fn) => {
    if (isDirty()) setPending({ type: 'fn', run: fn });
    else fn();
  }, [isDirty]);

  const ctxValue = {
    register,
    unregister,
    isDirty,
    requestNavigation,
    requestAction,
  };

  const dialogGuard = pending ? activeGuard() : null;
  const canSave = !!dialogGuard?.onSave;

  return (
    <NavigationGuardContext.Provider value={ctxValue}>
      {children}
      {pending && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl border border-border w-full max-w-sm shadow-xl">
            <div className="px-6 py-5 flex gap-3">
              <div className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-500/15 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold mb-1">Unsaved changes</h3>
                <p className="text-sm text-muted-foreground">
                  {dialogGuard?.message || DEFAULT_MESSAGE}
                </p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex flex-col gap-2">
              {canSave && (
                <Button className="gap-2" disabled={saving} onClick={saveAndLeave}>
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save &amp; leave
                </Button>
              )}
              <Button
                variant={canSave ? 'outline' : 'default'}
                className={canSave ? 'text-destructive hover:text-destructive' : ''}
                disabled={saving}
                onClick={proceed}
              >
                Leave without saving
              </Button>
              <Button variant="ghost" disabled={saving} onClick={closeDialog}>
                Stay on page
              </Button>
            </div>
          </div>
        </div>
      )}
    </NavigationGuardContext.Provider>
  );
}

/**
 * Register the current screen's unsaved-changes state with the global guard.
 *
 * @param {boolean} when    True while the screen has unsaved edits.
 * @param {object}  options
 * @param {string}  options.message  Custom prompt text.
 * @param {() => (boolean|void|Promise<boolean|void>)} options.onSave
 *        Optional save handler. When provided, the dialog offers "Save & leave".
 *        Return false to signal the save failed (keeps the dialog open).
 */
export function useUnsavedChanges(when, options = {}) {
  const ctx = useContext(NavigationGuardContext);
  const id = useId();
  const { message } = options;
  const onSaveRef = useRef(options.onSave);
  onSaveRef.current = options.onSave;

  useEffect(() => {
    if (!ctx) return undefined;
    if (when) {
      ctx.register(id, {
        message,
        onSave: onSaveRef.current ? () => onSaveRef.current() : undefined,
      });
    } else {
      ctx.unregister(id);
    }
    return undefined;
  }, [ctx, id, when, message]);

  // Always release on unmount.
  useEffect(() => () => ctx?.unregister(id), [ctx, id]);
}

/**
 * Navigate, but route through the unsaved-changes guard first. Use for
 * programmatic navigation (back/cancel buttons, command palette, etc.).
 */
export function useGuardedNavigate() {
  const ctx = useContext(NavigationGuardContext);
  const navigate = useNavigate();
  return useCallback(
    (to) => {
      if (ctx) ctx.requestNavigation(to);
      else navigate(to);
    },
    [ctx, navigate],
  );
}

/** Run an action, but route through the unsaved-changes guard first. */
export function useGuardedAction() {
  const ctx = useContext(NavigationGuardContext);
  return useCallback(
    (fn) => {
      if (ctx) ctx.requestAction(fn);
      else fn();
    },
    [ctx],
  );
}
