import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

export default function XeroCallback() {
  const [status, setStatus] = useState('processing');
  const [message, setMessage] = useState('Exchanging authorization code with Xero...');
  const [tenant, setTenant] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');

    if (error) {
      setStatus('error');
      setMessage(`Xero authorization denied: ${error}`);
      return;
    }

    if (!code) {
      setStatus('error');
      setMessage('No authorization code received from Xero.');
      return;
    }

    const exchangeCode = async () => {
      try {
        const res = await base44.functions.invoke('xeroAuth', { action: 'exchangeCode', code });
        if (res.data.success) {
          setStatus('success');
          setTenant(res.data.tenant || '');
          setMessage(`Connected to ${res.data.tenant || 'Xero'}! You can close this page.`);
          // If opened as popup, close after brief delay
          if (window.opener) {
            setTimeout(() => window.close(), 3000);
          }
        } else {
          setStatus('error');
          setMessage(res.data.error || 'Token exchange failed');
          if (res.data.details) {
            console.error('Xero error details:', res.data.details);
          }
        }
      } catch (err) {
        setStatus('error');
        setMessage(err?.response?.data?.error || err.message || 'Unexpected error during token exchange');
      }
    };

    exchangeCode();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="bg-card border border-border rounded-xl p-8 max-w-md w-full text-center space-y-4">
        {status === 'processing' && (
          <>
            <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto" />
            <h2 className="text-lg font-semibold">Connecting to Xero</h2>
            <p className="text-sm text-muted-foreground">{message}</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
            <h2 className="text-lg font-semibold text-green-700">Connected!</h2>
            <p className="text-sm text-muted-foreground">{message}</p>
            {tenant && <p className="text-sm font-medium">Organisation: {tenant}</p>}
            <Link to="/settings">
              <Button className="mt-4">Go to Settings</Button>
            </Link>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle className="w-12 h-12 text-red-500 mx-auto" />
            <h2 className="text-lg font-semibold text-red-700">Connection Failed</h2>
            <p className="text-sm text-muted-foreground">{message}</p>
            <Link to="/settings">
              <Button variant="outline" className="mt-4">Back to Settings</Button>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}