import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch } from "firebase/firestore";

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
    batch.set(doc(db, "customers", "C0001"), { customer_id: "C0001" });
    batch.set(doc(db, "products", "product-doc"), { product_id: "P001", price: 1.99, stock: 12 });
    batch.set(doc(db, "products", "legacy"), { product_id: "P002", unit_price: 2 });
    batch.set(doc(db, "orders", "historical"), { order_id: "historical", order_date: "2025-01-01" });
    await batch.commit();
  });
});

after(async () => {
  await environment?.cleanup();
});

const readsByRole = {
  admin: ["products", "customers", "orders"],
  sales: ["products", "customers", "orders"],
  inventory: ["products", "customers", "orders"],
  analyst: ["products", "customers", "orders"],
  inactive: [],
  invalid: [],
  missing: [],
  "missing-role": [],
  "missing-active": [],
  "invalid-active": [],
  anonymous: []
};

for (const [role, readable] of Object.entries(readsByRole)) {
  test(`${role} can read only the permitted collections`, async () => {
    const db = role === "anonymous" ? environment.unauthenticatedContext().firestore() : dbFor(role);
    for (const name of ["products", "customers", "orders"]) {
      const expect = readable.includes(name) ? assertSucceeds : assertFails;
      await expect(getDocs(collection(db, name)));
    }
  });
}

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
    product_id: "P001",
    product_doc_id: "product-doc",
    order_date: new Date().toISOString().slice(0, 10),
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
  await assertFails(placeOrder(db, "invalid-price", 10, { unit_price: 1, total_amount: 2 }));
  await assertFails(placeOrder(db, "invalid-total", 10, { total_amount: 3.97 }));
  await assertFails(placeOrder(db, "invalid-customer", 10, { customer_id: "C0002" }));
  await assertFails(placeOrder(db, "invalid-date", 10, { order_date: "not-a-date" }));
  await assertFails(placeOrder(db, "invalid-quantity", 9));
  await assertFails(placeOrder(db, "oversold", -1, { quantity: 13, total_amount: 25.87 }));
  await assertFails(placeOrder(dbFor("inventory"), "inventory-order", 10));
  await assertFails(placeOrder(dbFor("analyst"), "analyst-order", 10));
  await assertFails(placeOrder(dbFor("missing-role"), "missing-role-order", 10));
  await assertFails(placeOrder(dbFor("missing-active"), "missing-active-order", 10));
  assert.equal((await getDoc(product)).data().stock, 12);
  await assertSucceeds(placeOrder(db, "sales-order", 10));
  await assertFails(updateDoc(product, { stock: 8, last_order_id: "sales-order" }));
  assert.equal((await getDoc(product)).data().stock, 10);
  await assertSucceeds(placeOrder(dbFor("admin"), "admin-order", 8));
});

test("standalone stock changes, business data edits, and deletions are denied", async () => {
  for (const role of roles) {
    await assertFails(updateDoc(doc(dbFor(role), "products", "product-doc"), { stock: 10 }));
  }
  const admin = dbFor("admin");
  await assertFails(updateDoc(doc(admin, "orders", "historical"), { status: "Returned" }));
  await assertFails(deleteDoc(doc(admin, "orders", "historical")));
  await assertFails(deleteDoc(doc(admin, "products", "legacy")));
  await assertFails(deleteDoc(doc(admin, "customers", "C0001")));
});

test("deactivating a profile immediately removes Firestore access for an existing session", async () => {
  const db = dbFor("sales");
  await assertSucceeds(getDocs(collection(db, "customers")));
  await environment.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), "users", "sales"), { active: false });
  });
  await assertFails(getDocs(collection(db, "customers")));
  await assertFails(placeOrder(db, "revoked-order", 6));
});
