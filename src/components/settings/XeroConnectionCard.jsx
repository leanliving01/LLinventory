import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Loader2, RefreshCw, Link2, Unplug } from 'lucide-react';

export default function XeroConnectionCard() {
  const [status, setStatus] = useState('checking'); // checking, connected, disconnected, connecting, error
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState('');
  const popupRef = useRef(null);

  const checkConnection = async () => {
    setStatus('checking');
    setError('');
    const res = await base44.functions.invoke('xeroAuth', { action: 'testConnection' });
    if (res.data.connected) {
      setStatus('connected');
      setOrgName(res.data.organisation || '');
    } else {
      setStatus('disconnected');
      setError(res.data.error || '');
    }
  };

  // Listen for the auth code from the popup callback page
  useEffect(() => {
    const handler = async (event) => {
      if (event.data?.type !== 'XERO_AUTH_CODE') return;
      const code = event.data.code;
      
      setStatus('connecting');
      setError('');

      const res = await base44.functions.invoke('xeroAuth', { action: 'exchangeCode', code });
      if (res.data.success) {
        setStatus('connected');
        setOrgName(res.data.tenant || '');
      } else {
        setStatus('error');
        setError(res.data.error || 'Token exchange failed');
        console.error('Xero exchange error:', res.data);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => { checkConnection(); }, []);

  const handleDisconnect = async () => {
    setStatus('checking');
    await base44.functions.invoke('xeroAuth', { action: 'disconnect' });
    setStatus('disconnected');
    setOrgName('');
  };

  const handleConnect = async () => {
    setStatus('connecting');
    const res = await base44.functions.invoke('xeroAuth', { action: 'getAuthUrl' });
    const authUrl = res.data.url;
    popupRef.current = window.open(authUrl, 'xero_auth', 'width=600,height=700');
  };

  const isLoading = status === 'checking' || status === 'connecting';

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
        {isLoading && (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        )}
      </div>

      <div className="px-6 py-4 space-y-3">
        {status === 'connected' && (
          <>
            <p className="text-sm">Organisation: <span className="font-medium">{orgName}</span></p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={checkConnection} className="gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Re-test Connection
              </Button>
              <Button variant="outline" size="sm" onClick={handleDisconnect} className="gap-1.5 text-destructive hover:text-destructive">
                <Unplug className="w-3.5 h-3.5" /> Disconnect
              </Button>
            </div>
          </>
        )}

        {status === 'disconnected' && (
          <>
            <p className="text-sm text-muted-foreground">
              Connect your Xero account to sync invoices and contacts.
            </p>
            <Button onClick={handleConnect} className="gap-1.5">
              <Link2 className="w-4 h-4" /> Connect to Xero
            </Button>
          </>
        )}

        {status === 'connecting' && (
          <p className="text-sm text-muted-foreground">
            Waiting for Xero authorisation...
          </p>
        )}

        {status === 'error' && (
          <>
            <p className="text-sm text-destructive">{error}</p>
            <Button onClick={handleConnect} variant="outline" size="sm" className="gap-1.5">
              <Link2 className="w-4 h-4" /> Try Again
            </Button>
          </>
        )}
      </div>
    </div>
  );
}