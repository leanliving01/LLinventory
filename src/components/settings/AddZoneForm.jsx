import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus } from 'lucide-react';

const ZONE_TYPES = [
  { value: 'ambient', label: 'Ambient / Dry' },
  { value: 'chilled', label: 'Chilled' },
  { value: 'frozen', label: 'Frozen' },
  { value: 'packing', label: 'Packing' },
  { value: 'dispatch', label: 'Dispatch' },
  { value: 'production', label: 'Production' },
  { value: 'bin', label: 'Bin' },
  { value: 'shelf', label: 'Shelf' },
  { value: 'storage', label: 'Storage Area' },
];

export default function AddZoneForm({ onAdd }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [type, setType] = useState('ambient');

  const handleAdd = () => {
    if (!name.trim() || !code.trim()) return;
    onAdd({ name: name.trim(), code: code.trim().toUpperCase(), type });
    setName('');
    setCode('');
    setType('ambient');
  };

  return (
    <div className="px-5 py-3 flex items-center gap-3 border-t border-dashed border-border">
      <Input value={name} onChange={e => setName(e.target.value)} placeholder="Zone name" className="flex-1 h-8 text-sm" />
      <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="CODE" className="w-20 h-8 text-sm font-mono" maxLength={8} />
      <Select value={type} onValueChange={setType}>
        <SelectTrigger className="w-36 h-8 text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          {ZONE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={handleAdd} disabled={!name.trim() || !code.trim()}>
        <Plus className="w-3.5 h-3.5" strokeWidth={1.5} /> Add
      </Button>
    </div>
  );
}