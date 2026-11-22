export const months = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function orderPeriod(date) {
  if (typeof date !== "string" || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)) {
    return null;
  }
  const parsed = new Date(date);
  return parsed.toISOString().slice(0, 10) === date ? date.slice(0, 7) : null;
}

export function orderYears(orders) {
  const years = new Set();
  for (const order of orders) {
    const period = orderPeriod(order.order_date);
    if (period) years.add(period.slice(0, 4));
  }
  return [...years].sort().reverse();
}

export function filterOrders(orders, products, { year, month, category }) {
  const categories = new Map(products.map(product => [product.product_id, product.category]));
  return orders.filter(order => {
    const period = orderPeriod(order.order_date);
    return period !== null && period.slice(0, 4) === year
      && (month === "all" || period.slice(5) === month)
      && (category === "all" || categories.get(order.product_id) === category);
  });
}

export function monthlyRevenue(completedOrders, month) {
  const totals = Array(12).fill(0);
  for (const order of completedOrders) {
    const monthIndex = Number(order.order_date.slice(5, 7)) - 1;
    totals[monthIndex] += Number(order.total_amount);
  }
  return months.flatMap((label, index) =>
    month === "all" || Number(month) === index + 1 ? [{ label, total: totals[index] }] : []
  );
}

export function ordersCsv(orders) {
  const columns = [
    "order_id", "customer_id", "product_id",
    "order_date", "quantity", "unit_price",
    "total_amount", "status"
  ];

  const escapeCsv = value => {
    const safeValue = typeof value === "string" && /^(?:\s*[=+@-]|[\t\r\n])/.test(value)
      ? `'${value}`
      : value;
    return `"${String(safeValue ?? "").replace(/"/g, '""')}"`;
  };

  return [
    columns.join(","),
    ...orders.map(order =>
      columns.map(key => escapeCsv(order[key])).join(",")
    )
  ].join("\r\n");
}
