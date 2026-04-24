import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Loader2, RefreshCw, Link2 } from 'lucide-react';

export default function XeroConnectionCard() {
  const [status, setStatus] = useState('checking'); // checking, connected, disconnected, error
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const checkConnection = async () => {
    setStatus('checking');
    const res = await base44.functions.invoke('xeroAuth', { action: 'testConnection' });
    if (res.data.connected) {
      setStatus('connected');
      setOrgName(res.data.organisation || '');
    } else {
      setStatus('disconnected');
      setError(res.data.error || '');
    }
  };

  useEffect(() => { checkConnection(); }, []);

  const handleConnect = async () => {
    setLoading(true);
    const res = await base44.functions.invoke('xeroAuth', { action: 'getAuthUrl' });
    const authUrl = res.data.url;
    
    // Open in popup
    const popup = window.open(authUrl, 'xero_auth', 'width=600,height=700');
    
    // Poll for popup close, then re-check connection
    const timer = setInterval(() => {
      if (!popup || popup.closed) {
        clearInterval(timer);
        setLoading(false);
        checkConnection();
      }
    }, 1000);
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-semibold">Xero Connection</h3>
        {status === 'connected' && (
          <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
            <CheckCircle className="w-3.5 h-3.5" /> Connected
          </span>
        )}
        {status === 'disconnected' && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <XCircle className="w-3.5 h-3.5" /> Not connected
          </span>
        )}
        {status === 'checking' && (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        )}
      </div>

      <div className="px-6 py-4 space-y-3">
        {status === 'connected' && (
          <>
            <p className="text-sm">Organisation: <span className="font-medium">{orgName}</span></p>
            <Button variant="outline" size="sm" onClick={checkConnection} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> Re-test Connection
            </Button>
          </>
        )}

        {status === 'disconnected' && (
          <>
            <p className="text-sm text-muted-foreground">
              Connect your Xero account to sync invoices and contacts.
            </p>
            <Button onClick={handleConnect} disabled={loading} className="gap-1.5">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              {loading ? 'Waiting for authorisation...' : 'Connect to Xero'}
            </Button>
          </>
        )}

        {status === 'error' && (
          <p className="text-sm text-destructive">{error}</p>
        )}
      </div>
    </div>
  );
}