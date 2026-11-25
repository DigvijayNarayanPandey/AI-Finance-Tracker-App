import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const CustomBarChart = ({ data }) => {
  // Function to alternate colours
  const getBarColor = (index) => {
    return index % 2 === 0 ? "#0d9488" : "#99f6e4";
  };

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const dataPoint = payload[0].payload;
      const hasMultiple = dataPoint.items && dataPoint.items.length > 1;

      return (
        <div className="bg-white dark:bg-slate-800 shadow-md rounded-lg p-2.5 border border-gray-300 dark:border-slate-700 min-w-[150px]">
          {hasMultiple ? (
            <>
              <p className="text-xs font-semibold text-teal-800 dark:text-teal-400 mb-1.5">
                {dataPoint.month} ({dataPoint.items.length} {dataPoint.source !== undefined ? "Incomes" : "Expenses"})
              </p>
              <div className="space-y-1 mb-2 max-h-36 overflow-y-auto">
                {dataPoint.items.map((sub, idx) => (
                  <div
                    key={idx}
                    className="flex justify-between items-center text-xs text-gray-600 dark:text-slate-300 gap-3"
                  >
                    <span className="truncate max-w-[120px]">{sub.source || sub.category}</span>
                    <span className="font-medium whitespace-nowrap">
                      ₹{Number(sub.amount).toLocaleString("en-IN")}
                    </span>
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-200 dark:border-slate-700 pt-1.5 flex justify-between items-center text-xs font-semibold text-gray-900 dark:text-slate-100">
                <span>Total:</span>
                <span className="text-teal-700 dark:text-teal-400">
                  ₹{Number(dataPoint.amount).toLocaleString("en-IN")}
                </span>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs font-semibold text-teal-800 dark:text-teal-400 mb-1">
                {dataPoint.category || dataPoint.source}
              </p>
              <p className="text-sm text-gray-600 dark:text-slate-400">
                Amount:{" "}
                <span className="text-sm font-medium text-gray-900 dark:text-slate-100">
                  ₹{Number(dataPoint.amount).toLocaleString("en-IN")}
                </span>
              </p>
            </>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white dark:bg-slate-900 mt-6">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid stroke="none" />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 12 }}
            stroke="none"
          />
          <YAxis tick={{ fontSize: 12 }} stroke="none" />
          <Tooltip content={<CustomTooltip />} cursor={false} />
          <Bar
            dataKey="amount"
            fill="#FF8042"
            radius={[10, 10, 0, 0]}
            minPointSize={4}
            activeDot={{ r: 8, fill: "yellow" }}
            activeStyle={{ fill: "green" }}
          >
            {data.map((entry, index) => (
              <Cell key={index} fill={getBarColor(index)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default CustomBarChart;
