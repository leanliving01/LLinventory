import React from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import TruncatedCell from '@/components/ui/TruncatedCell';

const CONDITION_STYLES = {
  accepted: 'bg-green-100 text-green-700',
  damaged: 'bg-amber-100 text-amber-700',
  rejected: 'bg-red-100 text-red-600',
};

export default function GRNLineRow({ line, index, editable, onUpdate, onRemove }) {
  if (!line) return null;

  const cf = parseFloat(line?.conversion_factor) || 1;
  const yf = parseFloat(line?.yield_factor) || 1;
  const receivedQty = parseFloat(line?.received_qty) || 0;
  const expectedQty = parseFloat(line?.expected_qty) || 0;
  const unitCost = parseFloat(line?.unit_cost) || 0;
  const internalQty = Math.round(receivedQty * cf * yf * 1000) / 1000;
  const lineTotal = receivedQty * unitCost;
  const varianceQty = receivedQty - expectedQty;

  if (!editable) {
    return (
      <tr className="hover:bg-muted/20">
        <td className="px-3 py-2">
          <TruncatedCell text={line?.product_name} className="text-sm font-medium max-w-[280px]" />
          <TruncatedCell text={line?.product_sku} className="text-[11px] font-mono text-muted-foreground max-w-[280px]" />
        </td>
        <td className="px-3 py-2 text-xs">{line?.purchase_uom || '—'}</td>
        <td className="px-3 py-2 text-sm text-right tabular-nums">{line?.expected_qty ?? '—'}</td>
        <td className="px-3 py-2 text-sm text-right tabular-nums font-medium">{receivedQty}</td>
        <td className="px-3 py-2 text-sm text-right tabular-nums">
          {line?.expected_qty != null && (
            <span className={varianceQty < 0 ? 'text-red-600' : varianceQty > 0 ? 'text-amber-600' : 'text-green-600'}>
              {varianceQty > 0 ? '+' : ''}{varianceQty}
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-sm text-right tabular-nums">{internalQty} {line?.conversion_uom || ''}</td>
        <td className="px-3 py-2 text-sm text-right tabular-nums">R {unitCost.toFixed(2)}</td>
        <td className="px-3 py-2 text-sm text-right tabular-nums font-medium">R {lineTotal.toFixed(2)}</td>
        <td className="px-3 py-2 text-center">
          <Badge className={`text-[10px] ${CONDITION_STYLES[line?.condition] || ''}`}>
            {line?.condition || 'accepted'}
          </Badge>
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-muted/20">
      <td className="px-3 py-2">
        <TruncatedCell text={line?.product_name} className="text-sm font-medium max-w-[280px]" />
        <TruncatedCell text={line?.product_sku} className="text-[11px] font-mono text-muted-foreground max-w-[280px]" />
      </td>
      <td className="px-3 py-2 text-xs">{line?.purchase_uom || '—'}</td>
      <td className="px-3 py-2 text-sm text-right tabular-nums text-muted-foreground">
        {line?.expected_qty ?? '—'}
      </td>
      <td className="px-3 py-2">
        <Input
          type="number"
          min="0"
          step="0.01"
          value={line?.received_qty || ''}
          onChange={e => onUpdate?.(index, 'received_qty', e.target.value)}
          className="h-8 w-20 text-sm text-right"
        />
      </td>
      <td className="px-3 py-2 text-sm text-right tabular-nums">
        {line?.expected_qty != null && (
          <span className={varianceQty < 0 ? 'text-red-600 font-medium' : varianceQty > 0 ? 'text-amber-600' : 'text-green-600'}>
            {varianceQty > 0 ? '+' : ''}{varianceQty.toFixed(2)}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-right tabular-nums text-muted-foreground">
        {internalQty} {line?.conversion_uom || ''}
      </td>
      <td className="px-3 py-2">
        <Input
          type="number"
          min="0"
          step="0.01"
          value={line?.unit_cost || ''}
          onChange={e => onUpdate?.(index, 'unit_cost', e.target.value)}
          className="h-8 w-24 text-sm text-right"
        />
      </td>
      <td className="px-3 py-2 text-sm text-right tabular-nums font-medium">
        R {lineTotal.toFixed(2)}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <Select value={line?.condition || 'accepted'} onValueChange={v => onUpdate?.(index, 'condition', v)}>
            <SelectTrigger className="h-7 text-[11px] w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="accepted">Accepted</SelectItem>
              <SelectItem value="damaged">Damaged</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          {onRemove && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => onRemove(index)}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}