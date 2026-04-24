import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Settings, Moon, Sun, Utensils, Flame, ChefHat } from 'lucide-react';

const STATION_META = {
  prep: { label: 'PREP', icon: Utensils, color: 'bg-blue-500' },
  cook: { label: 'COOK', icon: Flame, color: 'bg-amber-500' },
  portion: { label: 'PORTION', icon: ChefHat, color: 'bg-green-500' },
};

export default function KitchenTopBar({ station, runNumber, taskCount, doneCount }) {
  const meta = STATION_META[station] || STATION_META.prep;
  const Icon = meta.icon;

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

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-card border-b border-border">
      <div className="flex items-center gap-3">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-white ${meta.color}`}>
          <Icon className="w-5 h-5" />
          <span className="font-bold text-sm">{meta.label} Station</span>
        </div>
        {runNumber && (
          <span className="text-sm text-muted-foreground font-medium">{runNumber}</span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {taskCount > 0 && (
          <Badge variant="outline" className="text-sm px-3 py-1">
            {doneCount}/{taskCount} done
          </Badge>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDark(d => !d)}
          className="h-10 w-10"
        >
          {dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </Button>
        <Link to="/kitchen/settings">
          <Button variant="ghost" size="icon" className="h-10 w-10">
            <Settings className="w-5 h-5" />
          </Button>
        </Link>
      </div>
    </div>
  );
}