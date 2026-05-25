import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Moon, Sun, Utensils, Flame, ChefHat, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const STATIONS = [
  { id: 'prep', label: 'PREP', desc: 'Wash, cut, marinate, weigh', icon: Utensils, color: 'bg-blue-500', ring: 'ring-blue-400' },
  { id: 'cook', label: 'COOK', desc: 'Grill, bake, boil, fry', icon: Flame, color: 'bg-amber-500', ring: 'ring-amber-400' },
  { id: 'portion', label: 'PORTION', desc: 'Weigh & pack meals', icon: ChefHat, color: 'bg-green-500', ring: 'ring-green-400' },
];

export default function KitchenSettings() {
  const { user } = useAuth();
  const [selected, setSelected] = useState(user?.station || 'cook');
  // Note: KitchenSettings still saves a single station for the user's *active* view
  const [saving, setSaving] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark');

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [dark]);

  const handleSave = async () => {
    setSaving(true);
    await base44.auth.updateMe({ station: selected });
    toast.success(`Station set to ${selected.toUpperCase()}`);
    setSaving(false);
    // Reload to pick up new user data
    window.location.href = '/kitchen';
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-card border-b border-border">
        <Link to="/kitchen">
          <Button variant="ghost" size="icon" className="h-12 w-12">
            <ArrowLeft className="w-6 h-6" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold">Station Settings</h1>
      </div>

      <div className="flex-1 p-6 space-y-8 max-w-lg mx-auto w-full">
        {/* Station picker */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Your Station</h2>
          <div className="space-y-3">
            {STATIONS.map(s => {
              const Icon = s.icon;
              const isSelected = selected === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  className={cn(
                    "w-full flex items-center gap-4 p-5 rounded-2xl border-2 transition-all text-left",
                    isSelected ? `border-primary ring-2 ${s.ring}` : "border-border hover:border-muted-foreground/30"
                  )}
                >
                  <div className={cn("w-14 h-14 rounded-xl flex items-center justify-center text-white", s.color)}>
                    <Icon className="w-7 h-7" />
                  </div>
                  <div className="flex-1">
                    <p className="text-lg font-bold">{s.label}</p>
                    <p className="text-sm text-muted-foreground">{s.desc}</p>
                  </div>
                  {isSelected && (
                    <Check className="w-6 h-6 text-primary shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dark mode */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Display</h2>
          <button
            onClick={() => setDark(d => !d)}
            className="w-full flex items-center gap-4 p-5 rounded-2xl border-2 border-border hover:border-muted-foreground/30 text-left"
          >
            <div className="w-14 h-14 rounded-xl flex items-center justify-center bg-muted">
              {dark ? <Sun className="w-7 h-7" /> : <Moon className="w-7 h-7" />}
            </div>
            <div className="flex-1">
              <p className="text-lg font-bold">{dark ? 'Light Mode' : 'Dark Mode'}</p>
              <p className="text-sm text-muted-foreground">
                {dark ? 'Switch to light background' : 'Reduce glare in the kitchen'}
              </p>
            </div>
          </button>
        </div>

        {/* User info */}
        <div className="text-center text-sm text-muted-foreground space-y-1">
          <p>Signed in as <strong>{user?.full_name || user?.email}</strong></p>
          <p>Role: <Badge variant="outline">{user?.role || 'viewer'}</Badge></p>
        </div>

        {/* Save */}
        <Button
          onClick={handleSave}
          disabled={saving}
          className="w-full h-16 text-xl font-bold rounded-xl"
        >
          {saving ? 'Saving...' : 'Save & Go to Kitchen'}
        </Button>
      </div>
    </div>
  );
}