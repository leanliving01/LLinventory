import React from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Shared pagination component with page size selector and page navigation.
 *
 * Props:
 *  - page: 0-indexed current page
 *  - pageSize: current page size
 *  - totalItems: total filtered items count
 *  - onPageChange(newPage): page change callback (0-indexed)
 *  - onPageSizeChange(newSize): page size change callback
 *  - pageSizeOptions: array of numbers (default [15, 25, 50, 100])
 *  - compact: if true, only shows prev/next without page numbers
 */
export default function TablePagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [15, 25, 50, 100],
  compact = false,
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const from = totalItems === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, totalItems);

  if (totalItems === 0) return null;

  // Build visible page numbers with ellipsis
  const pageNumbers = [];
  if (!compact) {
    for (let i = 0; i < totalPages; i++) {
      if (i === 0 || i === totalPages - 1 || Math.abs(i - page) <= 1) {
        pageNumbers.push(i);
      } else if (pageNumbers[pageNumbers.length - 1] !== '...') {
        pageNumbers.push('...');
      }
    }
  }

  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/30 gap-3 flex-wrap">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>Showing {from}–{to} of {totalItems}</span>
        {onPageSizeChange && (
          <div className="flex items-center gap-1.5">
            <span>Per page:</span>
            <Select value={String(pageSize)} onValueChange={v => onPageSizeChange(Number(v))}>
              <SelectTrigger className="h-7 w-[64px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map(n => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 0}
          onClick={() => onPageChange(page - 1)}
          className="h-7 w-7 p-0"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        {!compact && pageNumbers.map((p, idx) =>
          p === '...' ? (
            <span key={`e${idx}`} className="px-1 text-xs text-muted-foreground">…</span>
          ) : (
            <Button
              key={p}
              variant={p === page ? 'default' : 'outline'}
              size="sm"
              onClick={() => onPageChange(p)}
              className="h-7 w-7 p-0 text-xs"
            >
              {p + 1}
            </Button>
          )
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
          className="h-7 w-7 p-0"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}