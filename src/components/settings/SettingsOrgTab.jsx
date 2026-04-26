import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import XeroConnectionCard from './XeroConnectionCard';

const ORG_FIELDS = [
  { key: 'company_name', label: 'Organisation Name', group: 'org', type: 'text' },
  { key: 'trading_name', label: 'Trading Name', group: 'org', type: 'text' },
  { key: 'country', label: 'Country', group: 'org', type: 'text' },
  { key: 'currency', label: 'Currency', group: 'org', type: 'select', options: ['ZAR', 'USD', 'EUR', 'GBP'] },
  { key: 'timezone', label: 'Timezone', group: 'org', type: 'select', options: ['Africa/Johannesburg', 'UTC', 'Europe/London', 'America/New_York'] },
  { key: 'date_format', label: 'Date Format', group: 'org', type: 'select', options: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] },
  { key: 'vat_rate', label: 'VAT Rate (%)', group: 'tax', type: 'number' },
  { key: 'financial_year_end', label: 'Financial Year End', group: 'org', type: 'select', options: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] },
];

export default function SettingsOrgTab() {
  const queryClient = useQueryClient();
  const [formValues, setFormValues] = useState({});
  const [saving, setSaving] = useState(false);

  const { data: settings = [] } = useQuery({
    queryKey: ['settings'],
    queryFn: () => base44.entities.Setting.list('-created_date', 100),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => base44.entities.Location.list('-created_date', 20),
  });

  useEffect(() => {
    const vals = {};
    settings.forEach(s => { vals[s.key] = s.value; });
    setFormValues(vals);
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    const settingsByKey = {};
    settings.forEach(s => { settingsByKey[s.key] = s; });

    for (const field of ORG_FIELDS) {
      const val = formValues[field.key] || '';
      const existing = settingsByKey[field.key];
      if (existing) {
        if (existing.value !== val) {
          await base44.entities.Setting.update(existing.id, { value: val });
        }
      } else if (val) {
        await base44.entities.Setting.create({ key: field.key, value: val, group: field.group, label: field.label });
      }
    }
    queryClient.invalidateQueries({ queryKey: ['settings'] });
    toast.success('Organisation settings saved');
    setSaving(false);
  };

  const set = (key, value) => setFormValues(prev => ({ ...prev, [key]: value }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold">Organisation Details</h3>
          <Button onClick={handleSave} disabled={saving} size="sm" className="gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </Button>
        </div>
        <div className="p-6 space-y-4">
          {ORG_FIELDS.map(field => (
            <div key={field.key} className="space-y-1.5">
              <Label className="text-sm">{field.label}</Label>
              {field.type === 'select' ? (
                <Select value={formValues[field.key] || ''} onValueChange={v => set(field.key, v)}>
                  <SelectTrigger><SelectValue placeholder={`Select ${field.label.toLowerCase()}`} /></SelectTrigger>
                  <SelectContent>
                    {field.options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={field.type}
                  value={formValues[field.key] || ''}
                  onChange={e => set(field.key, e.target.value)}
                  placeholder={field.label}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        <XeroConnectionCard />
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h3 className="text-sm font-semibold">Warehouse Zones ({locations.length})</h3>
          </div>
          <div className="divide-y divide-border">
            {locations.map(loc => (
              <div key={loc.id} className="px-6 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{loc.name}</p>
                  <p className="text-xs text-muted-foreground">{loc.type} · {loc.code}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${loc.is_stock_bearing ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                  {loc.is_stock_bearing ? 'Stock-bearing' : 'Transient'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}