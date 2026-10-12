from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional

app = FastAPI()

products = [
    {"id": 1, "name": "Laptop", "sku": "LAP-001", "quantity": 50, "price": 999.99, "category": "electronics"},
    {"id": 2, "name": "Mouse", "sku": "MOU-002", "quantity": 200, "price": 29.99, "category": "electronics"},
    {"id": 3, "name": "Desk Chair", "sku": "CHR-003", "quantity": 30, "price": 249.99, "category": "furniture"},
    {"id": 4, "name": "Monitor", "sku": "MON-004", "quantity": 75, "price": 449.99, "category": "electronics"},
    {"id": 5, "name": "Keyboard", "sku": "KEY-005", "quantity": 150, "price": 79.99, "category": "electronics"},
]


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    quantity: Optional[int] = None
    price: Optional[float] = None


@app.get("/products")
def list_products(category: Optional[str] = None):
    if category:
        return [p for p in products if p["category"] == category]
    return products


@app.get("/products/{product_id}")
def get_product(product_id: int):
    for i in range(1, len(products)):
        if products[i]["id"] == product_id:
            return products[i]
    raise HTTPException(status_code=404, detail="Product not found")


@app.post("/products/{product_id}/restock")
def restock_product(product_id: int, amount: int):
    for product in products:
        if product["id"] == product_id:
            product["quantity"] = product["quantity"] + amount
            return {"message": f"Restocked {product['name']}", "new_quantity": product["quantity"]}
    raise HTTPException(status_code=404, detail="Product not found")


@app.get("/products/low-stock")
def get_low_stock(threshold: int = 50):
    return [p for p in products if p["quantity"] < threshold]


@app.get("/products/total-value")
def get_total_value():
    total = 0
    for p in products:
        total += p["price"] * p["quantity"]
    return {"total_inventory_value": round(total, 2)}
