export const getOrdinalSuffix = (i) => {
  var j = i % 10,
    k = i % 100;
  if (j == 1 && k != 11) {
    return i + "st";
  }
  if (j == 2 && k != 12) {
    return i + "nd";
  }
  if (j == 3 && k != 13) {
    return i + "rd";
  }
  return i + "th";
};

export const formatDateDoMMM = (dateString) => {
  if (!dateString) return "";
  const date = new Date(dateString);
  const day = getOrdinalSuffix(date.getDate());
  const month = date.toLocaleString("en-US", { month: "short" });
  return `${day} ${month}`;
};

export const formatDateDoMMMYYYY = (dateString) => {
  if (!dateString) return "";
  const date = new Date(dateString);
  const day = getOrdinalSuffix(date.getDate());
  const month = date.toLocaleString("en-US", { month: "short" });
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
};

export const validateEmail = (email) => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
};

export const getInitials = (name) => {
  if (!name) return "";

  const words = name.split(" ");
  let initials = "";

  for (let i = 0; i < Math.min(words.length, 2); i++) {
    initials += words[i][0];
  }

  return initials.toUpperCase();
};

export const addThousandSeparator = (num) => {
  if (num == null || isNaN(num)) return "";

  return Number(num).toLocaleString("en-IN");
};

export const prepareExpenseBarChartData = (data = []) => {
  const sortedData = [...data].sort(
    (a, b) => new Date(a.date) - new Date(b.date),
  );

  const grouped = new Map();

  sortedData.forEach((item) => {
    if (!item?.date) return;
    const d = new Date(item.date);
    if (isNaN(d.getTime())) return;

    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    if (!grouped.has(dateKey)) {
      grouped.set(dateKey, {
        dateKey,
        month: formatDateDoMMM(item.date),
        amount: 0,
        category: item?.category || "",
        items: [],
      });
    }

    const group = grouped.get(dateKey);
    const itemAmount = Number(item?.amount) || 0;
    group.amount += itemAmount;
    group.items.push({
      category: item?.category || "Expense",
      amount: itemAmount,
    });

    if (group.items.length === 1) {
      group.category = item?.category || "";
    } else {
      group.category = `${group.items.length} Expenses`;
    }
  });

  return Array.from(grouped.values());
};

export const prepareIncomeBarChartData = (data = []) => {
  const sortedData = [...data].sort(
    (a, b) => new Date(a.date) - new Date(b.date),
  );

  const grouped = new Map();

  sortedData.forEach((item) => {
    if (!item?.date) return;
    const d = new Date(item.date);
    if (isNaN(d.getTime())) return;

    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    if (!grouped.has(dateKey)) {
      grouped.set(dateKey, {
        dateKey,
        month: formatDateDoMMM(item.date),
        amount: 0,
        source: item?.source || "",
        items: [],
      });
    }

    const group = grouped.get(dateKey);
    const itemAmount = Number(item?.amount) || 0;
    group.amount += itemAmount;
    group.items.push({
      source: item?.source || "Income",
      amount: itemAmount,
    });

    if (group.items.length === 1) {
      group.source = item?.source || "";
    } else {
      group.source = `${group.items.length} Incomes`;
    }
  });

  return Array.from(grouped.values());
};

// Alias — identical shape to prepareExpenseBarChartData ({ month, amount, category, items }).
// Kept as a named export because ExpenseOverview.jsx imports it for the line chart.
export const prepareExpenseLineChartData = prepareExpenseBarChartData;
