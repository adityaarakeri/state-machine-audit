import { saveOrder } from "../../api/orders";
import type { Order } from "../checkout/checkout";

export async function refundOrder(order: Order) {
  if (order.status == "refunded") return order;
  order.status = "refunded";
  await saveOrder(order);
  return order;
}

export async function reopenOrder(order: Order) {
  // Support asked for a way to retry orders that got stuck.
  order.status = "pending";
  await saveOrder(order);
  return order;
}

export function markShipped(order: Order) {
  order.status = "shipped";
  return saveOrder(order);
}
