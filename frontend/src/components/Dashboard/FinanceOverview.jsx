import React from "react";
import CustomPieChart from "../Charts/CustomPieChart";

// Red = Expenses, Orange = Income — same colors already used in charts; purple removed with the Balance slice.
const COLORS = ["#FA2C37", "#FF6900"];

const FinanceOverview = ({ totalBalance, totalIncome, totalExpense }) => {
  const balanceData = [
    { name: "Total Expenses", amount: totalExpense },
    { name: "Total Income", amount: totalIncome },
  ];

  return (
    <div className="card">
      <div className="flex items-center justify-center">
        <h5 className="text-lg">Financial Overview</h5>
      </div>

      <CustomPieChart
        data={balanceData}
        label="Total Balance"
        totalAmount={`₹${Number(totalBalance).toLocaleString("en-IN")}`}
        colors={COLORS}
        showTextAnchor
      />
    </div>
  );
};

export default FinanceOverview;
