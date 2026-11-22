import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";

export async function createOrder(db, customerDocId, productDocId, quantity) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000000) {
    throw new Error("Enter a whole number between 1 and 1,000,000.");
  }

  const customerRef = doc(db, "customers", customerDocId);
  const productRef = doc(db, "products", productDocId);
  const orderRef = doc(collection(db, "orders"));
  await runTransaction(db, async transaction => {
    const customer = (await transaction.get(customerRef)).data();
    const product = (await transaction.get(productRef)).data();
    if (!customer || !product) throw new Error("The customer or product is no longer available.");

    const { stock } = product;
    const price = product.price ?? product.unit_price;
    if (!Number.isSafeInteger(stock) || stock < 0) throw new Error("Stock has not been set for this product.");
    if (stock < quantity) throw new Error(`Only ${stock} units available.`);
    if (!Number.isFinite(price) || price < 0) throw new Error("Invalid product price.");
    const cents = price * quantity * 100;
    if (cents > Number.MAX_SAFE_INTEGER) throw new Error("The order total is too large.");

    transaction.update(productRef, { stock: stock - quantity, last_order_id: orderRef.id });
    transaction.set(orderRef, {
      order_id: orderRef.id,
      customer_id: customer.customer_id,
      customer_doc_id: customerDocId,
      product_id: product.product_id,
      product_doc_id: productDocId,
      order_date: new Date().toISOString().slice(0, 10),
      created_at: serverTimestamp(),
      quantity,
      unit_price: price,
      total_amount: Math.round(cents) / 100,
      status: "Completed"
    });
  });
  return orderRef.id;
}
