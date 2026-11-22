
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
import { BarController, BarElement, CategoryScale, Chart, Filler, LineController, LineElement, LinearScale, PointElement, Tooltip } from "chart.js";
import { filterOrders, monthlyRevenue, months, orderYears, ordersCsv } from "./analytics.js";
import { createOrder } from "./orders.js";
import { adjustStock } from "./stock.js";

Chart.register(BarController, BarElement, CategoryScale, Filler, LineController, LineElement, LinearScale, PointElement, Tooltip);

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
let currentView;
let reportingPeriod = "";
let reportingOrderCount = 0;

const viewDetails = {
  overview: ["Overview", "Sales, orders, and customers for the selected period."],
  analytics: ["Sales analytics", "Compare monthly revenue and the top products by sales."],
  order: ["Orders", "Record a sale and its inventory deduction."],
  inventory: ["Inventory", "Review the product catalog and current stock."]
};

function showView(view, focusHeading = false) {
  const navigation = $(`[data-nav="${view}"]`);
  if (navigation.hidden) return;
  currentView = view;
  dashboardContent.dataset.view = view;
  document.querySelectorAll("[data-nav]").forEach(link => {
    if (link === navigation) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  const showAnalytics = view === "overview" || view === "analytics";
  $("#analytics").hidden = !showAnalytics;
  $("#order-entry").hidden = view !== "order";
  $("#inventory-view").hidden = view !== "inventory";
  const heading = $("#workspace-heading");
  heading.textContent = viewDetails[view][0];
  updateViewContext();
  if (!dashboardContent.hidden) updateWorkspaceSummary();
  if (focusHeading) {
    window.scrollTo(0, 0);
    heading.focus({ preventScroll: true });
  }
  if (showAnalytics) {
    salesChart?.resize();
    productsChart?.resize();
  }
}

function updateViewContext() {
  const subtitle = viewDetails[currentView]?.[1] ?? "";
  $("#overview-period").textContent = ["overview", "analytics"].includes(currentView) && reportingPeriod
    ? `${reportingPeriod} · ${subtitle}`
    : subtitle;
}

function updateWorkspaceSummary() {
  let summary = "";
  if (currentView === "inventory") {
    summary = `${products.length.toLocaleString("en-US")} ${products.length === 1 ? "product" : "products"} in catalog`;
  } else if (currentView === "overview" || currentView === "analytics") {
    summary = `${reportingOrderCount.toLocaleString("en-US")} ${reportingOrderCount === 1 ? "order" : "orders"} in period`;
  }
  $("#dashboard-status").textContent = summary;
}

document.querySelectorAll("[data-nav]").forEach(link => {
  link.addEventListener("click", () => showView(link.dataset.nav, true));
});

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
  reportingPeriod = "";
  reportingOrderCount = 0;
  currentView = undefined;
  $("#workspace-heading").textContent = "Workspace";
  updateViewContext();
  $("#category-filter").value = "all";
  $("#inventory-body").replaceChildren();
  for (const id of ["revenue", "orders", "average", "customers"]) {
    $(`#${id}`).textContent = "—";
  }
  populateCategories();
  populateOrderForm();
  populateStockForm();
}

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "AZN" });
const money = value => currency.format(value);

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = loginForm.querySelector("button");
  if (button.disabled) return;
  button.disabled = true;
  message.dataset.state = "pending";
  message.textContent = "Signing in…";

  try {
    await signInWithEmailAndPassword(
      auth,
      $("#email").value,
      $("#password").value
    );
    message.textContent = "";
  } catch {
    message.dataset.state = "error";
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
    $("#stock-form").closest(".stock-panel").hidden = !access.adjustStock;
    $("#export-csv").hidden = !access.export;
    $("[data-nav=overview]").hidden = !access.orders;
    $("[data-nav=analytics]").hidden = !access.orders;
    $("[data-nav=inventory]").hidden = false;
    $("[data-nav=order]").hidden = !access.createOrder;
    showView(access.orders ? "overview" : "inventory");
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
        else updateWorkspaceSummary();
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
  reportingPeriod = year ? period : "";
  updateViewContext();
  $("#sales-title").textContent = year ? `Revenue trend · ${period}` : "Revenue trend";

  const filtered = getFilteredOrders();

  const completed = filtered.filter(
    order => order.status === "Completed" && Number.isFinite(order.total_amount) && order.total_amount >= 0
  );

  const revenue = completed.reduce(
    (sum, order) => sum + Number(order.total_amount), 0
  );

  const average = completed.length
    ? revenue / completed.length
    : 0;

  const activeCustomers = new Set(
    filtered.map(order => order.customer_id).filter(id => typeof id === "string" && id.trim())
  ).size;

  $("#revenue").textContent = completed.length ? money(revenue) : "—";
  $("#orders").textContent = filtered.length.toLocaleString("en-US");
  $("#average").textContent = completed.length ? money(average) : "—";
  $("#customers").textContent = activeCustomers.toLocaleString("en-US");
  $("#export-csv").disabled = !filtered.length;
  $("#analytics-empty").hidden = Boolean(completed.length);
  $("#analytics-empty").textContent = filtered.length
    ? "No completed orders match this period and category."
    : "No orders match this period and category.";
  $("#analytics-charts").hidden = !completed.length;

  if (completed.length) {
    updateSalesChart(completed, month);
    updateProductsChart(completed);
  } else {
    salesChart?.destroy();
    productsChart?.destroy();
    salesChart = productsChart = null;
  }

  reportingOrderCount = filtered.length;
  updateWorkspaceSummary();
}

const compactAmount = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const chartAxis = {
  border: { display: false },
  grid: { color: "#24334b", drawTicks: false },
  ticks: { color: "#a1afc4", padding: 8, callback: value => compactAmount.format(value) },
  beginAtZero: true
};
const chartLabels = {
  border: { display: false },
  grid: { display: false },
  ticks: { color: "#a1afc4", padding: 8 }
};
const chartPlugins = {
  legend: { display: false },
  tooltip: {
    backgroundColor: "#233853",
    padding: 11,
    displayColors: false,
    callbacks: { label: item => money(item.raw) }
  }
};

function updateSalesChart(completed, month) {
  const monthly = monthlyRevenue(completed, month);

  if (salesChart) salesChart.destroy();

  salesChart = new Chart($("#sales-chart"), {
    type: "line",
    data: {
      labels: monthly.map(({ label }) => label.slice(0, 3)),
      datasets: [{
        label: "Completed sales",
        data: monthly.map(({ total }) => total),
        borderColor: "#64ddff",
        borderWidth: 2.5,
        pointRadius: monthly.length === 1 ? 5 : 2,
        pointHoverRadius: 5,
        pointBackgroundColor: "#64ddff",
        tension: 0.25,
        fill: true,
        backgroundColor: ({ chart }) => {
          const gradient = chart.ctx.createLinearGradient(0, 0, 0, chart.height || 240);
          gradient.addColorStop(0, "#2f8df879");
          gradient.addColorStop(1, "#2f8df805");
          return gradient;
        }
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { intersect: false, mode: "index" },
      scales: { x: chartLabels, y: chartAxis },
      plugins: chartPlugins
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
        backgroundColor: ["#a18bff", "#8276ee", "#686cd7", "#526cc6", "#496ab8"],
        hoverBackgroundColor: "#b8a5ff",
        maxBarThickness: 22,
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: { x: chartAxis, y: chartLabels },
      plugins: chartPlugins
    }
  });
}

$("#year-filter").addEventListener("change", updateDashboard);
$("#month-filter").addEventListener("change", updateDashboard);
$("#category-filter").addEventListener("change", () => {
  updateDashboard();
  renderInventory();
});

$("#export-csv").addEventListener("click", () => {
  if (!access.export || dashboardContent.hidden || $("#export-csv").disabled) return;
  const filtered = getFilteredOrders();

  const csv = ordersCsv(filtered);

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

  const customerQuery = $("#customer-search").value.trim().toLowerCase();
  const productQuery = $("#product-search").value.trim().toLowerCase();
  const selectedCustomer = customerSelect.value;
  const selectedProduct = productSelect.value;
  customerSelect.innerHTML =
    '<option value="">Select Customer</option>';

  productSelect.innerHTML =
    '<option value="">Select Product</option>';

  customers.forEach(customer => {
    const name = customer.customer_name || customer.name || customer.customer_id;
    if (!`${name} ${customer.customer_id}`.toLowerCase().includes(customerQuery)) return;
    const option = document.createElement("option");
    option.value = customer.id;
    option.textContent = name;
    customerSelect.appendChild(option);
  });

  products.forEach(product => {
    if (!`${product.product_name} ${product.product_id}`.toLowerCase().includes(productQuery)) return;
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
  if (Array.from(customerSelect.options).some(option => option.value === selectedCustomer)) {
    customerSelect.value = selectedCustomer;
  }
  if (Array.from(productSelect.options).some(option => option.value === selectedProduct && !option.disabled)) {
    productSelect.value = selectedProduct;
  }
  customerSelect.options[0].textContent = customerSelect.options.length > 1 ? "Select customer" : "No matching customers";
  productSelect.options[0].textContent = productSelect.options.length > 1 ? "Select product" : "No matching products";
  updateOrderProductDetail();
}

function updateOrderProductDetail() {
  const product = products.find(item => item.id === $("#order-product").value);
  const quantity = $("#order-quantity").valueAsNumber;
  const price = product?.price ?? product?.unit_price;
  const validQuantity = Number.isInteger(quantity) && quantity > 0 && quantity <= 1000000;
  const cents = price * quantity * 100;
  const total = validQuantity && cents <= Number.MAX_SAFE_INTEGER
    ? ` · ${money(Math.round(cents) / 100)} total` : "";
  $("#order-product-detail").textContent = product
    ? `${money(price)} per unit · ${product.stock.toLocaleString("en-US")} available${total}`
    : "Select a product to see its price and available stock.";
}

$("#customer-search").addEventListener("input", populateOrderForm);
$("#product-search").addEventListener("input", populateOrderForm);
$("#order-product").addEventListener("change", updateOrderProductDetail);
$("#order-quantity").addEventListener("input", updateOrderProductDetail);

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
    message.dataset.state = "error";
    message.textContent = "Select a customer and product and enter a valid quantity.";
    return;
  }

  button.disabled = true;
  message.dataset.state = "pending";
  message.textContent = "Saving order…";

  try {
    const orderId = await createOrder(db, customer.id, product.id, quantity);

    if (version !== dataVersion) return;
    message.dataset.state = "success";
    message.textContent = `Order saved. ID: ${orderId}`;
    form.reset();
    populateOrderForm();
  } catch (error) {
    if (version !== dataVersion) return;
    message.dataset.state = "error";
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
    status.dataset.state = "error";
    status.textContent = "Select a product and enter a nonzero whole number.";
    return;
  }

  form.ariaBusy = "true";
  button.disabled = true;
  status.dataset.state = "pending";
  status.textContent = "Updating stock…";
  try {
    const stock = await adjustStock(db, productId, change);
    if (version !== dataVersion) return;
    status.dataset.state = "success";
    status.textContent = `Stock updated to ${stock} units.`;
    form.reset();
  } catch (error) {
    if (version !== dataVersion) return;
    status.dataset.state = "error";
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

  const category = access.orders ? $("#category-filter").value : "all";
  const clearCategory = $("#clear-inventory-category");
  clearCategory.hidden = category === "all";
  clearCategory.textContent = `Clear category: ${category}`;
  const filteredProducts = products.filter(product =>
    (category === "all" || product.category === category) &&
    [product.product_name, product.category].some(value =>
      String(value ?? "").toLowerCase().includes(search)
    )
  );

  const body = $("#inventory-body");
  body.replaceChildren();
  $("#inventory-empty").hidden = filteredProducts.length > 0;
  $("#inventory-empty").textContent = products.length
    ? "No products match your search or category."
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

    const price = product.price ?? product.unit_price;
    const values = [
      product.product_name,
      product.category,
      Number.isFinite(price) && price >= 0 ? money(price) : "—",
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


$("#clear-inventory-category").addEventListener("click", () => {
  $("#category-filter").value = "all";
  $("#category-filter").dispatchEvent(new Event("change"));
  $("#inventory-search").focus();
});
