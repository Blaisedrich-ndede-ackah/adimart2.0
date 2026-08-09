import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';

export interface FinancialDonutMetrics {
  costPrice: number;
  sellingPrice: number;
  /** Selling price − cost price */
  profitEstimate: number;
}

interface FinancialDonutChartProps {
  metrics: FinancialDonutMetrics;
  title?: string;
  className?: string;
}

const COLORS = {
  cost: '#2563eb',
  selling: '#16a34a',
  profit: '#eab308',
} as const;

function formatGhs(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return amount < 0 ? `-GHS ${formatted}` : `GHS ${formatted}`;
}

export default function FinancialDonutChart({
  metrics,
  title = 'Cost · Selling · Profit',
  className = '',
}: FinancialDonutChartProps) {
  const costPrice = Number(metrics.costPrice) || 0;
  const sellingPrice = Number(metrics.sellingPrice) || 0;
  const profitEstimate =
    metrics.profitEstimate != null
      ? Number(metrics.profitEstimate) || 0
      : sellingPrice - costPrice;

  const chartData = [
    { key: 'cost', name: 'Cost price', value: Math.max(0, costPrice), color: COLORS.cost },
    { key: 'selling', name: 'Selling price', value: Math.max(0, sellingPrice), color: COLORS.selling },
    {
      key: 'profit',
      name: 'Profit Estimate',
      value: Math.max(0, profitEstimate),
      color: COLORS.profit,
    },
  ];

  const hasValues = chartData.some((d) => d.value > 0);

  const legend = [
    { name: 'Cost price', color: COLORS.cost, amount: costPrice },
    { name: 'Selling price', color: COLORS.selling, amount: sellingPrice },
    { name: 'Profit Estimate', color: COLORS.profit, amount: profitEstimate },
  ];

  return (
    <div className={`bg-white rounded-xl p-4 shadow-sm border border-emerald-50 ${className}`}>
      {title ? (
        <h3 className="text-sm font-bold text-gray-700 mb-3">{title}</h3>
      ) : null}

      <div className="relative mx-auto w-full max-w-[260px] h-[220px]">
        {hasValues ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={68}
                outerRadius={96}
                paddingAngle={2}
                stroke="#fff"
                strokeWidth={2}
              >
                {chartData.map((entry) => (
                  <Cell key={entry.key} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-[192px] h-[192px] rounded-full border-[28px] border-gray-100" />
          </div>
        )}

        {/* Center label: Selling price above its total */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-6">
          <p className="text-[11px] font-semibold text-gray-500 leading-tight">Selling price</p>
          <p className="text-base font-bold text-gray-900 mt-0.5 tabular-nums leading-tight">
            {formatGhs(sellingPrice)}
          </p>
        </div>
      </div>

      <ul className="mt-4 space-y-2.5">
        {legend.map((row) => (
          <li key={row.name} className="flex items-center gap-2.5 text-sm">
            <span
              className="w-3 h-3 rounded-[3px] flex-shrink-0"
              style={{ backgroundColor: row.color }}
              aria-hidden
            />
            <span className="text-gray-700 font-medium truncate">{row.name}</span>
            <span className="ml-auto font-semibold text-gray-900 tabular-nums whitespace-nowrap">
              {formatGhs(row.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { formatGhs as formatGhsAmount };
