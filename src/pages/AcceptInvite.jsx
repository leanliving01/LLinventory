import React, { useEffect, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, ShieldCheck, KeyRound, AlertTriangle } from 'lucide-react';

/**
 * Landing page for Supabase invite / password-recovery links.
 *
 * When a worker clicks the invite email, Supabase verifies the token and
 * redirects here with the session tokens in the URL hash. supabase-js
 * (detectSessionInUrl, on by default) consumes those and fires SIGNED_IN /
 * PASSWORD_RECOVERY — at which point the user has a session but no password yet.
 * They set one here via supabase.auth.updateUser, then land in the app with the
 * role & permissions the admin assigned at invite time.
 *
 * Mounted OUTSIDE the normal auth gate (see App.jsx) so it renders whether or
 * not a session already exists.
 */
export default function AcceptInvite() {
  const [phase, setPhase] = useState('checking'); // checking | ready | invalid | saving | done
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let done = false;

    // If a session is already established (hash consumed before mount), use it.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (done) return;
      if (session) {
        setEmail(session.user?.email || '');
        setPhase('ready');
      }
    });

    // Otherwise wait for supabase-js to parse the invite tokens from the URL.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (done) return;
      if ((event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY' || event === 'INITIAL_SESSION') && session) {
        setEmail(session.user?.email || '');
        setPhase('ready');
      }
    });

    // Give the token exchange a few seconds; if nothing arrives the link is bad/expired.
    const timer = setTimeout(() => {
      if (done) return;
      setPhase(prev => (prev === 'checking' ? 'invalid' : prev));
    }, 6000);

    return () => { done = true; subscription.unsubscribe(); clearTimeout(timer); };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }

    setPhase('saving');
    const { error: updErr } = await supabase.auth.updateUser({ password });
    if (updErr) {
      setError(updErr.message || 'Could not set your password. Try the link again.');
      setPhase('ready');
      return;
    }
    setPhase('done');
    // Land in the app — AuthContext will pick up the session + assigned role.
    setTimeout(() => { window.location.href = '/'; }, 1200);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center gap-2">
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center">
            <span className="text-2xl font-black text-primary-foreground">LL</span>
          </div>
          <h1 className="text-xl font-bold mt-2">Welcome to Lean Living</h1>
          <p className="text-sm text-muted-foreground">Set a password to activate your account.</p>
        </div>

        {phase === 'checking' && (
          <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-sm">Verifying your invitation…</p>
          </div>
        )}

        {phase === 'invalid' && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-center space-y-2">
            <AlertTriangle className="w-8 h-8 text-destructive mx-auto" />
            <h2 className="text-sm font-semibold">This invite link is invalid or expired</h2>
            <p className="text-xs text-muted-foreground">
              Ask your admin to resend the invitation from Settings → Users, then click the newest email link.
            </p>
            <Button variant="outline" size="sm" onClick={() => (window.location.href = '/login')} className="mt-2">
              Go to sign in
            </Button>
          </div>
        )}

        {(phase === 'ready' || phase === 'saving') && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {email && (
              <div className="text-center text-xs text-muted-foreground">
                Signing in as <span className="font-medium text-foreground">{email}</span>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5" /> New password
              </label>
              <Input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoFocus
                disabled={phase === 'saving'}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Confirm password</label>
              <Input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Re-enter password"
                disabled={phase === 'saving'}
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button type="submit" className="w-full gap-2" disabled={phase === 'saving'}>
              {phase === 'saving' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Set password & continue
            </Button>
          </form>
        )}

        {phase === 'done' && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <ShieldCheck className="w-10 h-10 text-green-600" />
            <p className="text-sm font-medium">Password set — taking you in…</p>
          </div>
        )}
      </div>
    </div>
  );
}
