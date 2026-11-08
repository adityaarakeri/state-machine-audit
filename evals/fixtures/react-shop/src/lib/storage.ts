export type CheckoutStep = "cart" | "shipping" | "payment" | "review" | "complete";

export interface CheckoutDraft {
  step: CheckoutStep;
  orderId?: string;
}

const KEY = "checkout-draft";

export function saveCheckoutDraft(draft: CheckoutDraft) {
  localStorage.setItem(KEY, JSON.stringify(draft));
}

export function loadCheckoutDraft(): CheckoutDraft {
  const raw = localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as CheckoutDraft) : { step: "cart" };
}

const STEP_TITLES: Record<CheckoutStep, string> = {
  cart: "Your cart",
  shipping: "Shipping",
  payment: "Payment",
  review: "Review",
  complete: "Thank you",
};

export function stepTitle(draft: CheckoutDraft) {
  return STEP_TITLES[draft.step].toUpperCase();
}
