import { doc, runTransaction } from "firebase/firestore";

export function adjustStock(db, productId, change) {
  if (!Number.isSafeInteger(change) || change === 0) {
    throw new Error("Enter a nonzero whole number.");
  }

  const product = doc(db, "products", productId);
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(product);
    if (!snapshot.exists()) throw new Error("This product is no longer available.");

    const current = snapshot.data().stock ?? 0;
    if (!Number.isSafeInteger(current) || current < 0) {
      throw new Error("The current stock value is invalid.");
    }

    const next = current + change;
    if (!Number.isSafeInteger(next) || next < 0) {
      throw new Error("The adjustment would leave an invalid stock level.");
    }

    transaction.update(product, { stock: next });
    return next;
  });
}
