# Report template

Write the report to `REPORT.md` at the repository root, or to the fallback name from SKILL.md rule 2 if that file already exists. Copy the structure between the two `====` markers below. Replace every bracketed placeholder. Keep headings and their order exactly as shown.

Repeat the finding block once per finding, ordered Critical, then Moderate, then Minor. If a section has nothing to report, keep the heading and write one plain sentence (for example, "No critical issues found in the audited scope.").

A finding that spans several files or several separate ranges lists each one on its own line under **Location**, always in the form `` `path` (Lines X-Y) `` (or `(Line X)` for one line). Do not write comma lists like `Lines 9, 14, 31-34`; give each range its own line. Use one snippet per location only when each one is needed to prove the point; otherwise show the most telling one.

==== TEMPLATE START ====

# Codebase State Machine & Architectural Audit Report

## 1. Executive Summary
[Two or three sentences. How sound is state handling overall, and which anti-pattern shows up most? Optionally one more sentence flagging a serious out-of-scope issue you noticed, such as committed credentials.]

## 2. Structural Metrics & Inventory
- **Explicit State Machines Found:** [Count] ([files, or "none"])
- **Implicit / Boolean-Driven State Machines:** [Count] ([files])
- **Primary Risks Identified:** [Comma separated, e.g. race conditions, UI and data desync, illegal states]
- **Audit Scope:** [Directories covered; anything skipped and why]

## 3. Detailed Audit Findings

### [CRIT-01] - [Short descriptive title]
- **Severity:** [Critical | Moderate | Minor]
- **Audit Vector:** [number and name, e.g. 3. Async State, Races and Stale Updates. List more than one only if the finding covers more than one defect.]
- **Location:**
  - `path/to/file.ext` (Lines X-Y)
- **Code Snippet:**

```[language]
[Exact snippet from the cited lines]
```

- **The Core Risk:** [A concrete sequence of events that triggers the bug, and what breaks.]
- **Proposed Refactoring:** [The structural change, then a short sketch in the project's language.]

```[language]
[Refactoring sketch]
```

---

## 4. Prioritized Remediation Roadmap
1. **Immediate (Critical):** [What to fix first, by finding ID]
2. **Short-Term (Moderate):** [Next batch, by finding ID]
3. **Long-Term Tech Debt:** [Strategic changes, e.g. one statechart library, one session interceptor, schema validation at every hydration point]

==== TEMPLATE END ====

## Worked example (for depth and tone, do not copy into the report)

### [MOD-02] - Profile fetch can overwrite a newer user's data

- **Severity:** Moderate
- **Audit Vector:** 3. Async State, Races and Stale Updates
- **Location:**
  - `src/hooks/useProfile.ts` (Lines 14-22)
- **Code Snippet:**

```ts
useEffect(() => {
  setLoading(true);
  fetch(`/api/users/${userId}`)
    .then((r) => r.json())
    .then((data) => {
      setProfile(data);
      setLoading(false);
    });
}, [userId]);
```

- **The Core Risk:** The user opens profile A, then quickly switches to profile B. Both requests are in flight. If A's response arrives last, `setProfile` stores A's data while the URL and header say B. Nothing aborts or ignores the stale request, and `loading` flips to false even though B's request is still pending. Recoverable by refresh, so Moderate, but it shows the wrong person's data.
- **Proposed Refactoring:** Tie each request to the effect run that started it and drop results from runs that were superseded. Fold `loading`, `profile` and errors into one union so a stale response cannot leave a half-updated combination.

```ts
type ProfileState =
  | { status: "loading" }
  | { status: "ready"; profile: Profile }
  | { status: "error"; error: string };

useEffect(() => {
  const ctrl = new AbortController();
  setState({ status: "loading" });
  fetch(`/api/users/${userId}`, { signal: ctrl.signal })
    .then((r) => r.json())
    .then((profile) => setState({ status: "ready", profile }))
    .catch((e) => {
      if (!ctrl.signal.aborted) setState({ status: "error", error: String(e) });
    });
  return () => ctrl.abort();
}, [userId]);
```
