import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, ShoppingBag, AlertCircle, Search, Camera, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import CameraScanner from '@/components/floor/CameraScanner';

const PAGE_SIZE = 15;

/**
 * Displays paid/unfulfilled orders for packing selection.
 * Includes search bar, barcode scanner, HID scanner support, and pagination.
 */
export default function FloorOrderPicker({ orders, loading, onSelect }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [page, setPage] = useState(0);
  const bufferRef = useRef('');
  const timerRef = useRef(null);

  // Filter orders by search term
  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return orders;
    const q = searchTerm.trim().toLowerCase();
    return orders.filter(o =>
      (o.order_number || '').toLowerCase().includes(q) ||
      (o.shopify_order_id || '').toLowerCase().includes(q) ||
      (o.customer_name || '').toLowerCase().includes(q)
    );
  }, [orders, searchTerm]);

  // Reset page when search changes
  useEffect(() => { setPage(0); }, [searchTerm]);

  // Auto-select if exactly one match after typing/scanning
  useEffect(() => {
    if (searchTerm.trim() && filtered.length === 1) {
      onSelect(filtered[0]);
    }
  }, [filtered, searchTerm]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageOrders = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Process a scanned code — set as search term (auto-select fires via useEffect)
  const handleScanCode = (code) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    // Strip leading # if present (order numbers are stored as #29590)
    setSearchTerm(trimmed.startsWith('#') ? trimmed : trimmed);
    setShowCamera(false);
  };

  // HID barcode scanner listener
  useEffect(() => {
    const handleKeyDown = (e) => {
      const active = document.activeElement;
      if (active && active.tagName === 'INPUT' && active.type !== 'hidden') return;
      if (e.key === 'Enter') {
        if (bufferRef.current.length > 3) handleScanCode(bufferRef.current);
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
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading orders...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Select Order to Pack</h1>

      {/* Search + Camera */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search order # or customer..."
            className="h-12 text-base pl-11"
          />
        </div>
        <Button variant="outline" className="h-12 w-12 shrink-0" onClick={() => setShowCamera(true)}>
          <Camera className="w-5 h-5" />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {filtered.length} order{filtered.length !== 1 ? 's' : ''} ready
        {searchTerm.trim() && ` (filtered from ${orders.length})`}
      </p>

      {showCamera && (
        <CameraScanner
          active={showCamera}
          onScan={handleScanCode}
          onClose={() => setShowCamera(false)}
        />
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto" />
          <h2 className="text-lg font-bold">
            {searchTerm.trim() ? 'No Matching Orders' : 'No Orders to Pack'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {searchTerm.trim()
              ? 'Try a different order number or customer name.'
              : 'All paid orders have been packed. Check again later.'}
          </p>
          {searchTerm.trim() && (
            <Button variant="outline" size="sm" onClick={() => setSearchTerm('')}>
              Clear Search
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {pageOrders.map(order => (
              <button
                key={order.id}
                onClick={() => onSelect(order)}
                className="w-full bg-card border-2 border-border rounded-2xl p-5 flex items-center gap-4 active:scale-[0.98] transition-transform text-left hover:border-primary/50"
              >
                <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                  <ShoppingBag className="w-6 h-6 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-base">{order.order_number || order.shopify_order_id}</p>
                  <p className="text-sm text-muted-foreground truncate">{order.customer_name || 'Customer'}</p>
                  <p className="text-xs text-muted-foreground">
                    {order.order_date ? format(new Date(order.order_date), 'dd MMM HH:mm') : '—'}
                  </p>
                </div>
                {order.status === 'picking' ? (
                  <Badge className="bg-orange-100 text-orange-700 text-xs shrink-0">In Progress</Badge>
                ) : (
                  <Badge className="bg-blue-100 text-blue-700 text-xs shrink-0">Pack</Badge>
                )}
              </button>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10"
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <span className="text-sm font-medium tabular-nums">
                {page + 1} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
              >
                <ChevronRight className="w-5 h-5" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}