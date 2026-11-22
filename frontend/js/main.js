
import { auth, db } from "./firebase.js";

import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "firebase/auth";

import {
  collection,
  doc,
  onSnapshot
} from "firebase/firestore";
import { BarController, BarElement, CategoryScale, Chart, Legend, LinearScale, Tooltip } from "chart.js";
import { filterOrders, monthlyRevenue, months, orderYears } from "./analytics.js";
import { createOrder } from "./orders.js";
import { adjustStock } from "./stock.js";

Chart.register(BarController, BarElement, CategoryScale, Legend, LinearScale, Tooltip);

const $ = selector => document.querySelector(selector);

const loginForm = $("#login-form");
const loginSection = $("#login-section");
const dashboard = $("#dashboard");
const dashboardContent = $("#dashboard-content");
const message = $("#message");

let orders = [];
let products = [];
let customers = [];
let salesChart = null;
let productsChart = null;
const permissions = {
  admin: { orders: true, createOrder: true, adjustStock: true, export: true },
  sales: { orders: true, createOrder: true },
  inventory: { adjustStock: true },
  analyst: { orders: true, export: true }
};

let access = {};
let unsubscribeProfile;
let subscriptions = [];
let session = 0;
let dataVersion = 0;
let currentRole;

function resetData() {
  dataVersion++;
  subscriptions.forEach(unsubscribe => unsubscribe());
  subscriptions = [];
  access = {};
  orders = [];
  products = [];
  customers = [];
  salesChart?.destroy();
  productsChart?.destroy();
  salesChart = productsChart = null;
  dashboardContent.hidden = true;
  document.querySelectorAll("[data-nav]").forEach(link => { link.hidden = true; });
  $("#user-role").hidden = true;
  $("#order-form").reset();
  $("#order-message").textContent = "";
  $("#stock-form").reset();
  $("#stock-message").textContent = "";
  $("#inventory-search").value = "";
  $("#year-filter").replaceChildren();
  $("#month-filter").value = "all";
  $("#overview-period").textContent = "Retail Performance Overview";
  $("#category-filter").value = "all";
  $("#inventory-body").replaceChildren();
  for (const id of ["revenue", "orders", "average", "customers"]) {
    $(`#${id}`).textContent = "—";
  }
  populateCategories();
  populateOrderForm();
  populateStockForm();
}

const money = value =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "AZN"
  }).format(value);

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = loginForm.querySelector("button");
  button.disabled = true;
  message.textContent = "Signing in…";

  try {
    await signInWithEmailAndPassword(
      auth,
      $("#email").value,
      $("#password").value
    );
    message.textContent = "";
  } catch {
    message.textContent = "Could not sign in. Check your credentials and connection.";
  } finally {
    button.disabled = false;
  }
});

$("#logout").addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch {
    $("#dashboard-status").textContent = "Could not sign out. Try again.";
  }
});

onAuthStateChanged(auth, user => {
  const currentSession = ++session;
  unsubscribeProfile?.();
  currentRole = undefined;
  resetData();
  loginSection.hidden = Boolean(user);
  dashboard.hidden = !user;
  $("#password").value = "";
  if (!user) return;

  const status = $("#dashboard-status");
  status.textContent = "Checking account access…";

  unsubscribeProfile = onSnapshot(doc(db, "users", user.uid), { includeMetadataChanges: true }, snapshot => {
    if (currentSession !== session) return;
    if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
      if (currentRole !== undefined) {
        currentRole = undefined;
        resetData();
      }
      status.textContent = "Waiting to verify access with Firebase…";
      return;
    }
    const profile = snapshot.data();
    const role = profile?.active === true && typeof profile.role === "string"
      && Object.hasOwn(permissions, profile.role)
      ? profile.role
      : null;
    if (role === currentRole) return;
    currentRole = role;
    resetData();

    if (!role) {
      status.textContent = "This account has no active role. Contact your Firebase project administrator.";
      return;
    }

    access = permissions[role];
    $("#user-role").textContent = role;
    $("#user-role").hidden = false;
    $("#analytics").hidden = !access.orders;
    $("#order-form").closest(".order-panel").hidden = !access.createOrder;
    $("#stock-form").closest(".stock-panel").hidden = !access.adjustStock;
    $("#export-csv").hidden = !access.export;
    $("[data-nav=analytics]").hidden = !access.orders;
    $("[data-nav=inventory]").hidden = false;
    $("[data-nav=stock]").hidden = !access.adjustStock;
    $("[data-nav=order]").hidden = !access.createOrder;
    $("#overview-period").textContent = access.orders ? "Retail Performance Overview" : "Inventory Management";
    status.textContent = "Loading workspace…";

    const version = dataVersion;
    const sources = { products: rows => { products = rows; } };
    if (access.orders) sources.orders = rows => {
      orders = rows;
      populateYears();
    };
    if (access.createOrder) sources.customers = rows => { customers = rows; };
    const pending = new Set(Object.keys(sources));

    for (const [name, receive] of Object.entries(sources)) {
      subscriptions.push(onSnapshot(collection(db, name), { includeMetadataChanges: true }, results => {
        if (version !== dataVersion || results.metadata.hasPendingWrites) return;
        if (results.metadata.fromCache) {
          pending.add(name);
          dashboardContent.hidden = true;
          status.textContent = "Waiting for synchronized data…";
          return;
        }
        receive(results.docs.map(document => ({ ...document.data(), id: document.id })));
        pending.delete(name);
        if (pending.size) return;

        populateCategories();
        if (access.createOrder) populateOrderForm();
        if (access.adjustStock) populateStockForm();
        dashboardContent.hidden = false;
        renderInventory();
        if (access.orders) updateDashboard();
        else status.textContent = `${products.length} products`;
      }, () => {
        if (version !== dataVersion) return;
        currentRole = undefined;
        resetData();
        status.textContent = "Workspace access changed or data could not be synchronized. Sign in again to retry.";
      }));
    }
  }, () => {
    if (currentSession !== session) return;
    resetData();
    status.textContent = "Could not verify account access. Sign in again to retry.";
  });
});

function populateCategories() {
  const categories = [
    ...new Set(products.map(product => product.category))
  ].sort();

  const previous = $("#category-filter").value;
  $("#category-filter").innerHTML =
    '<option value="all">All Categories</option>';

  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    $("#category-filter").appendChild(option);
  }
  if (categories.includes(previous)) $("#category-filter").value = previous;
}

function populateYears() {
  const select = $("#year-filter");
  const previous = select.value;
  const years = orderYears(orders);
  select.replaceChildren(...years.map(year => new Option(year, year)));
  if (years.includes(previous)) select.value = previous;
}

function getFilteredOrders() {
  return filterOrders(orders, products, {
    year: $("#year-filter").value,
    month: $("#month-filter").value,
    category: $("#category-filter").value
  });
}

function updateDashboard() {
  if (!access.orders || dashboardContent.hidden) return;
  const year = $("#year-filter").value;
  const month = $("#month-filter").value;
  $("#year-filter").disabled = !year;
  $("#month-filter").disabled = !year;
  const period = month === "all" ? year : `${months[Number(month) - 1]} ${year}`;
  $("#overview-period").textContent = year
    ? `Retail Performance Overview — ${period}`
    : "Retail Performance Overview";
  $("#sales-title").textContent = year ? `Sales Performance — ${period}` : "Sales Performance";

  const filtered = getFilteredOrders();

  const completed = filtered.filter(
    order => order.status === "Completed"
  );

  const revenue = completed.reduce(
    (sum, order) => sum + Number(order.total_amount), 0
  );

  const average = completed.length
    ? revenue / completed.length
    : 0;

  const activeCustomers = new Set(
    filtered.map(order => order.customer_id)
  ).size;

  $("#revenue").textContent = filtered.length ? money(revenue) : "—";
  $("#orders").textContent = filtered.length.toLocaleString("en-US");
  $("#average").textContent = completed.length ? money(average) : "—";
  $("#customers").textContent = activeCustomers.toLocaleString("en-US");
  $("#export-csv").disabled = !filtered.length;
  $("#analytics-empty").hidden = Boolean(completed.length);
  $("#analytics-empty").textContent = filtered.length
    ? "No completed orders match this period and category."
    : "No orders match this period and category.";
  $("#analytics-charts").hidden = !completed.length;

  updateSalesChart(completed, month);
  updateProductsChart(completed);

  $("#dashboard-status").textContent =
    `${filtered.length} filtered orders · ${products.length} products · ${activeCustomers} customers in filtered orders`;
}

function updateSalesChart(completed, month) {
  const monthly = monthlyRevenue(completed, month);

  if (salesChart) salesChart.destroy();

  salesChart = new Chart($("#sales-chart"), {
    type: "bar",
    data: {
      labels: monthly.map(({ label }) => label.slice(0, 3)),
      datasets: [{
        label: "Completed Sales (AZN)",
        data: monthly.map(({ total }) => total),
        backgroundColor: "#765bd9",
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: item => money(item.raw) } }
      }
    }
  });
}

function updateProductsChart(completed) {
  const revenueByProduct = new Map();

  for (const order of completed) {
    const current = revenueByProduct.get(order.product_id) || 0;

    revenueByProduct.set(
      order.product_id,
      current + Number(order.total_amount)
    );
  }

  const topFive = [...revenueByProduct.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const productNames = new Map(
    products.map(p => [p.product_id, p.product_name])
  );

  if (productsChart) productsChart.destroy();

  productsChart = new Chart($("#products-chart"), {
    type: "bar",
    data: {
      labels: topFive.map(
        ([id]) => productNames.get(id) || id
      ),
      datasets: [{
        label: "Revenue (AZN)",
        data: topFive.map(([, revenue]) => revenue),
        backgroundColor: "#257e70",
        borderRadius: 6
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: item => money(item.raw) } }
      }
    }
  });
}

$("#year-filter").addEventListener("change", updateDashboard);
$("#month-filter").addEventListener("change", updateDashboard);
$("#category-filter").addEventListener("change", updateDashboard);

$("#export-csv").addEventListener("click", () => {
  if (!access.export || dashboardContent.hidden || $("#export-csv").disabled) return;
  const filtered = getFilteredOrders();

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

  const csv = [
    columns.join(","),
    ...filtered.map(order =>
      columns.map(key => escapeCsv(order[key])).join(",")
    )
  ].join("\r\n");

  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "retailpulse_filtered_orders.csv";
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

function populateOrderForm() {
  const customerSelect = $("#order-customer");
  const productSelect = $("#order-product");

  const selectedCustomer = customerSelect.value;
  const selectedProduct = productSelect.value;
  customerSelect.innerHTML =
    '<option value="">Select Customer</option>';

  productSelect.innerHTML =
    '<option value="">Select Product</option>';

  customers.forEach(customer => {
    const option = document.createElement("option");
    option.value = customer.id;
    option.textContent =
      customer.customer_name || customer.name || customer.customer_id;
    customerSelect.appendChild(option);
  });

  products.forEach(product => {
    const option = document.createElement("option");
    option.value = product.id;
    const price = product.price ?? product.unit_price;
    const hasPrice = Number.isFinite(price) && price >= 0;
    const hasStock = Number.isSafeInteger(product.stock) && product.stock >= 0;
    const stock = hasStock ? `${product.stock} available` : "stock not set";
    option.textContent = `${product.product_name} · ${hasPrice ? money(price) : "price unavailable"} · ${stock}`;
    option.disabled = !hasPrice || !hasStock || product.stock === 0;
    productSelect.appendChild(option);
  });
  if (customers.some(customer => customer.id === selectedCustomer)) customerSelect.value = selectedCustomer;
  if (Array.from(productSelect.options).some(option => option.value === selectedProduct && !option.disabled)) {
    productSelect.value = selectedProduct;
  }
}

$("#order-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!access.createOrder || dashboardContent.hidden) return;

  const form = event.currentTarget;
  const message = $("#order-message");
  const button = form.querySelector("button");
  if (button.disabled) return;
  const version = dataVersion;
  const customer = customers.find(item => item.id === $("#order-customer").value);
  const product = products.find(item => item.id === $("#order-product").value);
  const quantity = Number($("#order-quantity").value);

  if (!customer || !product || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000000) {
    message.textContent = "Select a customer and product and enter a valid quantity.";
    return;
  }

  button.disabled = true;
  message.textContent = "Saving order…";

  try {
    const orderId = await createOrder(db, customer.id, product.id, quantity);

    if (version !== dataVersion) return;
    message.textContent = `Order saved. ID: ${orderId}`;
    form.reset();
  } catch (error) {
    if (version !== dataVersion) return;
    message.textContent = error.code === "permission-denied"
      ? "Firestore denied this order. Stock was not changed."
      : error.code ? "Could not save the order. Check your connection and try again." : error.message;
  } finally {
    button.disabled = false;
  }
});

function populateStockForm() {
  const select = $("#stock-product");
  const selected = select.value;
  select.replaceChildren(new Option("Select product", ""));
  if (!access.adjustStock) return;
  for (const product of products) {
    select.add(new Option(product.product_name, product.id));
  }
  if (products.some(product => product.id === selected)) select.value = selected;
  if ($("#stock-form").ariaBusy !== "true") {
    $("#stock-form button").disabled = !products.length;
  }
}

$("#stock-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!access.adjustStock || dashboardContent.hidden || form.ariaBusy === "true") return;

  const button = form.querySelector("button");
  const status = $("#stock-message");
  const productId = $("#stock-product").value;
  const change = $("#stock-adjustment").valueAsNumber;
  const version = dataVersion;

  if (!products.some(product => product.id === productId) || !Number.isSafeInteger(change) || change === 0) {
    status.textContent = "Select a product and enter a nonzero whole number.";
    return;
  }

  form.ariaBusy = "true";
  button.disabled = true;
  status.textContent = "Updating stock…";
  try {
    const stock = await adjustStock(db, productId, change);
    if (version !== dataVersion) return;
    status.textContent = `Stock updated to ${stock} units.`;
    form.reset();
  } catch (error) {
    if (version !== dataVersion) return;
    status.textContent = error.code === "permission-denied"
      ? "Your current access does not allow this stock change."
      : error.code ? "Could not update stock. Check your connection and try again." : error.message;
  } finally {
    form.ariaBusy = "false";
    button.disabled = !access.adjustStock || !products.length;
  }
});

function renderInventory() {
  const search = $("#inventory-search").value
    .toLowerCase()
    .trim();

  const filteredProducts = products.filter(product =>
    product.product_name.toLowerCase().includes(search) ||
    product.category.toLowerCase().includes(search)
  );

  const body = $("#inventory-body");
  body.replaceChildren();
  $("#inventory-empty").hidden = filteredProducts.length > 0;
  $("#inventory-empty").textContent = products.length
    ? "No products match your search."
    : "No products are available.";

  let lowStockCount = 0;

  for (const product of products) {
    if (!Number.isSafeInteger(product.stock) || product.stock <= 5) {
      lowStockCount++;
    }
  }

  $("#inventory-alert").textContent =
    `${lowStockCount} products need attention`;

  for (const product of filteredProducts) {
    const stock = product.stock;

    const status =
      !Number.isSafeInteger(stock) ? "Stock not set" :
      stock === 0 ? "Out of Stock" :
      stock <= 5 ? "Low Stock" :
      "In Stock";

    const row = document.createElement("tr");

    const values = [
      product.product_name,
      product.category,
      money(Number(product.price ?? product.unit_price)),
      Number.isSafeInteger(stock) ? stock.toLocaleString("en-US") : "—"
    ];

    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    }

    const statusCell = row.insertCell();
    const badge = document.createElement("span");
    badge.className = "stock-status";
    badge.dataset.attention = String(!Number.isSafeInteger(stock) || stock <= 5);
    badge.textContent = status;
    statusCell.appendChild(badge);
    body.appendChild(row);
  }
}

$("#inventory-search").addEventListener(
  "input",
  renderInventory
);
