# Key concepts and actual source examples

This is a reference bank for future interactive lessons, not a completed lesson or assessment. Excerpts below are from the inspected checkout. They are intentionally small; retrieve surrounding current source when teaching behavior that depends on it.

## A function computes a result — application rule in TypeScript

From [timesheet contracts](../../packages/contracts/src/timesheets.ts), lines 75–77:

```ts
export function requiresProject(type: EntryType): boolean {
  return type === 'project'
}
```

`export` makes the function available to importing modules. `type` is the input parameter. `EntryType` describes allowed inputs to the type checker. `: boolean` describes the return type. `===` compares the supplied value with `'project'`. `return` gives the comparison result to the caller. These are language constructs around an application-specific classification rule; Next.js does not mandate this rule.

The function reads an argument and returns a value without a network request or mutation. An inline comparison could do the same computation; a named helper provides reusable vocabulary. Reuse is the inferred benefit, not proof of the author's private reasoning.

## Object transformation — language feature with a pure adapter

From [smart-hours helpers](../../packages/core/src/smart-hours.ts), lines 63–65:

```ts
export function timesheetToLogEntry(t: LogEntrySource): LogEntry {
  return { log_date: t.log_date, hours_worked: Number(t.hours_worked) }
}
```

The function creates a new object containing selected properties. `Number(...)` performs runtime conversion; an annotation alone would not convert a string. The returned object is a smaller input shape for a shared calculation. It does not modify `t`.

The [web form](../../app/dashboard/time-entry-form.tsx), lines 79–81, maps rows through this helper before `computeSmartHours`. A full DB row need not travel into every pure calculation.

## Collections and loops — language features

From [computeSmartHours](../../packages/core/src/smart-hours.ts):

```ts
const freq = new Map<number, number>()
for (const w of weekdays) {
  const h = Number(w.hours_worked)
  if (Number.isFinite(h) && h > 0 && h <= 24) {
    freq.set(h, (freq.get(h) ?? 0) + 1)
  }
}
```

`Map` associates each hours value with a count. The two generic parameters describe numeric keys and values. `for...of` visits entries. The condition rejects non-finite, zero, negative and excessive values. `?? 0` supplies a count only when none is stored. Each accepted entry increments its hours bucket.

The surrounding function filters weekdays, requires sufficient evidence, and selects a most frequent value; ties favor the larger hours value. Counting by array reduction is an alternative, but adds callback/accumulator complexity for a beginner. The loop makes intermediate execution state explicit.

## Success and failure shapes — TypeScript union plus application contract

From [API results](../../packages/contracts/src/api-result.ts), lines 12–14:

```ts
export type ApiResult<T> =
  | { data: T; error: null }
  | { data: null; error: ApiErrorBody }
```

`T` lets one shape carry different payload types. `|` declares alternatives. A success has data and no error; a failure has an error and no data. Branching on error distinguishes them. TypeScript checks code that consumes this shape; the actual JSON contract must still be enforced at runtime.

Throwing exceptions for every failure is an alternative. This application uses explicit envelopes at HTTP boundaries while some lower-level errors still throw. Teach the chosen boundary rather than assuming one universal error style.

## Asynchronous service orchestration — language plus application layering

From [createTimesheetService](../../lib/api/v1/services/timesheets.ts), lines 87–96:

```ts
export async function createTimesheetService(
  actor: Actor,
  input: TimesheetPayload
): Promise<MobileServiceResult<{ success: true }>> {
  const result = await createTimesheetEntry(actor, input, timesheetDeps())
  if (!result.ok) {
    return mapDomainError(result.error)
  }
  return { success: true, data: { success: true } }
}
```

`async` makes the function return a Promise. `await` pauses this function's continuation until the domain result is available; it does not pause the entire Node process. Dependencies are constructed for the domain call. The failure branch maps a domain error; the success branch returns an API-service payload. The service does not expose the domain's optional inserted ID.

The architectural layer is a project choice. Next.js needs an HTTP handler, but does not require this exact service/domain split. Putting all rules in the route would reduce indirection while making transport reuse and focused domain tests harder.

## React state — framework feature

From [WelcomePage](../../app/page.tsx), lines 19–22:

```tsx
const [password, setPassword] = useState('')
const [message, setMessage] = useState<string | null>(null)
const [error, setError] = useState<string | null>(null)
const [busy, setBusy] = useState(false)
```

Each Hook returns the current state value and a setter. Destructuring gives each pair names. The generic union permits message/error to be text or absent. Calling a setter schedules a React update; it does not replace the current render's local variable immediately. The submit handler uses busy and error state to communicate request progress.

An ordinary `let` variable does not provide React's persistent state/update behavior. A global store could coordinate distant components, but this form's local state does not require one merely because global state libraries exist.

## Next HTTP convention — framework feature

From [timesheet route](../../app/api/v1/timesheets/route.ts), lines 7 and 41:

```ts
export const runtime = 'nodejs'
```

The module also exports `GET` and `POST` handlers. Next associates the file path with `/api/v1/timesheets` and invokes the relevant method. The route's actor guards, schema parsing and idempotency wrapper are project logic; exporting a handler named for the HTTP method is the framework convention. This is an HTTP route, distinct from a React page component or Server Action.

## SQL parameters and database invariants — driver and database behavior

The [native adapter](../../lib/db/native/timesheets.ts), lines 347–374, sends an INSERT using `$1` through `$10` with a separate parameter array. The driver binds values; concatenating untrusted input into SQL would change the security property. Adapter checks still decide whether the actor may write for the target user.

From [daily-hours enforcement](../../db/migrations/0015_data_integrity_and_concurrency.sql), line 18:

```sql
perform pg_advisory_xact_lock(hashtext(NEW.user_id::text || ':' || NEW.log_date::text));
```

This trigger acquires a transaction-scoped advisory lock for daily accounting, then checks the stored total before accepting a write. It is PostgreSQL/PL/pgSQL behavior, not a TypeScript annotation or React validation rule. The Supabase migration has corresponding enforcement. Removing the DB mechanism because the form checks hours would ignore concurrent requests.

## Useful distinctions to practice

| Distinction | Locate it here |
| --- | --- |
| Compile-time type versus runtime value | `EntryType` versus `type === 'project'` |
| Pure function versus side effect | Smart-hours calculation versus database create |
| Function definition versus invocation | Declared service versus route calling it |
| Framework convention versus business rule | Exported POST handler versus 24-hour limit |
| Authentication versus authorization | Session identity versus target-user/active-state checks |
| Result versus Promise of result | Domain result after `await` versus pending call |
| UI feedback versus integrity | Busy/error state versus DB constraints |
| Data row versus DTO | Native SQL shape versus shared API envelope/mapping |

During a lesson, the tutor will first introduce any unfamiliar syntax with a standalone example, then connect it to one excerpt. Alternatives and execution steps should be sized to the current lesson, not presented as a full architecture lecture every time.
