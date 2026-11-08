# Codebase State Machine & Architectural Audit Report

## 1. Executive Summary
State in this storefront is mostly implicit. Order status is a free-form string any function can overwrite, the profile hook tracks one lifecycle with four independent booleans, and the checkout flow commits "paid" before money moves. The upload flow and search hook are the exceptions and show the pattern the rest of the code should follow.

## 2. Structural Metrics & Inventory
- **Explicit State Machines Found:** 1 (src/features/upload/uploadMachine.ts)
- **Implicit / Boolean-Driven State Machines:** 3 (src/hooks/useUserProfile.ts, src/features/checkout/checkout.ts, src/lib/storage.ts)
- **Primary Risks Identified:** illegal order transitions, paid-without-charge desync, stale async writes, unvalidated hydration
- **Audit Scope:** all of src/

## 3. Detailed Audit Findings

### [CRIT-01] - Order is marked paid before the card is charged
- **Severity:** Critical
- **Audit Vector:** 4. Side-Effect Coupling and Failure Boundaries
- **Location:**
  - `src/features/checkout/checkout.ts` (Lines 17-25)
- **Code Snippet:**

```ts
  order.status = "paid";
  await saveOrder(order);
  analytics.track("order_paid", { id: order.id, total: order.total });

  try {
    await chargeCard(order.cardToken!, order.total);
  } catch (e) {
    console.error("charge failed", e);
  }
```

- **The Core Risk:** The order is persisted as paid and an analytics event fires before the charge. When `chargeCard` throws, the error is logged and swallowed, so the order ships without payment.
- **Proposed Refactoring:** Add `charging` and `payment_failed` states, charge first, and only commit `paid` after success.

```ts
order = transition(order, "CHARGE_STARTED");
await saveOrder(order);
const ok = await chargeCard(order.cardToken!, order.total).then(() => true, () => false);
order = transition(order, ok ? "CHARGE_SUCCEEDED" : "CHARGE_FAILED");
await saveOrder(order);
if (ok) analytics.track("order_paid", { id: order.id });
```

---

### [CRIT-02] - Order status has no transition guard; refunded orders can be reopened
- **Severity:** Critical
- **Audit Vector:** 2. Implicit State Machines and Guardless Transitions
- **Location:**
  - `src/features/admin/refunds.ts` (Lines 11-16)
  - `src/features/checkout/checkout.ts` (Lines 31-34)
- **Code Snippet:**

```ts
export async function reopenOrder(order: Order) {
  // Support asked for a way to retry orders that got stuck.
  order.status = "pending";
  await saveOrder(order);
  return order;
}
```

- **The Core Risk:** Five functions across two files assign arbitrary strings to `status`. `reopenOrder` moves a refunded or shipped order back to pending, after which `submitOrder` can charge it again.
- **Proposed Refactoring:** A union type and one transition table.

```ts
type OrderStatus = "draft" | "pending" | "charging" | "paid" | "shipped" | "refunded" | "cancelled";
const allowed: Record<OrderStatus, OrderStatus[]> = {
  draft: ["pending", "cancelled"], pending: ["charging", "cancelled"], charging: ["paid", "pending"],
  paid: ["shipped", "refunded"], shipped: ["refunded"], refunded: [], cancelled: [],
};
```

---

### [MOD-01] - Four booleans model one request lifecycle
- **Severity:** Moderate
- **Audit Vector:** 1. Scattered Booleans and Invalid Combinations
- **Location:**
  - `src/hooks/useUserProfile.ts` (Lines 6-22)
- **Code Snippet:**

```ts
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
// ...
      .catch(() => {
        setIsError(true);
      });
```

- **The Core Risk:** On failure `isError` becomes true while `isLoading` stays true forever, and `isError` is never cleared on the next success.
- **Proposed Refactoring:** One discriminated union for the request state.

```ts
type ProfileState = { status: "loading" } | { status: "ready"; profile: Profile } | { status: "error"; error: string };
```

---

### [MOD-02] - Profile fetch can write a previous user's data
- **Severity:** Moderate
- **Audit Vector:** 3. Async State, Races and Stale Updates
- **Location:**
  - `src/hooks/useUserProfile.ts` (Lines 11-23)
- **Code Snippet:**

```ts
  useEffect(() => {
    setIsLoading(true);
    setIsSuccess(false);
    getProfile(userId)
      .then((data) => {
        setProfile(data);
```

- **The Core Risk:** Switching `userId` quickly leaves two requests in flight. Whichever resolves last wins, even if it belongs to the old user.
- **Proposed Refactoring:** Abort or ignore superseded requests in effect cleanup.

```ts
useEffect(() => {
  let current = true;
  getProfile(userId).then((p) => current && setState({ status: "ready", profile: p }));
  return () => { current = false; };
}, [userId]);
```

---

### [MOD-03] - Checkout draft hydrated from localStorage without validation
- **Severity:** Moderate
- **Audit Vector:** 5. Persistence, Ingestion and Hydration Gaps
- **Location:**
  - `src/lib/storage.ts` (Lines 14-29)
- **Code Snippet:**

```ts
export function loadCheckoutDraft(): CheckoutDraft {
  const raw = localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as CheckoutDraft) : { step: "cart" };
}
```

- **The Core Risk:** A draft saved by an older build with a renamed step passes the cast, and `stepTitle` then calls `.toUpperCase()` on undefined.
- **Proposed Refactoring:** Parse with a schema and fall back to `cart` on anything unknown.

```ts
const Draft = z.object({ step: z.enum(["cart", "shipping", "payment", "review", "complete"]), orderId: z.string().optional() });
```

---

### [MOD-04] - Unauthorized responses handled three different ways
- **Severity:** Moderate
- **Audit Vector:** 6. Global Interruptions and Duplicated Escape Hatches
- **Location:**
  - `src/api/orders.ts` (Lines 8-11)
  - `src/api/profile.ts` (Lines 8-11)
  - `src/features/notifications/poller.ts` (Lines 8-11)
- **Code Snippet:**

```ts
    if (res.status === 401) {
      console.warn("notifications: unauthorized, will retry");
      return;
    }
```

- **The Core Risk:** Orders redirects, profile clears the token, and the poller ignores it and keeps polling every five seconds with a dead token.
- **Proposed Refactoring:** One fetch wrapper that emits a session-expired event; long-running work subscribes and stops.

```ts
export async function api(input: RequestInfo, init?: RequestInit) {
  const res = await fetch(input, init);
  if (res.status === 401) session.expire();
  return res;
}
```

---

## 4. Prioritized Remediation Roadmap
1. **Immediate (Critical):** CRIT-01 and CRIT-02, introduce the order transition table and charge-before-paid ordering.
2. **Short-Term (Moderate):** MOD-01 and MOD-02 together in the profile hook, then MOD-03 and MOD-04.
3. **Long-Term Tech Debt:** Use the upload machine's transition-table pattern for every lifecycle, validate all hydration with schemas, and route all requests through one client.
