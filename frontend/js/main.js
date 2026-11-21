
import { auth, db } from "./firebase.js";

import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "firebase/auth";

import {
  collection,
  getDocs
} from "firebase/firestore";

import Chart from "chart.js/auto";

const loginForm = document.querySelector("#login-form");
const loginSection = document.querySelector("#login-section");
const dashboard = document.querySelector("#dashboard");
const message = document.querySelector("#message");
const logoutButton = document.querySelector("#logout");

let salesChart = null;

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  message.textContent = "Signing in...";

  try {
    await signInWithEmailAndPassword(
      auth,
      document.querySelector("#email").value,
      document.querySelector("#password").value
    );

    message.textContent = "";
  } catch (error) {
    message.textContent = "Login failed. Check your credentials.";
    console.error(error.code);
  }
});

logoutButton.addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    loginSection.hidden = false;
    dashboard.hidden = true;
    return;
  }

  loginSection.hidden = true;
  dashboard.hidden = false;

  try {
    await loadDashboard();
  } catch (error) {
    document.querySelector("#dashboard-status").textContent =
      "Could not load dashboard data.";
    console.error(error);
  }
});

async function loadDashboard() {
  const [customersSnapshot, productsSnapshot, ordersSnapshot] =
    await Promise.all([
      getDocs(collection(db, "customers")),
      getDocs(collection(db, "products")),
      getDocs(collection(db, "orders"))
    ]);

  const orders = ordersSnapshot.docs.map(doc => doc.data());

  const completed = orders.filter(
    order => order.status === "Completed"
  );

  const revenue = completed.reduce(
    (sum, order) => sum + Number(order.total_amount), 0
  );

  const average = completed.length
    ? revenue / completed.length
    : 0;

  const money = value =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "AZN"
    }).format(value);

  document.querySelector("#revenue").textContent = money(revenue);
  document.querySelector("#orders").textContent = orders.length;
  document.querySelector("#average").textContent = money(average);
  document.querySelector("#customers").textContent =
    customersSnapshot.size;

  const monthly = Array(12).fill(0);

  completed.forEach(order => {
    const month = Number(order.order_date.slice(5, 7)) - 1;
    if (month >= 0 && month < 12) {
      monthly[month] += Number(order.total_amount);
    }
  });

  if (salesChart) salesChart.destroy();

  salesChart = new Chart(
    document.querySelector("#sales-chart"),
    {
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
    }
  );

  document.querySelector("#dashboard-status").textContent =
    `${ordersSnapshot.size} orders and ${productsSnapshot.size} products loaded`;
}
