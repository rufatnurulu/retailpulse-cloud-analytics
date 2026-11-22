import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from "firebase/firestore";
import { createOrder } from "../frontend/js/orders.js";
import { adjustStock } from "../frontend/js/stock.js";

const projectId = "demo-retailpulse";
let environment;

const roles = ["admin", "sales", "inventory", "analyst"];
const dbFor = uid => environment.authenticatedContext(uid).firestore();

before(async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^(127\.0\.0\.1|localhost):\d+$/);
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync("firestore.rules", "utf8") }
  });
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const batch = writeBatch(db);
    for (const role of roles) batch.set(doc(db, "users", role), { role, active: true });
    batch.set(doc(db, "users", "inactive"), { role: "admin", active: false });
    batch.set(doc(db, "users", "invalid"), { role: "owner", active: true });
    batch.set(doc(db, "users", "missing-role"), { active: true });
    batch.set(doc(db, "users", "missing-active"), { role: "admin" });
    batch.set(doc(db, "users", "invalid-active"), { role: "admin", active: "true" });
    batch.set(doc(db, "users", "invalid-role-type"), { role: ["admin"], active: true });
    batch.set(doc(db, "customers", "customer-doc"), { customer_id: "C0001" });
    batch.set(doc(db, "products", "legacy-price"), {
      product_id: "P003", price: null, unit_price: 1.236, stock: 4
    });
    batch.set(doc(db, "products", "product-doc"), { product_id: "P001", price: 1.99, stock: 12 });
    batch.set(doc(db, "products", "limited"), { product_id: "P004", price: 5, stock: 3 });
    batch.set(doc(db, "products", "legacy"), { product_id: "P002", unit_price: 2 });
    batch.set(doc(db, "orders", "historical"), { order_id: "historical", order_date: "2025-01-01" });
    await batch.commit();
  });
});

after(async () => {
  await environment?.cleanup();
});

test("collection reads follow the active workspace role", async () => {
  const readable = {
    admin: ["products", "customers", "orders"],
    sales: ["products", "customers", "orders"],
    inventory: ["products"],
    analyst: ["products", "orders"]
  };
  const profiles = [...roles, "inactive", "missing", "invalid", "invalid-active", "invalid-role-type", "anonymous"];
  for (const role of profiles) {
    const db = role === "anonymous" ? environment.unauthenticatedContext().firestore() : dbFor(role);
    for (const name of ["products", "customers", "orders"]) {
      const check = readable[role]?.includes(name) ? assertSucceeds : assertFails;
      await check(getDocs(collection(db, name)));
    }
  }
});

test("profiles are private and app clients cannot change roles", async () => {
  const sales = dbFor("sales");
  const admin = dbFor("admin");
  await assertSucceeds(getDoc(doc(sales, "users", "sales")));
  await assertFails(getDoc(doc(sales, "users", "admin")));
  await assertFails(getDocs(collection(admin, "users")));
  await assertFails(updateDoc(doc(sales, "users", "sales"), { role: "admin" }));
  await assertFails(updateDoc(doc(admin, "users", "sales"), { role: "admin" }));
  await assertFails(setDoc(doc(dbFor("missing"), "users", "missing"), { role: "admin", active: true }));
});

function orderData(id, changes) {
  return {
    order_id: id,
    customer_id: "C0001",
    customer_doc_id: "customer-doc",
    product_id: "P001",
    product_doc_id: "product-doc",
    order_date: new Date().toISOString().slice(0, 10),
    created_at: serverTimestamp(),
    quantity: 2,
    unit_price: 1.99,
    total_amount: 3.98,
    status: "Completed",
    ...changes
  };
}

function placeOrder(db, id, stock, changes) {
  const batch = writeBatch(db);
  batch.update(doc(db, "products", "product-doc"), { stock, last_order_id: id });
  batch.set(doc(db, "orders", id), orderData(id, changes));
  return batch.commit();
}

test("sales can only deduct stock in a valid, atomic order", async () => {
  const db = dbFor("sales");
  const product = doc(db, "products", "product-doc");
  await assertFails(updateDoc(product, { stock: 10 }));
  await assertFails(updateDoc(product, { stock: 10, last_order_id: "missing-order" }));
  await assertFails(setDoc(doc(db, "orders", "order-only"), orderData("order-only")));
  await assertFails(setDoc(doc(dbFor("admin"), "orders", "admin-order-only"), orderData("admin-order-only")));
  await assertFails(placeOrder(db, "invalid-price", 10, { unit_price: 1, total_amount: 2 }));
  await assertFails(placeOrder(db, "invalid-total", 10, { total_amount: 3.97 }));
  await assertFails(placeOrder(db, "invalid-customer", 10, { customer_id: "C0002" }));
  await assertFails(placeOrder(db, "invalid-date", 10, { order_date: "not-a-date" }));
  await assertFails(placeOrder(db, "backdated", 10, { order_date: "2025-01-01" }));
  await assertFails(placeOrder(db, "invalid-timestamp", 10, { created_at: Timestamp.fromMillis(0) }));
  await assertFails(placeOrder(db, "invalid-customer-ref", 10, { customer_doc_id: "missing" }));
  await assertFails(placeOrder(db, "unrounded", 10, { total_amount: 3.981 }));
  await assertFails(placeOrder(db, "invalid-quantity", 9));
  await assertFails(placeOrder(db, "oversold", -1, { quantity: 13, total_amount: 25.87 }));
  await assertFails(placeOrder(dbFor("inventory"), "inventory-order", 10));
  await assertFails(placeOrder(dbFor("analyst"), "analyst-order", 10));
  await assertFails(placeOrder(dbFor("missing-role"), "missing-role-order", 10));
  await assertFails(placeOrder(dbFor("missing-active"), "missing-active-order", 10));
  await assertFails(placeOrder(dbFor("invalid-role-type"), "invalid-role-type-order", 10));
  await assertFails(placeOrder(dbFor("invalid-active"), "invalid-active-order", 10));
  assert.equal((await getDoc(product)).data().stock, 12);
  assert.equal((await getDoc(doc(db, "orders", "invalid-price"))).exists(), false);
  assert.equal((await getDoc(doc(db, "orders", "historical"))).data().order_date, "2025-01-01");
  await assertSucceeds(placeOrder(db, "sales-order", 10));
  await assertFails(updateDoc(product, { stock: 8, last_order_id: "sales-order" }));
  assert.equal((await getDoc(product)).data().stock, 10);
  await assertSucceeds(placeOrder(dbFor("admin"), "admin-order", 8));
});

test("the frontend order transaction handles legacy prices and document IDs", async () => {
  const db = dbFor("sales");
  const id = await assertSucceeds(createOrder(db, "customer-doc", "legacy-price", 3));
  const order = (await getDoc(doc(db, "orders", id))).data();
  assert.equal(order.customer_id, "C0001");
  assert.equal(order.customer_doc_id, "customer-doc");
  assert.equal(order.product_id, "P003");
  assert.equal(order.product_doc_id, "legacy-price");
  assert.equal(order.unit_price, 1.236);
  assert.equal(order.total_amount, 3.71);
  assert.equal(order.created_at.toDate().toISOString().slice(0, 10), order.order_date);
  const product = (await getDoc(doc(db, "products", "legacy-price"))).data();
  assert.equal(product.stock, 1);
  assert.equal(product.last_order_id, id);
  await assert.rejects(createOrder(db, "customer-doc", "legacy-price", 2), /Only 1 units available/);
});

test("concurrent orders cannot oversell or create a partial order", async () => {
  const db = dbFor("sales");
  const attempts = await Promise.allSettled([
    createOrder(db, "customer-doc", "limited", 2),
    createOrder(db, "customer-doc", "limited", 2)
  ]);
  const successful = attempts.filter(result => result.status === "fulfilled");
  assert.equal(successful.length, 1);
  const failed = attempts.find(result => result.status === "rejected");
  if (failed.reason.code) assert.equal(failed.reason.code, "permission-denied");
  else assert.match(failed.reason.message, /Only 1 units available/);
  const stock = (await getDoc(doc(db, "products", "limited"))).data();
  assert.equal(stock.stock, 1);
  assert.equal(stock.last_order_id, successful[0].value);
  const orders = await getDocs(collection(db, "orders"));
  assert.equal(orders.docs.filter(order => order.data().product_doc_id === "limited").length, 1);
});

test("inventory managers can adjust stock independently and preserve sale and catalog fields", async () => {
  const db = dbFor("inventory");
  const product = doc(db, "products", "product-doc");
  const before = (await getDoc(product)).data();

  await assertSucceeds(adjustStock(db, "product-doc", 4));
  await assertSucceeds(adjustStock(db, "product-doc", -2));
  assert.deepEqual((await getDoc(product)).data(), { ...before, stock: before.stock + 2 });

  const legacy = doc(db, "products", "legacy");
  await assertSucceeds(adjustStock(db, "legacy", 5));
  await Promise.all([adjustStock(db, "legacy", 2), adjustStock(db, "legacy", 3)]);
  assert.equal((await getDoc(legacy)).data().stock, 10);
  await assert.rejects(adjustStock(db, "legacy", -11), /invalid stock level/);
  await assertSucceeds(adjustStock(dbFor("admin"), "legacy", -10));
  assert.equal((await getDoc(legacy)).data().stock, 0);
});

test("stock rules reject invalid values, other field changes, and unauthorized roles", async () => {
  const inventory = dbFor("inventory");
  const product = doc(inventory, "products", "product-doc");
  for (const stock of [-1, 1.5, "2", 9007199254740992]) {
    await assertFails(updateDoc(product, { stock }));
  }
  await assertFails(updateDoc(product, { stock: 5, price: 0 }));
  await assertFails(updateDoc(product, { stock: 5, last_order_id: "replace" }));
  await assertFails(setDoc(doc(inventory, "products", "new"), { stock: 5 }));
  for (const role of ["sales", "analyst", "inactive", "missing", "missing-active", "missing-role"]) {
    await assertFails(adjustStock(dbFor(role), "product-doc", 1));
  }
});

test("business data edits and deletions are denied", async () => {
  const admin = dbFor("admin");
  await assertFails(updateDoc(doc(admin, "orders", "historical"), { status: "Returned" }));
  await assertFails(deleteDoc(doc(admin, "orders", "historical")));
  await assertFails(deleteDoc(doc(admin, "products", "legacy")));
  await assertFails(deleteDoc(doc(admin, "customers", "customer-doc")));
});

test("deactivating a profile revokes order access for an existing session", async () => {
  const db = dbFor("sales");
  await assertSucceeds(getDocs(collection(db, "customers")));
  await environment.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), "users", "sales"), { active: false });
  });
  await assertFails(getDocs(collection(db, "customers")));
  await assertFails(placeOrder(db, "revoked-order", 6));
  await assertFails(createOrder(db, "customer-doc", "legacy-price", 1));
});

test("an inventory manager loses stock permissions when the profile is deactivated", async () => {
  const db = dbFor("inventory");
  await assertSucceeds(adjustStock(db, "legacy", 1));
  await environment.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), "users", "inventory"), { active: false });
  });
  await assertFails(adjustStock(db, "legacy", 1));
});
