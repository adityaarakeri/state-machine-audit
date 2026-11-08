# Audit vectors: what to look for and how to find it

Each vector has: the smell, search leads, and what separates a real finding from noise.

## Before you search

**Use search to find files, not line numbers.** Search output tells you where to look. Open the file and read the citation's line numbers from the file view itself. Context flags like `-A`/`-B` are fine for skimming. Piping one search into another is not, because the second tool numbers its own input lines rather than the source file's.

**Always pass a path.** Write `rg PATTERN .`, never `rg PATTERN` alone. In agent shells stdin is usually not a terminal, so ripgrep without a path waits on stdin and hangs.

**Exclude code you do not own.** With ripgrep, add these to every search (or set `RIPGREP_CONFIG_PATH` to a file containing them):

```
--glob '!**/{node_modules,vendor,third_party,dist,build,out,target,.next,coverage,migrations}/**'
--glob '!*.{min.js,lock,map}' --glob '!*{.generated.,_pb2.py,.pb.go}*'
```

ripgrep already honors `.gitignore`. If you have no shell, use your built-in code search with the same exclusions in mind.

The patterns below are regex leads. Narrow them with `--type` (ts, js, py, go, rust, java, kotlin, swift, cs, ruby) to the languages actually in the repo.

---

## 1. Scattered booleans and invalid combinations

**The smell.** Two or more boolean fields describe one lifecycle. With 4 flags there are 16 combinations, but maybe 4 are meaningful. The other 12 are bugs waiting to happen, like `isLoading` and `isError` both true.

**Search leads**

- **Any:** `\b(is|has)_?(Loading|Fetching|Error|Success|Done|Pending|Retrying|Submitting|Saving|Running|Failed|Complete)\b` (add `-i` for snake_case)
- **React:** `useState\((true|false)\)` and `set(Is)?(Loading|Error|Success|Submitting)\(`
- **Python / Ruby:** `^\s*(\w+\.)?(is|has)_\w+\s*(:\s*bool\s*)?=\s*(True|False|true|false)` (covers `self.is_x = ...`, `job.is_x = ...` and dataclass fields)
- **Go:** `^\s*(Is|Has)\w+\s+bool\b`
- **Kotlin / Java / C#:** `(var|val|boolean|bool|private\s+bool)\s+is[A-Z]\w*`
- **Swift:** `(var|let)\s+is[A-Z]\w*\s*(:\s*Bool|=\s*(true|false))`

**Real finding when:** the flags are set in separate statements, at least one path can leave two mutually exclusive flags true together (often the error path forgets to clear the loading flag), or consumers check flags in different orders and reach different conclusions.

**Not a finding when:** the flags are genuinely independent (`isDarkMode`, `isSidebarOpen`), or they are all derived from a single source of truth.

**Typical fix:** a discriminated union (TS), sealed class (Kotlin), enum with associated values (Swift, Rust), or a single `status` field where the data that only makes sense in one status lives inside that variant.

---

## 2. Implicit state machines and guardless transitions

**The smell.** An entity has a `status` or `state` field stored as a string or integer. Any module can write any value at any time. Nothing says `pending -> paid` is fine but `refunded -> pending` is not.

**Search leads**

- **Any:** `\.(status|state|stage|phase|step)\s*=\s*['"A-Z\d]` (assignments)
- **Any:** `(status|state)\s*(==|===|!=|!==)\s*['"]\w+['"]` (magic string comparisons)
- **SQL in code:** `UPDATE\s+\w+\s+SET\s+[^;]*status` with `-i`
- **ORMs:** `update\(.*status`, `update_column\(:status`, `\.save\(update_fields=\[.status`
- **Switch on tags:** `case\s+['"]\w+['"]\s*:` and `when\s+['"]\w+['"]`

Then count distinct files that **write** the same status field. More than one writer with no shared transition function is a strong signal.

**Real finding when:** status values are written from multiple places with no shared transition function, magic strings are duplicated across files, or an illegal move is reachable (a completed job can be set back to running, a cancelled order can be marked paid).

**Typical fix:** a transition table plus a single `transition(current, event)` function that rejects illegal moves; state-pattern classes; or a library (XState, AASM, django-fsm, `transitions` for Python, `looplab/fsm` for Go, Spring Statemachine). Enforce at the database too: an enum or CHECK constraint, and conditional updates (`UPDATE ... SET status = 'paid' WHERE id = ? AND status = 'pending'`).

---

## 3. Async state, races and stale updates

**The smell.** A request starts, the user navigates away or fires a second request, and the first response lands later and overwrites newer state. Or two workers read a row, both decide it is free, and both claim it. Or a timer keeps firing after cleanup.

**Search leads**

- **Effects with async work:** `useEffect\(` then read each hit's body for `fetch|axios|await|\.then\(`
- **Timers:** `(setTimeout|setInterval)\(` then check for a matching `clear(Timeout|Interval)`
- **Cancellation present?:** `AbortController|signal|cancel(led)?|ignore\s*=\s*true|isMounted|CancellationToken|Job\.cancel|context\.WithCancel`
- **Concurrency primitives:** `asyncio\.(create_task|gather)|threading\.Thread|go func|launch\s*\{|Task\.Run|DispatchQueue`
- **Concurrency controls present?:** `FOR UPDATE|SKIP LOCKED|version\s*=|etag|compare_and_set|select_for_update|optimistic` with `-i`

Run the "present?" searches to find what exists. The finding is usually the **absence** of these near async code that writes shared state.

**Real finding when:** async results write to shared state with no check that the work is still current (no abort signal, request id, sequence number, or terminal-state check), or a read-modify-write on a shared row happens with no lock, version column, or conditional update.

**Typical fix:** abort and cleanup in effects; request id or sequence guards; drop results when the machine is in a terminal state; `SELECT ... FOR UPDATE SKIP LOCKED` or a conditional `UPDATE ... WHERE status = ?` that checks affected rows; optimistic concurrency with a version column.

---

## 4. Side-effect coupling and failure boundaries

**The smell.** One function changes state, charges the card, sends the email, and writes the audit log, in that order. If step 2 fails, step 1 already happened and nothing undoes it.

**Search leads**

- **Effects near state writes:** find status assignments (vector 2), then read the next 20 lines for `fetch|axios|requests\.|http|send|publish|emit|track|analytics|charge|writeFile|save\(|commit\(`
- **Swallowed errors (JS/TS):** `catch\s*(\(\w*\))?\s*\{\s*\}`
- **Logged then ignored (JS/TS, needs `rg -U`):** `catch\s*\(\w*\)\s*\{\s*console\.\w+\([^)]*\);?\s*\}`
- **Logged then ignored (Python, needs `rg -U`):** `except[^:]*:\s*\n\s*(log\w*|print)[\w.]*\(` then check that no `raise` follows
- **Swallowed errors (Python):** `except(\s+\w+)?\s*:\s*$` then check if the next line is `pass`
- **Swallowed errors (Go):** `_\s*=\s*\w+\(` and `if err != nil \{\s*\}`
- **Commit ordering:** `commit\(\)` near `send|notify|publish|enqueue`

**Real finding when:** state is committed before an external call with no compensation, outbox, or retry; an external effect fires before the state commit that it depends on; a swallowed error hides a failed effect; or a crash between two writes leaves an orphan.

**Typical fix:** make transitions pure (state in, new state plus a list of effects out) and run effects after commit; transactional outbox; idempotency keys; saga or compensation steps. Model the in-between states explicitly (`charging`, `charge_failed`) so a crash leaves a visible, recoverable state.

---

## 5. Persistence, ingestion and hydration gaps

**The smell.** A status comes out of a database, cache, localStorage, URL, or message queue and goes straight into the app as if it must be valid. Someone renames a state, old rows keep the old value, and something crashes or silently falls through.

**Search leads**

- **Parsing untrusted data:** `JSON\.parse\(|json\.loads|yaml\.(safe_)?load|pickle\.loads|Unmarshal\(|decode\(`
- **Browser storage:** `(local|session)Storage\.getItem`
- **Unchecked casts:** `as\s+\w*(State|Status)\b` (TS), `as!\s*\w*(State|Status)` (Swift), `\(\w*(State|Status)\)\s*\w+` (Java/C# casts)
- **Enum from raw value:** `\w+Status\(row|\w+State\(row|valueOf\(|Enum\.Parse|rawValue:`
- **Lookup by status:** `\[\s*\w*\.?(status|state)\s*\]` (dict or map indexed by status)
- **Validation present?:** `zod|yup|io-ts|valibot|pydantic|marshmallow|attrs|serde|kotlinx\.serialization|Codable`

**Real finding when:** a value is cast to a state type without runtime validation; a map or `switch` keyed by status has no default for unknown values; or there is no handling for renamed or retired states that old data still holds.

**Typical fix:** parse, do not cast. Validate at the boundary with a schema; map unknown and legacy values to an explicit fallback (`unknown`, or a migration map); add exhaustiveness checks (`assertNever` in TS, `when` without `else` on a sealed class in Kotlin, `match` in Rust, `#[serde(other)]` for forward compatibility).

---

## 6. Global interruptions and duplicated escape hatches

**The smell.** Every feature module has its own `if (res.status === 401) logout()` and its own offline banner. They drift apart. One forgets to stop its polling on logout and keeps hammering the API with a dead token.

**Search leads**

- **Auth failures:** `status\s*===?\s*401|status_code\s*==\s*401|HttpStatus\.UNAUTHORIZED|Unauthorized`
- **Logout handling:** `logout\(|signOut\(|clearSession|isLoggedOut|sessionExpired`
- **Connectivity:** `navigator\.onLine|offline|networkLost|isOnline|NWPathMonitor|ConnectivityManager`
- **Central handlers present?:** `interceptors\.(request|response)\.use|middleware|onUnauthorized|ErrorBoundary|HttpInterceptor`

**Real finding when:** the same global condition is handled in three or more places with different behavior, or a long-running process (poller, socket, worker loop) has no way to learn about it and keeps running.

**Typical fix:** a single HTTP interceptor or middleware; a parent statechart whose `loggedOut` or `offline` state stops all child machines; or an app-level event that every long-running process subscribes to and shuts down on.
