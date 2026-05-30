import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Shield, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Reusable manager-PIN confirmation dialog.
 * Props:
 *   action    – short description shown in the dialog, e.g. "delete this GRN"
 *   onConfirmed – called when a valid manager PIN is entered
 *   onCancel  – called when the user dismisses the dialog
 */
export default function ManagerPinDialog({ action = 'proceed', onConfirmed, onCancel }) {
  const [pin, setPin] = useState('');
  const [checking, setChecking] = useState(false);

  const { data: managers = [], isLoading } = useQuery({
    queryKey: ['manager-team-members'],
    queryFn: () => base44.entities.TeamMember.filter({ is_manager: true, is_active: true }, 'name', 50),
  });

  const handleVerify = () => {
    if (!pin.trim()) { toast.error('Enter a manager PIN'); return; }
    setChecking(true);
    const match = managers.find(m => m.manager_pin && m.manager_pin === pin.trim());
    if (match) {
      toast.success(`Approved by ${match.name}`);
      onConfirmed();
    } else {
      toast.error('Incorrect PIN — try again');
      setPin('');
    }
    setChecking(false);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[300]" onClick={onCancel} />
      <div className="fixed inset-0 z-[310] flex items-center justify-center p-4">
        <div className="bg-card rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
            <div className="flex-1">
              <h3 className="font-semibold text-sm">Manager Approval Required</h3>
              <p className="text-xs text-muted-foreground mt-1">Enter a manager PIN to {action}.</p>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onCancel}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : managers.length === 0 ? (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
              No managers with a PIN are configured. Set up manager PINs in Settings → Team.
            </div>
          ) : (
            <Input
              type="password"
              placeholder="••••"
              value={pin}
              onChange={e => setPin(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleVerify()}
              className="text-center tracking-widest text-lg h-12"
              maxLength={10}
              autoFocus
            />
          )}

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
            <Button
              className="flex-1 gap-2"
              onClick={handleVerify}
              disabled={checking || !pin || isLoading || managers.length === 0}
            >
              {checking && <Loader2 className="w-4 h-4 animate-spin" />}
              Confirm
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
