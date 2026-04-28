import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TrendingUp, Loader2 } from 'lucide-react';
import HelpDrawer from '@/components/help/HelpDrawer';
import ForecastKPICards from '@/components/forecasting/ForecastKPICards';
import DemandTrendChart from '@/components/forecasting/DemandTrendChart';
import TopMoversChart from '@/components/forecasting/TopMoversChart';
import SkuDemandTable from '@/components/forecasting/SkuDemandTable';
import { buildForecast } from '@/lib/forecastEngine';

const WEEK_OPTIONS = [
  { value: '4', label: 'Last 4 Weeks' },
  { value: '8', label: 'Last 8 Weeks' },
  { value: '12', label: 'Last 12 Weeks' },
  { value: '26', label: 'Last 26 Weeks' },
];

export default function TrendForecasting() {
  const [weeks, setWeeks] = useState('12');

  const { data: orders = [], isLoading: lo } = useQuery({
    queryKey: ['forecast-orders'],
    queryFn: () => base44.entities.SalesOrder.list('-order_date', 2000),
    staleTime: 60000,
  });

  const { data: orderLines = [], isLoading: ll } = useQuery({
    queryKey: ['forecast-order-lines'],
    queryFn: () => base44.entities.SalesOrderLine.list('-created_date', 10000),
    staleTime: 60000,
  });

  const { data: products = [], isLoading: lp } = useQuery({
    queryKey: ['forecast-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
    staleTime: 120000,
  });

  const isLoading = lo || ll || lp;

  const forecast = useMemo(() => {
    if (isLoading) return null;
    return buildForecast(orders, orderLines, products, Number(weeks));
  }, [orders, orderLines, products, weeks, isLoading]);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Trend Forecasting</h1>
            <p className="text-sm text-muted-foreground">Demand trends, top movers & par-level suggestions</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select value={weeks} onValueChange={setWeeks}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEK_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <HelpDrawer pageKey="trend-forecasting" />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" /> Crunching demand data...
        </div>
      ) : forecast ? (
        <div className="space-y-5">
          <ForecastKPICards stats={forecast.kpis} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <DemandTrendChart weeklyData={forecast.weeklyData} />
            <TopMoversChart skuStats={forecast.skuStats} />
          </div>

          <SkuDemandTable skuStats={forecast.skuStats} />
        </div>
      ) : null}
    </div>
  );
}