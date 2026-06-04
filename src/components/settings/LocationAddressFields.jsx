import React from 'react';
import { Input } from '@/components/ui/input';

/**
 * Structured physical-address fields for a location (warehouse / production /
 * delivery location). Controlled — pass `value` (object with the address keys)
 * and `onChange(key, value)`.
 */
export const EMPTY_ADDRESS = {
  address_line1: '',
  address_line2: '',
  suburb: '',
  city: '',
  province: '',
  postal_code: '',
};

const FIELDS = [
  { key: 'address_line1', label: 'Building / Industrial Park', span: 2 },
  { key: 'address_line2', label: 'Street Address', span: 2 },
  { key: 'suburb', label: 'Area / Suburb', span: 1 },
  { key: 'city', label: 'City', span: 1 },
  { key: 'province', label: 'Province', span: 1 },
  { key: 'postal_code', label: 'Postal Code', span: 1 },
];

export default function LocationAddressFields({ value = EMPTY_ADDRESS, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {FIELDS.map(f => (
        <div key={f.key} className={f.span === 2 ? 'col-span-2 space-y-1' : 'space-y-1'}>
          <label className="text-[11px] font-medium text-muted-foreground">{f.label}</label>
          <Input
            value={value[f.key] || ''}
            onChange={e => onChange(f.key, e.target.value)}
            className="h-9 text-sm"
          />
        </div>
      ))}
    </div>
  );
}
