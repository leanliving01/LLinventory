import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Building2, MapPin, DollarSign, Calendar } from 'lucide-react';
import XeroConnectionCard from './XeroConnectionCard';

export default function SettingsOrgTab() {
  const { data: settings = [] } = useQuery({
    queryKey: ['settings'],
    queryFn: () => base44.entities.Setting.list('-created_date', 50),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => base44.entities.Location.list('-created_date', 20),
  });

  const settingsByKey = {};
  settings.forEach(s => { settingsByKey[s.key] = s.value; });

  const orgFields = [
    { label: 'Organisation', value: settingsByKey.org_name, icon: Building2 },
    { label: 'Trading Name', value: settingsByKey.trading_name, icon: Building2 },
    { label: 'Country', value: settingsByKey.country, icon: MapPin },
    { label: 'Currency', value: settingsByKey.currency, icon: DollarSign },
    { label: 'Timezone', value: settingsByKey.timezone, icon: Calendar },
    { label: 'Date Format', value: settingsByKey.date_format, icon: Calendar },
    { label: 'VAT Rate', value: settingsByKey.vat_rate ? `${settingsByKey.vat_rate}%` : '—', icon: DollarSign },
    { label: 'Financial Year End', value: settingsByKey.financial_year_end, icon: Calendar },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <XeroConnectionCard />

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-sm font-semibold">Organisation Details</h3>
        </div>
        <div className="divide-y divide-border">
          {orgFields.map(f => (
            <div key={f.label} className="px-6 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <f.icon className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{f.label}</span>
              </div>
              <span className="text-sm font-medium">{f.value || '—'}</span>
            </div>
          ))}
        </div>
      </div>

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
  );
}