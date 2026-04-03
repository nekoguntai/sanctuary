import React, { useEffect, useState, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Amount } from '../Amount';
import { Timeframe } from './hooks/useDashboardData';

// Custom themed tooltip matching the app's surface system
const ChartTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="surface-elevated font-sans rounded-lg px-3 py-2 shadow-lg border border-sanctuary-200 dark:border-sanctuary-700">
      <p className="text-[10px] uppercase tracking-wider text-sanctuary-400 mb-0.5">{label}</p>
      <p className="text-sm font-semibold font-mono tabular-nums text-primary-600">
        {Number(payload[0].value).toLocaleString()} sats
      </p>
    </div>
  );
};

// Animated number component for smooth price transitions
const AnimatedPrice: React.FC<{ value: number | null; symbol: string }> = ({ value, symbol }) => {
  const [displayValue, setDisplayValue] = useState<number | null>(value);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevValueRef = useRef<number | null>(value);
  const animationRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    // Handle null -> number transition (initial load)
    if (value !== null && prevValueRef.current === null) {
      setDisplayValue(value);
      prevValueRef.current = value;
      return;
    }

    // Handle number -> number transition (price update)
    if (value !== null && prevValueRef.current !== null && prevValueRef.current !== value) {
      setIsAnimating(true);
      const startValue = prevValueRef.current;
      const endValue = value;
      const duration = 800; // ms
      const startTime = performance.now();

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Easing function (ease-out cubic)
        const easeOut = 1 - Math.pow(1 - progress, 3);

        const currentValue = startValue + (endValue - startValue) * easeOut;
        setDisplayValue(currentValue);

        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animate);
        } else {
          setIsAnimating(false);
          prevValueRef.current = value;
        }
      };

      animationRef.current = requestAnimationFrame(animate);

      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
      };
    }
  }, [value]);

  const direction = value !== null && prevValueRef.current !== null
    ? value > prevValueRef.current ? 'up' : value < prevValueRef.current ? 'down' : 'none'
    : 'none';
  const animatedPriceClass = isAnimating
    ? direction === 'up'
      ? 'text-success-600 dark:text-success-400'
      : 'text-rose-600 dark:text-rose-400'
    : 'text-sanctuary-900 dark:text-sanctuary-50';

  // Show placeholder if price not yet loaded
  if (displayValue === null) {
    return (
      <div className="relative">
        <span className="text-3xl font-bold text-sanctuary-400 dark:text-sanctuary-500">
          {symbol}-----
        </span>
      </div>
    );
  }

  return (
    <div className="relative">
      <span
        className={`text-3xl font-bold font-mono tabular-nums transition-colors duration-300 ${
          animatedPriceClass
        }`}
      >
        {symbol}{displayValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </span>
      {isAnimating && (
        <span className={`absolute -right-6 top-1/2 -translate-y-1/2 transition-opacity ${
          direction === 'up' ? 'text-success-500' : 'text-rose-500'
        }`}>
          {direction === 'up' ? '↑' : '↓'}
        </span>
      )}
    </div>
  );
};

interface PriceChartProps {
  totalBalance: number;
  chartReady: boolean;
  timeframe: Timeframe;
  setTimeframe: (tf: Timeframe) => void;
  chartData: Array<{ name: string; sats: number }>;
}

export const PriceChart: React.FC<PriceChartProps> = ({
  totalBalance,
  chartReady,
  timeframe,
  setTimeframe,
  chartData,
}) => {
  return (
    <div className="surface-elevated rounded-xl p-5 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        <div className="flex-shrink-0">
          <p className="text-[11px] font-semibold text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-[0.08em]">Total Balance</p>
          <Amount
            sats={totalBalance}
            size="xl"
            className="mt-1 font-bold text-sanctuary-900 dark:text-sanctuary-50"
          />
        </div>
        <div className="flex-1 lg:w-2/3 min-w-[200px]">
          <div className="flex justify-end mb-2">
            <div className="flex space-x-1 surface-secondary p-1 rounded-lg">
              {['1D', '1W', '1M', '1Y', 'ALL'].map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf as Timeframe)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors ${
                    timeframe === tf
                      ? 'bg-white dark:bg-sanctuary-700 text-primary-700 dark:text-primary-300 shadow-sm'
                      : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>
          <div className="h-32 min-w-[200px]">
            {chartReady && (
              <ResponsiveContainer width="99%" height={120}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorSats" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-primary-400)" stopOpacity={0.5}/>
                      <stop offset="60%" stopColor="var(--color-primary-400)" stopOpacity={0.15}/>
                      <stop offset="100%" stopColor="var(--color-primary-400)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#a39e93'}} />
                  <YAxis hide />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--color-primary-300)', strokeWidth: 1, strokeDasharray: '4 4' }} />
                  <Area
                    type="monotone"
                    dataKey="sats"
                    stroke="var(--color-primary-500)"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#colorSats)"
                    animationDuration={1200}
                    animationEasing="ease-out"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export { AnimatedPrice };
