/** The JSON behind "Try a sample": a little of everything the converter handles. */
export const SAMPLE = `{
  "id": 1042,
  "order_id": "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  "placed_at": "2026-10-18T12:30:00+01:00",
  "delivery_date": "2026-10-21",
  "customer": {
    "first_name": "Ana",
    "last_name": "Silva",
    "email": null,
    "vip": true
  },
  "lines": [
    { "sku": "A-1", "quantity": 2, "unit_price": 9.9, "tags": ["gift"] },
    { "sku": "B-2", "quantity": 1, "unit_price": 120, "discount": 0.15, "tags": [] }
  ],
  "total": 139.8,
  "notes": null
}
`;
