
import csv
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore

ROOT = Path(__file__).resolve().parent.parent
KEY_PATH = ROOT / "firebase" / "serviceAccountKey.json"
DATA_DIR = ROOT / "data"

cred = credentials.Certificate(str(KEY_PATH))
firebase_admin.initialize_app(cred)

db = firestore.client()

def upload_collection(collection_name, filename, id_field):
    file_path = DATA_DIR / filename

    with open(file_path, newline="", encoding="utf-8") as file:
        reader = csv.DictReader(file)
        rows = list(reader)

    total = len(rows)

    for start in range(0, total, 400):
        batch = db.batch()
        chunk = rows[start:start + 400]

        for row in chunk:
            document_id = row[id_field]

            if collection_name == "products":
                row["price"] = float(row["price"])

            if collection_name == "orders":
                row["quantity"] = int(row["quantity"])
                row["unit_price"] = float(row["unit_price"])
                row["total_amount"] = float(row["total_amount"])

            doc_ref = db.collection(
                collection_name
            ).document(document_id)

            batch.set(doc_ref, row)

        batch.commit()

    print(f"{collection_name}: {total} documents uploaded")

upload_collection("customers", "customers.csv", "customer_id")
upload_collection("products", "products.csv", "product_id")
upload_collection("orders", "orders.csv", "order_id")

print("RetailPulse Firestore upload completed!")
