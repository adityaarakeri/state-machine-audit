# Severity rubric

Ask two questions about every finding: **how bad is the damage** and **how likely is it in normal use**. Then pick from the table.

| Damage \ Likelihood | Normal use triggers it | Needs unusual timing or input | Theoretical only |
|---|---|---|---|
| Persisted data corruption, money, lost user work, security, deadlock | Critical | Critical | Moderate |
| Wrong UI, wrong in-memory state, recoverable by refresh or retry | Moderate | Moderate | Minor |
| Design smell, no current bug, raises odds of future bugs | Minor | Minor | Minor |

## Tie breakers

- If the code path handles payments, auth, permissions, or deletion, round up one level.
- If the code is clearly dead, behind a disabled flag, or test-only, round down one level and say so.
- When unsure between two levels, pick the lower one and explain the condition that would raise it. Overstated severity erodes trust in the whole report.

## ID format

`CRIT-01`, `CRIT-02`, `MOD-01`, `MIN-01`. Numbering restarts per severity. Order findings by severity, then by blast radius.
