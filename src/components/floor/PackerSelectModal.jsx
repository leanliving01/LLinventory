import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, UserCircle, Delete, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/**
 * Full-screen modal for selecting which packer is working.
 *
 * Lists active Production Team members assigned the "Dispatch" station (independent of who
 * is signed in on the tablet). After picking a name, the packer must enter their 4-digit
 * PIN (set by a manager in Settings → Production Team) so nobody packs under another name.
 *
 * Props:
 *  - onSelect(member) — called with the TeamMember { id, name } once the PIN is verified
 */
function PinPad({ name, onComplete, onBack }) {
  const [entry, setEntry] = useState('');

  const press = useCallback((d) => setEntry(p => (p.length >= 4 ? p : p + d)), []);
  const back = useCallback(() => setEntry(p => p.slice(0, -1)), []);

  // Auto-submit on the 4th digit, then clear so it's ready for a retry.
  useEffect(() => {
    if (entry.length === 4) {
      const pin = entry;
      setEntry('');
      onComplete(pin);
    }
  }, [entry, onComplete]);

  useEffect(() => {
    const handler = (e) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [press, back]);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <button onClick={onBack} className="absolute left-0 top-0 p-1 text-muted-foreground"><ArrowLeft className="w-5 h-5" /></button>
        <UserCircle className="w-12 h-12 text-primary mx-auto mb-2" />
        <h1 className="text-xl font-bold">{name}</h1>
        <p className="text-sm text-muted-foreground mt-1">Enter your 4-digit PIN</p>
      </div>

      {/* Dots */}
      <div className="flex justify-center gap-3">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`w-4 h-4 rounded-full border-2 ${i < entry.length ? 'bg-primary border-primary' : 'border-muted-foreground/40'}`} />
        ))}
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
          <button
            key={d}
            onClick={() => press(String(d))}
            className="h-16 rounded-2xl border-2 border-border bg-card text-2xl font-bold active:scale-95 active:bg-muted transition-transform"
          >
            {d}
          </button>
        ))}
        <div />
        <button onClick={() => press('0')} className="h-16 rounded-2xl border-2 border-border bg-card text-2xl font-bold active:scale-95 active:bg-muted transition-transform">0</button>
        <button onClick={back} className="h-16 rounded-2xl flex items-center justify-center text-muted-foreground active:scale-95 transition-transform"><Delete className="w-6 h-6" /></button>
      </div>
    </div>
  );
}

export default function PackerSelectModal({ onSelect }) {
  const [pinFor, setPinFor] = useState(null);

  const { data: allMembers = [], isLoading } = useQuery({
    queryKey: ['production-team'],
    queryFn: () => base44.entities.TeamMember.list('name', 200),
  });

  const packers = useMemo(() => allMembers.filter(m => {
    if (m.is_active === false) return false;
    const stations = Array.isArray(m.stations) && m.stations.length > 0
      ? m.stations
      : (m.station ? [m.station] : []);
    return stations.includes('dispatch');
  }), [allMembers]);

  const handleName = (m) => {
    if (!m.pin) {
      toast.error(`${m.name} has no packing PIN — ask a manager to set it in Settings → Production Team.`);
      return;
    }
    setPinFor(m);
  };

  const handlePinComplete = useCallback((entry) => {
    setPinFor(prev => {
      if (prev && entry === prev.pin) {
        onSelect(prev);
        return prev;
      }
      toast.error('Incorrect PIN — try again');
      return prev;
    });
  }, [onSelect]);

  if (pinFor) {
    return (
      <div className="relative">
        <PinPad name={pinFor.name} onComplete={handlePinComplete} onBack={() => setPinFor(null)} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="text-center">
        <UserCircle className="w-12 h-12 text-primary mx-auto mb-2" />
        <h1 className="text-xl font-bold">Who is packing?</h1>
        <p className="text-sm text-muted-foreground mt-1">Select your name, then enter your PIN</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading team...
        </div>
      ) : packers.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">No dispatch team members.</p>
          <p className="text-xs text-muted-foreground mt-1">Assign the <strong>Dispatch</strong> station to a team member in Settings → Production Team.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {packers.map(m => (
            <button
              key={m.id}
              onClick={() => handleName(m)}
              className="bg-card border-2 border-border rounded-2xl p-5 flex flex-col items-center gap-2 active:scale-[0.96] transition-transform hover:border-primary/50"
            >
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-xl font-bold text-primary">{(m.name || '?').charAt(0).toUpperCase()}</span>
              </div>
              <p className="font-semibold text-sm">{m.name}</p>
              {!m.pin && <span className="text-[10px] text-amber-600">no PIN set</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
