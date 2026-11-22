import assert from "node:assert/strict";
import { test } from "node:test";
import { filterOrders, monthlyRevenue, orderYears } from "../frontend/js/analytics.js";

const products = [
  { product_id: "P1", category: "Electronics" },
  { product_id: "P2", category: "Home" }
];

const orders = [
  { order_id: "old-jan", order_date: "2025-01-31", product_id: "P1", total_amount: 20 },
  { order_id: "new-jan", order_date: "2026-01-01", product_id: "P1", total_amount: 42 },
  { order_id: "home-jan", order_date: "2026-01-12", product_id: "P2", total_amount: 7 },
  { order_id: "new-feb", order_date: "2026-02-01", product_id: "P1", total_amount: 15 },
  { order_id: "new-dec", order_date: "2026-12-31", product_id: "P1", total_amount: 8 }
];

test("year choices are unique, newest first, and use valid calendar dates", () => {
  const dates = ["2027-02-29", "2027-04-31", "2027-01", null, "2024-02-29"];
  assert.deepEqual(orderYears([...orders, ...dates.map(order_date => ({ order_date }))]),
    ["2026", "2025", "2024"]);
  assert.deepEqual(orderYears([]), []);
});

test("January stays within the selected year and combines with category filtering", () => {
  const january = { month: "01", category: "Electronics" };
  assert.deepEqual(filterOrders(orders, products, { ...january, year: "2026" }), [orders[1]]);
  assert.deepEqual(filterOrders(orders, products, { ...january, year: "2025" }), [orders[0]]);
  assert.deepEqual(filterOrders(orders, products, { ...january, year: "2024" }), []);
});

test("all months shows only the selected year, including its boundary dates", () => {
  const filters = { month: "all", category: "all" };
  assert.deepEqual(filterOrders(orders, products, { ...filters, year: "2026" }), orders.slice(1));
  assert.deepEqual(filterOrders(orders, products, { ...filters, year: "" }), []);
  assert.deepEqual(filterOrders([{ order_date: "2026-02-29" }], products,
    { ...filters, year: "2026" }), []);
});

test("revenue chart uses the selected period and shows zero for empty months", () => {
  const filtered = filterOrders(orders, products, { year: "2026", month: "all", category: "all" });
  const annual = monthlyRevenue(filtered, "all");
  assert.equal(annual.length, 12);
  assert.deepEqual(annual.slice(0, 3), [
    { label: "January", total: 49 },
    { label: "February", total: 15 },
    { label: "March", total: 0 }
  ]);
  assert.deepEqual(annual.at(-1), { label: "December", total: 8 });
  const january = filterOrders(orders, products, { year: "2025", month: "01", category: "all" });
  assert.deepEqual(monthlyRevenue(january, "01"), [{ label: "January", total: 20 }]);
  assert.deepEqual(monthlyRevenue([], "01"), [{ label: "January", total: 0 }]);
});


test("CSV keeps filtered records, escapes quotes and neutralizes formula cells", async () => {
  const { ordersCsv } = await import("../frontend/js/analytics.js");
  const csv = ordersCsv([{ order_id: 'a"b', customer_id: "=1+1", quantity: 2, total_amount: 3.98 }]);
  assert.equal(csv.split("\r\n").length, 2);
  assert.ok(csv.endsWith(`"a""b","'=1+1","","","2","","3.98",""`));
});
