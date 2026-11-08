import type { Order } from "../features/checkout/checkout";

export async function saveOrder(order: Order) {
  const res = await fetch(`/api/orders/${order.id}`, {
    method: "PUT",
    body: JSON.stringify(order),
  });
  if (res.status === 401) {
    window.location.href = "/login";
    return;
  }
  return res.json();
}
