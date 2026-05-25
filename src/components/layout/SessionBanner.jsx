import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { WifiOff, RefreshCw } from 'lucide-react';

export default function SessionBanner() {
  const { sessionLost, tryRestoreSession, logout } = useAuth();
  const [retrying, setRetrying] = useState(false);

  if (!sessionLost) return null;

  const handleRetry = async () => {
    setRetrying(true);
    await tryRestoreSession();
    setRetrying(false);
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white flex items-center justify-center gap-3 px-4 py-2.5 text-sm font-medium shadow-lg">
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>Connection lost — your session is still active</span>
      <button
        onClick={handleRetry}
        disabled={retrying}
        className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 px-3 py-1 rounded-full text-xs font-semibold transition-colors disabled:opacity-60"
      >
        <RefreshCw className={`w-3 h-3 ${retrying ? 'animate-spin' : ''}`} />
        {retrying ? 'Reconnecting...' : 'Reconnect'}
      </button>
      <button
        onClick={logout}
        className="text-xs opacity-70 hover:opacity-100 underline"
      >
        Sign out
      </button>
    </div>
  );
}
