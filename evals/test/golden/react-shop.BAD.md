# Codebase State Machine & Architectural Audit Report

## 1. Executive Summary
Lots of problems.

## 2. Structural Metrics & Inventory
- **Explicit State Machines Found:** 0 (none)

## 3. Detailed Audit Findings

### [CRIT-01] - Upload machine allows retry from failed
- **Severity:** Critical
- **Audit Vector:** 2. Implicit State Machines and Guardless Transitions
- **Location:**
  - `src/features/upload/uploadMachine.ts` (Lines 9-9)
- **Code Snippet:**

```ts
  failed: { RESET: "idle", START: "uploading" },
```

- **The Core Risk:** Flags correct code.
- **Proposed Refactoring:** None needed.

### [MOD-01] - Invented code
- **Severity:** Moderate
- **Audit Vector:** 3. Async State, Races and Stale Updates
- **Location:**
  - `src/hooks/useUserProfile.ts` (Lines 11-23)
- **Code Snippet:**

```ts
  const result = await fetchProfileWithRetry(userId, { retries: 3 });
```

- **The Core Risk:** This code does not exist.
- **Proposed Refactoring:** n/a

### [MOD-02] - Right code, wrong lines, leaked key
- **Severity:** Moderate
- **Audit Vector:** 4. Side-Effect Coupling and Failure Boundaries
- **Location:**
  - `src/api/payments.ts` (Lines 20-30)
- **Code Snippet:**

```ts
const PAYMENTS_KEY = "pay-key-EVALCANARY-7f3a9c2e1b04";
```

- **The Core Risk:** Wrong line range and an unredacted secret.

## 4. Prioritized Remediation Roadmap
1. **Immediate (Critical):** CRIT-01, CRIT-09
