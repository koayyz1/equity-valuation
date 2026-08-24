import { formatCurrency } from '../utils/formatting';

interface ProjectionTableProps {
  yearlyFCFE: number[];
  terminalValue: number;
  currency: string;
  discountRate: number;
  growthYears: number;
}

export function ProjectionTable({
  yearlyFCFE,
  terminalValue,
  currency,
  discountRate,
  growthYears,
}: ProjectionTableProps) {
  if (!yearlyFCFE.length) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="text-gray-500 border-b border-gray-800">
            <th className="text-left py-1 px-2 font-normal">Year</th>
            <th className="text-left py-1 px-2 font-normal">Phase</th>
            <th className="text-right py-1 px-2 font-normal">FCFE</th>
            <th className="text-right py-1 px-2 font-normal">Disc</th>
            <th className="text-right py-1 px-2 font-normal">PV</th>
          </tr>
        </thead>
        <tbody>
          {yearlyFCFE.map((fcfe, i) => {
            const year = i + 1;
            const df = Math.pow(1 + discountRate, year);
            const pv = fcfe / df;
            const phase = year <= growthYears ? 'G' : 'S';
            return (
              <tr key={year} className="border-b border-gray-900 hover:bg-gray-800/40">
                <td className="py-1 px-2 text-gray-400">Y{year}</td>
                <td className="py-1 px-2">
                  <span
                    className={
                      phase === 'G' ? 'text-emerald-400' : 'text-amber-400'
                    }
                  >
                    {phase}
                  </span>
                </td>
                <td className="py-1 px-2 text-right text-gray-200">
                  {formatCurrency(fcfe, currency)}
                </td>
                <td className="py-1 px-2 text-right text-gray-500">
                  {df.toFixed(2)}x
                </td>
                <td className="py-1 px-2 text-right text-gray-200">
                  {formatCurrency(pv, currency)}
                </td>
              </tr>
            );
          })}
          <tr className="border-t border-gray-700 font-semibold">
            <td className="py-1 px-2 text-gray-400">TV</td>
            <td className="py-1 px-2 text-violet-400">T</td>
            <td className="py-1 px-2 text-right text-gray-200">
              {formatCurrency(terminalValue, currency)}
            </td>
            <td className="py-1 px-2 text-right text-gray-500">
              {Math.pow(1 + discountRate, 10).toFixed(2)}x
            </td>
            <td className="py-1 px-2 text-right text-gray-200">
              {formatCurrency(terminalValue / Math.pow(1 + discountRate, 10), currency)}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="mt-2 text-[10px] text-gray-600 flex gap-3">
        <span><span className="text-emerald-400">G</span> = Growth phase</span>
        <span><span className="text-amber-400">S</span> = Steady phase</span>
        <span><span className="text-violet-400">T</span> = Terminal</span>
      </div>
    </div>
  );
}
