import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, AlertTriangle, AlertCircle, TrendingUp, Clock, Check, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useInventoryAlerts } from '@/hooks/useInventoryAlerts';

const TYPE_ICON = {
  out_of_stock: AlertCircle,
  reorder: AlertTriangle,
  below_par: AlertTriangle,
  trending_up: TrendingUp,
  low_cover: Clock,
  dead_stock: Clock,
};

const SEVERITY_TINT = {
  critical: 'text-red-600',
  warn: 'text-amber-600',
  info: 'text-sky-600',
};

/**
 * Global inventory notification bell. Mounted once in AppLayout (fixed top-right).
 * Also fires toasts for newly-arrived critical/warn alerts via the shared hook.
 */
export default function NotificationBell() {
  const navigate = useNavigate();
  const { alerts, count, markRead, dismissAll } = useInventoryAlerts({ toastOnNew: true });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="relative w-9 h-9 rounded-full bg-card border border-border shadow-sm flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Inventory alerts"
        >
          <Bell className="w-4 h-4" strokeWidth={1.75} />
          {count > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold">Inventory Alerts</p>
          {count > 0 && (
            <button onClick={dismissAll} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> Mark all read
            </button>
          )}
        </div>

        {alerts.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">You're all caught up.</div>
        ) : (
          <ul className="max-h-96 overflow-y-auto divide-y divide-border">
            {alerts.map((a) => {
              const Icon = TYPE_ICON[a.alert_type] || Bell;
              return (
                <li key={a.id} className="group flex items-start gap-2.5 px-4 py-3 hover:bg-muted/40 transition-colors">
                  <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', SEVERITY_TINT[a.severity] || 'text-muted-foreground')} />
                  <button
                    className="flex-1 text-left min-w-0"
                    onClick={() => { markRead(a.id); navigate('/inventory/dashboard'); }}
                  >
                    <p className="text-xs leading-snug text-foreground">{a.message}</p>
                  </button>
                  <button
                    onClick={() => markRead(a.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity shrink-0"
                    aria-label="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="px-4 py-2.5 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            onClick={() => navigate('/inventory/dashboard')}
          >
            Open Inventory Dashboard
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
