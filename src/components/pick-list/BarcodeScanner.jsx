import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScanBarcode, Check, X } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Barcode scanner component for pick list.
 * Listens for barcode scanner input (fast keystrokes ending with Enter).
 * Also allows manual barcode entry.
 */
export default function BarcodeScanner({ pickItems, onItemScanned }) {
  const [manualCode, setManualCode] = useState('');
  const [lastScanned, setLastScanned] = useState(null);
  const bufferRef = useRef('');
  const timerRef = useRef(null);
  const inputRef = useRef(null);

  // Build lookup: barcode → item, sku → item
  const lookupMap = React.useMemo(() => {
    const map = {};
    pickItems.forEach(item => {
      if (item.product.barcode) map[item.product.barcode.toLowerCase()] = item;
      if (item.product.sku) map[item.product.sku.toLowerCase()] = item;
    });
    return map;
  }, [pickItems]);

  const processCode = (code) => {
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;
    const found = lookupMap[trimmed];
    if (found) {
      setLastScanned(found);
      onItemScanned(found.product.id, found.totalQty);
      toast.success(`Picked: ${found.product.name}`);
    } else {
      setLastScanned(null);
      toast.error(`No match for "${code.trim()}" on this pick list`);
    }
  };

  // Listen for hardware scanner (rapid keypresses ending with Enter)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if user is typing in a regular input (not our scanner input)
      if (document.activeElement && document.activeElement !== inputRef.current &&
          (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.key === 'Enter') {
        if (bufferRef.current.length > 3) {
          processCode(bufferRef.current);
        }
        bufferRef.current = '';
        return;
      }
      if (e.key.length === 1) {
        bufferRef.current += e.key;
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => { bufferRef.current = ''; }, 100);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lookupMap]);

  const handleManualSubmit = (e) => {
    e.preventDefault();
    processCode(manualCode);
    setManualCode('');
  };

  return (
    <div className="bg-card border-2 border-primary/30 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2 text-primary">
        <ScanBarcode className="w-5 h-5" />
        <span className="font-bold text-sm">Barcode Scanner Active</span>
        <span className="text-xs text-muted-foreground ml-2">Scan a barcode or type SKU/barcode below</span>
      </div>
      <form onSubmit={handleManualSubmit} className="flex gap-2">
        <Input
          ref={inputRef}
          value={manualCode}
          onChange={e => setManualCode(e.target.value)}
          placeholder="Type SKU or barcode and press Enter..."
          className="h-12 text-lg font-mono flex-1"
          autoFocus
        />
        <Button type="submit" size="lg" className="h-12 px-6">
          <Check className="w-5 h-5" />
        </Button>
      </form>
      {lastScanned && (
        <div className="flex items-center gap-3 bg-green-50 dark:bg-green-900/20 rounded-lg px-4 py-2.5 text-sm">
          <Check className="w-5 h-5 text-green-600 shrink-0" />
          <div>
            <span className="font-semibold">{lastScanned.product.name}</span>
            <span className="text-muted-foreground ml-2">— {lastScanned.totalQty} {lastScanned.uom} auto-picked</span>
          </div>
        </div>
      )}
    </div>
  );
}