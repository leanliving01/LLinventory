import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Settings, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import POProductMatching from '@/components/purchasing/POProductMatching';

export default function POSettings() {
  const [tab, setTab] = useState('matching');

  const tabs = [
    { key: 'matching', label: 'Product Matching', icon: Link2 },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/purchasing/orders">
          <Button variant="ghost" size="icon" className="shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Settings className="w-5 h-5 text-muted-foreground" />
            Purchase Order Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Match Xero PO lines to your product catalog
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all -mb-px ${
                tab === t.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'matching' && <POProductMatching />}
    </div>
  );
}