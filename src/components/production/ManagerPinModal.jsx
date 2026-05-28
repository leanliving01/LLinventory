import React, { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, ShieldCheck, Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * PIN entry modal for manager approval of production run completion.
 * Step 1: Select manager from list
 * Step 2: Enter 4-digit PIN via large tap targets
 */
export default function ManagerPinModal({ onVerified, onCancel }) {
  const [selectedManager, setSelectedManager] = useState(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const inputRef = useRef(null);

  // Fetch managers (is_manager = true, is_active = true)
  const { data: managers = [], isLoading } = useQuery({
    queryKey: ['active-managers'],
    queryFn: () => base44.entities.TeamMember.filter({ is_manager: true, is_active: true }, 'name', 50),
  });

  // Auto-focus hidden input when manager selected
  useEffect(() => {
    if (selectedManager && inputRef.current) {
      inputRef.current.focus();
    }
  }, [selectedManager]);

  const handleDigit = (digit) => {
    if (pin.length >= 4) return;
    const next = pin + digit;
    setPin(next);
    setError('');
    if (next.length === 4) {
      verifyPin(next);
    }
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
    setError('');
  };

  const verifyPin = async (pinValue) => {
    setVerifying(true);
    setError('');
    const res = await base44.functions.invoke('verifyManagerPin', {
      member_id: selectedManager.id,
      pin: pinValue,
    });
    setVerifying(false);
    if (res.data?.success) {
      onVerified({ manager_name: res.data.manager_name, member_id: res.data.member_id });
    } else {
      setError(res.data?.error || 'Verification failed');
      setPin('');
    }
  };

  // Handle physical keyboard input
  const handleKeyDown = (e) => {
    if (!selectedManager) return;
    if (/^\d$/.test(e.key)) {
      handleDigit(e.key);
    } else if (e.key === 'Backspace') {
      handleBackspace();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onKeyDown={handleKeyDown} tabIndex={0}>
      <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-primary" />
            <div>
              <h3 className="text-lg font-bold">Manager Approval</h3>
              <p className="text-xs text-muted-foreground">A manager must verify to complete this run</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-6">
          {/* Step 1: Select manager */}
          {!selectedManager ? (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Select Manager</p>
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : managers.length === 0 ? (
                <div className="text-center py-8 space-y-2">
                  <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
                  <p className="text-sm text-muted-foreground">No managers set up yet.</p>
                  <p className="text-xs text-muted-foreground">Go to Settings → Team Members and mark someone as a manager with a PIN.</p>
                </div>
              ) : (
                <div className="grid gap-2">
                  {managers.map(m => (
                    <button
                      key={m.id}
                      onClick={() => setSelectedManager(m)}
                      className="flex items-center gap-3 px-4 py-4 rounded-xl border-2 border-border hover:border-primary hover:bg-primary/5 transition-colors text-left active:scale-[0.98]"
                    >
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary">
                        {m.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-sm">{m.name}</p>
                        <p className="text-xs text-muted-foreground">Manager</p>
                      </div>
                      <Badge className="bg-green-100 text-green-700 text-[10px]">PIN set</Badge>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Step 2: Enter PIN */
            (<div className="space-y-4">
              <div className="flex items-center gap-3">
                <button onClick={() => { setSelectedManager(null); setPin(''); setError(''); }} className="text-sm text-primary hover:underline">
                  ← Change
                </button>
                <div className="flex-1 text-center">
                  <p className="text-sm font-semibold">{selectedManager.name}</p>
                  <p className="text-xs text-muted-foreground">Enter your 4-digit PIN</p>
                </div>
                <div className="w-16" />
              </div>
              {/* PIN display dots */}
              <div className="flex justify-center gap-4 py-4">
                {[0, 1, 2, 3].map(i => (
                  <div
                    key={i}
                    className={cn(
                      "w-5 h-5 rounded-full border-2 transition-all",
                      i < pin.length
                        ? "bg-primary border-primary scale-110"
                        : "border-muted-foreground/40"
                    )}
                  />
                ))}
              </div>
              {/* Error */}
              {error && (
                <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-center">
                  <p className="text-sm text-red-600 font-medium">{error}</p>
                </div>
              )}
              {/* Verifying spinner */}
              {verifying && (
                <div className="flex items-center justify-center gap-2 py-2">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">Verifying...</span>
                </div>
              )}
              {/* Number pad — big tap targets for kitchen use */}
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
                  <button
                    key={d}
                    onClick={() => handleDigit(String(d))}
                    disabled={verifying}
                    className="h-16 rounded-xl bg-muted hover:bg-muted/80 active:bg-primary/10 text-xl font-bold transition-colors disabled:opacity-50"
                  >
                    {d}
                  </button>
                ))}
                <div /> {/* empty cell */}
                <button
                  onClick={() => handleDigit('0')}
                  disabled={verifying}
                  className="h-16 rounded-xl bg-muted hover:bg-muted/80 active:bg-primary/10 text-xl font-bold transition-colors disabled:opacity-50"
                >
                  0
                </button>
                <button
                  onClick={handleBackspace}
                  disabled={verifying}
                  className="h-16 rounded-xl bg-muted hover:bg-muted/80 active:bg-red-100 text-sm font-semibold text-muted-foreground transition-colors disabled:opacity-50"
                >
                  ←
                </button>
              </div>
              {/* Hidden input for physical keyboard */}
              <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                className="sr-only"
                value={pin}
                onChange={() => {}}
                autoFocus
              />
            </div>)
          )}
        </div>
      </div>
    </div>
  );
}