
import csv
import random
from pathlib import Path
from datetime import datetime, timedelta
from faker import Faker

fake = Faker()
Faker.seed(42)
random.seed(42)

OUTPUT = Path("data")
OUTPUT.mkdir(exist_ok=True)

def save_csv(filename, rows):
    with open(OUTPUT / filename, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)

# 250 customers
customers = []

for i in range(1, 251):
    customers.append({
        "customer_id": f"C{i:04d}",
        "name": fake.name(),
        "email": f"customer{i}@example.com",
        "city": random.choice([
            "Baku", "Ganja", "Sumqayit",
            "Lankaran", "Shaki"
        ]),
        "segment": random.choice([
            "Regular", "Premium", "New"
        ])
    })

# 40 products
categories = {
    "Electronics": (100, 2000),
    "Clothing": (20, 250),
    "Home": (15, 500),
    "Beauty": (10, 150)
}

products = []

for i in range(1, 41):
    category = list(categories)[(i - 1) % 4]
    low, high = categories[category]

    products.append({
        "product_id": f"P{i:03d}",
        "product_name": f"{category} Product {i}",
        "category": category,
        "price": round(random.uniform(low, high), 2)
    })

# 1500 orders
orders = []
start_date = datetime(2025, 1, 1)

for i in range(1, 1501):
    product = random.choice(products)
    customer = random.choice(customers)
    quantity = random.randint(1, 5)
    price = product["price"]

    orders.append({
        "order_id": f"O{i:05d}",
        "customer_id": customer["customer_id"],
        "product_id": product["product_id"],
        "order_date": (
            start_date + timedelta(
                days=random.randint(0, 364)
            )
        ).strftime("%Y-%m-%d"),
        "quantity": quantity,
        "unit_price": price,
        "total_amount": round(quantity * price, 2),
        "status": random.choices(
            ["Completed", "Cancelled", "Returned"],
            weights=[90, 6, 4]
        )[0]
    })

save_csv("customers.csv", customers)
save_csv("products.csv", products)
save_csv("orders.csv", orders)

print("RetailPulse dataset generated!")
print(f"Customers: {len(customers)}")
print(f"Products: {len(products)}")
print(f"Orders: {len(orders)}")
