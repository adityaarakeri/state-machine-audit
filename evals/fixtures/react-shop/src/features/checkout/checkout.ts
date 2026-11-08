import { chargeCard } from "../../api/payments";
import { saveOrder } from "../../api/orders";
import { analytics } from "../../lib/analytics";
import { saveCheckoutDraft } from "../../lib/storage";

export interface Order {
  id: string;
  total: number;
  status: string; // "draft" | "pending" | "paid" | "shipped" | "refunded" | "cancelled"
  cardToken?: string;
}

export async function submitOrder(order: Order) {
  order.status = "pending";
  await saveOrder(order);

  order.status = "paid";
  await saveOrder(order);
  analytics.track("order_paid", { id: order.id, total: order.total });

  try {
    await chargeCard(order.cardToken!, order.total);
  } catch (e) {
    console.error("charge failed", e);
  }

  saveCheckoutDraft({ step: "complete", orderId: order.id });
  return order;
}

export function cancelOrder(order: Order) {
  order.status = "cancelled";
  return saveOrder(order);
}
