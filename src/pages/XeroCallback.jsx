import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

export default function XeroCallback() {
  const [status, setStatus] = useState('processing');
  const [message, setMessage] = useState('Completing Xero authorisation...');

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

    // Pass the code back to the opener (Settings page) which is authenticated
    if (window.opener) {
      window.opener.postMessage({ type: 'XERO_AUTH_CODE', code }, '*');
      setStatus('success');
      setMessage('Authorisation received! This window will close...');
      setTimeout(() => window.close(), 2000);
    } else {
      // Opened directly (not as popup) — show the code for manual use
      setStatus('error');
      setMessage('Please use the "Connect to Xero" button on the Settings page. This page should open as a popup.');
    }
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
            <h2 className="text-lg font-semibold text-green-700">Done!</h2>
            <p className="text-sm text-muted-foreground">{message}</p>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle className="w-12 h-12 text-red-500 mx-auto" />
            <h2 className="text-lg font-semibold text-red-700">Error</h2>
            <p className="text-sm text-muted-foreground">{message}</p>
          </>
        )}
      </div>
    </div>
  );
}