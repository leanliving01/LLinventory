import React, { useRef, useState, useLayoutEffect } from 'react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Renders text on a single truncated line. When the text is actually clipped
 * (or always, if `force`), hovering reveals the full value in a tooltip.
 *
 * Requires a <TooltipProvider> ancestor (mounted at the app root in App.jsx).
 *
 * Props:
 *   text       – the full string to display / show in the tooltip
 *   className  – classes for the visible truncated element
 *   placeholder– shown (untruncated, no tooltip) when text is empty, default '—'
 *   force      – always show the tooltip even when not overflowing
 */
export default function TruncatedCell({ text, className, placeholder = '—', force = false }) {
  const ref = useRef(null);
  const [overflowing, setOverflowing] = useState(false);

  const value = text == null ? '' : String(text);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setOverflowing(el.scrollWidth > el.clientWidth + 1);
  }, [value]);

  if (!value) {
    return <span className={cn('text-muted-foreground', className)}>{placeholder}</span>;
  }

  const content = (
    <div ref={ref} className={cn('truncate', className)}>
      {value}
    </div>
  );

  if (!overflowing && !force) return content;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent className="max-w-sm break-words">{value}</TooltipContent>
    </Tooltip>
  );
}
