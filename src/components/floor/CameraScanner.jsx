import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Button } from '@/components/ui/button';
import { Camera, X, SwitchCamera } from 'lucide-react';

/**
 * Camera-based barcode scanner using html5-qrcode.
 * Optimised for speed — uses continuous scanning mode with a tight scan region.
 * Supports Code128, EAN-13, QR, and most 1D/2D formats.
 *
 * Props:
 *  - onScan(code: string) — called once per unique scan
 *  - onClose() — called when user dismisses
 *  - active (boolean) — whether to mount/start the scanner
 */
export default function CameraScanner({ onScan, onClose, active = true }) {
  const scannerRef = useRef(null);
  const containerRef = useRef(null);
  const lastCodeRef = useRef('');
  const lastTimeRef = useRef(0);
  const [error, setError] = useState(null);
  const [facingMode, setFacingMode] = useState('environment');

  const startScanner = async (facing) => {
    if (!containerRef.current) return;

    // Clean up existing scanner
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch {}
      try { scannerRef.current.clear(); } catch {}
      scannerRef.current = null;
    }

    const scanner = new Html5Qrcode('floor-camera-scanner');
    scannerRef.current = scanner;

    try {
      await scanner.start(
        { facingMode: facing },
        {
          fps: 15,
          qrbox: { width: 280, height: 120 },
          aspectRatio: 1.0,
          disableFlip: false,
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        },
        (decodedText) => {
          const now = Date.now();
          // Debounce: ignore same code within 2 seconds
          if (decodedText === lastCodeRef.current && now - lastTimeRef.current < 2000) return;
          lastCodeRef.current = decodedText;
          lastTimeRef.current = now;
          onScan(decodedText);
        },
        () => {} // ignore scan failures (normal)
      );
      setError(null);
    } catch (err) {
      console.error('Camera scanner error:', err);
      setError(typeof err === 'string' ? err : err?.message || 'Camera access denied');
    }
  };

  useEffect(() => {
    if (active) {
      // Small delay to ensure DOM element exists
      const timer = setTimeout(() => startScanner(facingMode), 200);
      return () => {
        clearTimeout(timer);
        if (scannerRef.current) {
          scannerRef.current.stop().catch(() => {});
          try { scannerRef.current.clear(); } catch {}
          scannerRef.current = null;
        }
      };
    }
  }, [active, facingMode]);

  const handleFlip = () => {
    setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');
  };

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Controls */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 z-10">
        <span className="text-white text-sm font-medium">Scan Barcode</span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="text-white h-10 w-10" onClick={handleFlip}>
            <SwitchCamera className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" className="text-white h-10 w-10" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Scanner viewport */}
      <div className="flex-1 relative flex items-center justify-center" ref={containerRef}>
        <div id="floor-camera-scanner" className="w-full h-full" />
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white p-6 text-center gap-4">
            <Camera className="w-12 h-12 text-muted-foreground" />
            <p className="text-sm">{error}</p>
            <Button variant="outline" size="sm" onClick={() => startScanner(facingMode)}>
              Retry
            </Button>
          </div>
        )}
      </div>

      {/* Guide text */}
      <div className="bg-black/80 px-4 py-3 text-center">
        <p className="text-white/70 text-xs">Point camera at barcode · Scans automatically</p>
      </div>
    </div>
  );
}