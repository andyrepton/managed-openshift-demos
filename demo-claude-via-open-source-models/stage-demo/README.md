# Inventory Service

A REST API for managing product inventory, built with FastAPI.

## Endpoints

- `GET /products` — list all products
- `GET /products/{id}` — get a single product
- `POST /products` — create a product
- `PUT /products/{id}` — update a product
- `DELETE /products/{id}` — delete a product

## Data Model

Each product has: `id`, `name`, `sku`, `quantity`, `price`, `category`.

## Running

```bash
pip install fastapi uvicorn
uvicorn app:app --reload
```

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string
- `API_KEY` — authentication key for write operations
- `LOG_LEVEL` — logging verbosity (default: `INFO`)
