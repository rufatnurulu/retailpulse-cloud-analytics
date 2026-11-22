
import { auth, db } from "./firebase.js";

import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "firebase/auth";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction
} from "firebase/firestore";
import Chart from "chart.js/auto";

const $ = selector => document.querySelector(selector);

const loginForm = $("#login-form");
const loginSection = $("#login-section");
const dashboard = $("#dashboard");
const message = $("#message");

let orders = [];
let products = [];
let customers = [];
let salesChart = null;
let productsChart = null;
let loadVersion = 0;
let unsubscribeOrders = null;

let unsubscribeProducts = null;
let currentUserRole = null;

async function loadUserRole(user) {
  const snapshot = await getDoc(doc(db, "users", user.uid));
  if (!snapshot.exists()) throw new Error("User profile not found.");
  const profile = snapshot.data();
  if (profile.active !== true ||
      !["admin", "sales", "inventory", "analyst"].includes(profile.role)) {
    throw new Error("Invalid or inactive user profile.");
  }
  return profile.role;
}

function applyRoleToUI() {
  const canOrder = ["admin", "sales"].includes(currentUserRole);
  $("#order-form").closest(".order-panel").hidden = !canOrder;
  $("#export-csv").hidden = !["admin", "analyst"].includes(currentUserRole);
  const badge = $("#user-role");
  if (badge) badge.textContent = currentUserRole || "";
}

const money = value =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "AZN"
  }).format(value);

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  message.textContent = "Signing in...";

  try {
    await signInWithEmailAndPassword(
      auth,
      $("#email").value,
      $("#password").value
    );
    message.textContent = "";
  } catch (error) {
    message.textContent = "Login failed. Check your credentials.";
    console.error(error.code);
  }
});

$("#logout").addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, async user => {
  const version = ++loadVersion;
  currentUserRole = null;

  if (unsubscribeOrders) {
    unsubscribeOrders();
    unsubscribeOrders = null;
  }
  if (unsubscribeProducts) {
  unsubscribeProducts();
  unsubscribeProducts = null;
  }
  if (!user) {
    loginSection.hidden = false;
    dashboard.hidden = true;
    orders = [];
    products = [];
    customers = [];
    return;
  }

  loginSection.hidden = true;
  dashboard.hidden = false;
  $("#dashboard-status").textContent = "Loading data...";

  try {
    currentUserRole = await loadUserRole(user);
    if (version !== loadVersion || !auth.currentUser) return;
    applyRoleToUI();

    const customerDocs = await getDocs(
  collection(db, "customers")
);
    if (version !== loadVersion || !auth.currentUser) return;

    customers = customerDocs.docs.map(doc => doc.data());
    unsubscribeProducts = onSnapshot(
  collection(db, "products"),
  snapshot => {
    if (version !== loadVersion || !auth.currentUser) return;

    products = snapshot.docs.map(doc => ({
      ...doc.data(),
      id: doc.id
    }));

    populateCategories();
    populateOrderForm();
    renderInventory();
    updateDashboard();
  },
  error => {
    console.error("Products sync error:", error);
    $("#dashboard-status").textContent =
      "Unable to synchronize inventory.";
  }
);
unsubscribeOrders = onSnapshot(
  collection(db, "orders"),
  snapshot => {
    if (version !== loadVersion || !auth.currentUser) return;

    orders = snapshot.docs.map(doc => ({
      ...doc.data(),
      id: doc.id
    }));

    updateDashboard();
  },
  error => {
    console.error("Realtime Firestore error:", error);
    $("#dashboard-status").textContent =
      "Unable to synchronize orders.";
  }
);
    populateCategories();
    populateOrderForm();
    renderInventory();
    updateDashboard();
  } catch (error) {
    if (version !== loadVersion) return;
    $("#dashboard-status").textContent =
      error.message || "Failed to load Firestore data.";
    $("#order-form").closest(".order-panel").hidden = true;
    console.error(error);
  }
});

function populateCategories() {
  const categories = [
    ...new Set(products.map(product => product.category))
  ].sort();

  $("#category-filter").innerHTML =
    '<option value="all">All Categories</option>';

  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    $("#category-filter").appendChild(option);
  }
}

function getFilteredOrders() {
  const month = $("#month-filter").value;
  const category = $("#category-filter").value;

  const productMap = new Map(
    products.map(product => [product.product_id, product])
  );

  return orders.filter(order => {
    const matchesMonth =
      month === "all" || order.order_date.slice(5, 7) === month;

    const product = productMap.get(order.product_id);

    const matchesCategory =
      category === "all" || product?.category === category;

    return matchesMonth && matchesCategory;
  });
}

function updateDashboard() {
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

  $("#revenue").textContent = money(revenue);
  $("#orders").textContent = filtered.length;
  $("#average").textContent = money(average);
  $("#customers").textContent = activeCustomers;

  updateSalesChart(completed);
  updateProductsChart(completed);

  $("#dashboard-status").textContent =
    `${filtered.length} filtered orders · ${products.length} products · ${customers.length} registered customers`;
}

function updateSalesChart(completed) {
  const monthly = Array(12).fill(0);

  for (const order of completed) {
    const month = Number(order.order_date.slice(5, 7)) - 1;

    if (month >= 0 && month < 12) {
      monthly[month] += Number(order.total_amount);
    }
  }

  if (salesChart) salesChart.destroy();

  salesChart = new Chart($("#sales-chart"), {
    type: "bar",
    data: {
      labels: [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
      ],
      datasets: [{
        label: "Completed Sales (AZN)",
        data: monthly,
        backgroundColor: "#2563eb",
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false
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
        backgroundColor: "#0d9488",
        borderRadius: 6
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false
    }
  });
}

$("#month-filter").addEventListener("change", updateDashboard);
$("#category-filter").addEventListener("change", updateDashboard);

$("#export-csv").addEventListener("click", () => {
  const filtered = getFilteredOrders();

  const columns = [
    "order_id", "customer_id", "product_id",
    "order_date", "quantity", "unit_price",
    "total_amount", "status"
  ];

  const escapeCsv = value =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;

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

  customerSelect.innerHTML =
    '<option value="">Select Customer</option>';

  productSelect.innerHTML =
    '<option value="">Select Product</option>';

  customers.forEach(customer => {
    const option = document.createElement("option");
    option.value = customer.customer_id;
    option.textContent =
      customer.customer_name || customer.name || customer.customer_id;
    customerSelect.appendChild(option);
  });

  products.forEach(product => {
    const option = document.createElement("option");
    option.value = product.product_id;
    option.textContent =
      `${product.product_name} — ${money(Number(product.price ?? product.unit_price))}`;
    productSelect.appendChild(option);
  });
}

$("#order-form").addEventListener("submit", async event => {
  event.preventDefault();

  if (!["admin", "sales"].includes(currentUserRole)) {
    $("#order-message").textContent = "Your role cannot create orders.";
    return;
  }

  const message = $("#order-message");
  const button = $("#order-form button");

  const customerId = $("#order-customer").value;
  const productId = $("#order-product").value;
  const quantity = Number($("#order-quantity").value);

  const product = products.find(
    item => item.product_id === productId
  );

  const customerExists = customers.some(
    item => item.customer_id === customerId
  );

  const unitPrice = Number(product?.price ?? product?.unit_price);

  if (
    !auth.currentUser ||
    !customerExists ||
    !product ||
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(unitPrice) ||
    unitPrice < 0
  ) {
    message.textContent = "Please enter valid order details.";
    return;
  }

  button.disabled = true;
  message.textContent = "Saving to Firestore...";

  try {
  const productRef = doc(db, "products", product.id);
  const orderRef = doc(collection(db, "orders"));

  await runTransaction(db, async (transaction) => {
    const productSnapshot = await transaction.get(productRef);

    if (!productSnapshot.exists()) {
      throw new Error("Product not found.");
    }

    const currentProduct = productSnapshot.data();
    const currentStock = Number(currentProduct.stock);
    const currentPrice = Number(
      currentProduct.price ?? currentProduct.unit_price
    );

    if (!Number.isSafeInteger(currentStock) || currentStock < 0) {
      throw new Error("Invalid product stock.");
    }

    if (currentStock < quantity) {
      throw new Error(
        `Insufficient stock! Only ${currentStock} units available.`
      );
    }

    if (!Number.isFinite(currentPrice) || currentPrice < 0) {
      throw new Error("Invalid product price.");
    }

    const newStock = currentStock - quantity;

    transaction.update(productRef, {
      stock: newStock
    });

    transaction.set(orderRef, {
      order_id: crypto.randomUUID(),
      customer_id: customerId,
      product_id: productId,
      order_date: new Date().toISOString().slice(0, 10),
      quantity: quantity,
      unit_price: currentPrice,
      total_amount: Number((quantity * currentPrice).toFixed(2)),
      status: "Completed"
    });
  });

  message.textContent =
    `Order created successfully! ID: ${orderRef.id}`;

  $("#order-form").reset();
  } catch (error) {
    console.error("Firestore create error:", error);
    message.textContent =
      `Failed to create order: ${error.code || error.message}`;
  } finally {
    button.disabled = false;
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

  let lowStockCount = 0;

  for (const product of products) {
    if (Number(product.stock) <= 5) {
      lowStockCount++;
    }
  }

  $("#inventory-alert").textContent =
    `${lowStockCount} products need attention`;

  for (const product of filteredProducts) {
    const stock = Number(product.stock);

    const status =
      stock === 0 ? "Out of Stock" :
      stock <= 5 ? "Low Stock" :
      "In Stock";

    const row = document.createElement("tr");

    const values = [
      product.product_name,
      product.category,
      money(Number(product.price)),
      String(stock),
      status
    ];

    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    }

    body.appendChild(row);
  }
}

$("#inventory-search").addEventListener(
  "input",
  renderInventory
);
