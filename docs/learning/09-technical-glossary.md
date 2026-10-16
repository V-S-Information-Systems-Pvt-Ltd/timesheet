# Technical glossary

> **Update (2026-10-16):** The Supabase backend and the `NEXT_PUBLIC_BACKEND` switch were removed; native PostgreSQL with in-app auth is the only backend. References below to Supabase mode, Supabase adapters/RLS or the dual-backend design describe the previous architecture.

Definitions are scoped to this project. For actual locations, use [architecture](04-architecture-walkthrough.md), [examples](06-key-concepts-and-examples.md), and the linked roadmaps.

| Term | Meaning and project connection |
| --- | --- |
| Value | A piece of data, such as `8`, `'project'`, `true` or `null` |
| Variable | A named binding to a value; `const` cannot be reassigned, while `let` can |
| Type | A description of allowed value shapes; TypeScript checks these before runtime |
| Type annotation | Syntax declaring an expected type, such as `hours: number`; it does not validate or convert incoming JSON |
| Type inference | The type checker deriving a type from surrounding code rather than requiring every annotation |
| Function | Reusable code that receives arguments, executes statements and may return a result |
| Parameter / argument | A parameter is a name in a function definition; an argument is the value supplied when calling it |
| Return | Give a value back to a function's caller and end that execution path |
| Scope | Where a name can be accessed; separately, authorization scope describes records an actor may access |
| Object | A runtime collection of named properties, often representing a row or input |
| Array | An ordered collection of values, such as recent timesheet entries |
| Map | A runtime key/value collection; smart hours uses numeric keys with frequency counts |
| Callback | A function passed to another function to be invoked, such as a `filter` predicate |
| Closure | A function retaining access to values from its surrounding lexical scope |
| Module | A file exporting/importing code; it is not automatically a running service |
| Interface | A TypeScript description of a shape or capabilities; it does not itself execute |
| Union | A type allowing alternatives, such as `number | null` or success/failure object shapes |
| Narrowing | Refining a value's known type through checks or control flow |
| Generic | A type parameter letting reusable code preserve different payload types, as in `ApiResult<T>` |
| Optional chaining | `?.` accesses a property/call only when the preceding value is not nullish |
| Nullish coalescing | `??` supplies a fallback for `null`/`undefined`; unlike `||`, it preserves `0` and empty text |
| Promise | An object representing the eventual success or failure of asynchronous work |
| async / await | Syntax for returning Promises and suspending one function's continuation until a Promise settles |
| Call stack | The currently executing synchronous function calls; an awaited continuation resumes later, not by blocking every request |
| Exception | A thrown failure that can be caught by an enclosing error boundary |
| Pure function | A calculation without observable side effects whose result is determined by its inputs |
| Side effect | Work outside returning a calculation, such as a DB write, request, file write or UI notification |
| Component | A React function describing part of the UI; components compose other components |
| JSX / TSX | Syntax for UI expressions inside JavaScript/TypeScript; not HTML delivered unchanged |
| Props | Values a parent passes to a component |
| State | Data React retains across renders; a setter requests an update |
| Hook | A React API for state/effects and other component behavior, subject to React's hook rules |
| Render | Compute a UI description from props/state; rendering is distinct from user events and effects |
| Effect | React synchronization with an external system after rendering, with dependency/cleanup behavior |
| Memoization | Reusing a prior calculation/reference when dependencies are unchanged; a performance technique, not a correctness guarantee |
| Hydration | React connecting interactive client behavior to initial server-provided UI |
| Server Component | A React/Next component evaluated on the server side of the framework boundary; it cannot directly host browser event handlers |
| Client Component | A component within a client module boundary, capable of state/events; it may also participate in initial server rendering |
| Route handler | A Next `route.ts` module exporting HTTP method functions such as `POST` |
| Server Action | A framework server-call surface declared with `'use server'`; this repository retains action contracts, while current browser data flows use versioned HTTP |
| HTTP / JSON | Network request-response protocol / structured text data format used by API calls |
| DTO | Data Transfer Object: the public data shape crossing a transport boundary, distinct from an internal DB row |
| Schema validation | Runtime checking/coercion/refinement of external input; this project uses Zod |
| Domain operation | Application behavior/rules, such as validating a writable date and daily hours before saving |
| Port | Interface describing the persistence or other capabilities a domain operation needs |
| Adapter | Implementation of a port for native SQL or Supabase |
| Facade | A consistent entry point hiding differing implementations; server/browser auth are examples |
| Dependency injection | Supplying required capabilities/values, such as persistence and clock, instead of creating them invisibly inside a rule |
| Composition root | Code wiring implementations to their consumers; domain-specific `lib/db/` modules perform this role |
| ORM | Object-relational mapper translating object models to persistence; not the current native SQL/Supabase adapter approach |
| Query parameter | A bound SQL value such as `$1`, distinct from URL query parameters; binding avoids inserting input into SQL syntax |
| Foreign key | Database relationship constraint, such as a timesheet's user pointing to a profile |
| Migration | Ordered database schema/data evolution; applied history should not be rewritten |
| Transaction | Database operations treated as one commit/rollback unit |
| Trigger | Database function run on a configured data event, such as enforcing daily hours during writes |
| Advisory lock | Application-defined database lock; the daily trigger uses a transaction-scoped lock for accounting |
| Connection pool | Reusable DB connections; each application process/pod contributes its own pool footprint |
| RLS | Row-Level Security: database policies restricting which rows a role/request can access |
| RPC | Remote Procedure Call; here it often means invoking a PostgreSQL function through Supabase |
| Actor | Current application identity plus active/role state used for access decisions |
| Authentication | Establishing who the caller is |
| Authorization | Deciding which operation/resources that caller may access |
| JWT | Signed token carrying claims; signature validity alone does not prove current account/session authorization |
| Session | Login continuity/state; web cookies and persisted mobile-session records have different handling |
| CSRF / origin check | Cross-site request forgery / verifying allowed request origin for cookie-authenticated mutations |
| Hashing / scrypt | Password verification through a salted, expensive one-way computation; not reversible password encryption |
| Rate limit | Restriction on request/action frequency; this application includes persistent state and batch budgets |
| Idempotency | Giving repeated requests for one logical operation a consistent effect/outcome, rather than creating duplicate mutations |
| Offline queue | Persisted client mutations awaiting replay; states and identity/server context affect when replay is allowed |
| Single-flight | Sharing one in-progress operation among callers; distinct from caching completed results or making writes idempotent |
| Unit test / mock | A focused test / a substitute dependency; mocked storage does not prove real SQL/RLS behavior |
| Integration test | Test of interacting real components, such as migrated PostgreSQL and concurrent writes |
| End-to-end test | Test of a user flow through browser and server; requires a prepared runtime/data fixture |
| Coverage | Measurement of exercised code paths; a threshold does not prove every important case is correct |
| Lint / type-check | Static style/bug-pattern checks / TypeScript compatibility checks; neither runs every application behavior |
| Workspace | A package-manager arrangement linking local packages under a root manifest |
| Metro | React Native's JavaScript bundler; separate from the Next web build |
| Standalone output | Next deployment bundle allowing a packaged Node server to run outside the full source/dependency checkout |
| Build-time / runtime configuration | Values baked in during compilation versus values read while the process executes; backend/client flags and server secrets must be distinguished |
| Refactoring | Changing code organization while preserving observable behavior and compatibility |
| Invariant | A condition required across all valid transitions, such as committed daily hours not exceeding 24 |

When an analogy to infrastructure helps, the tutor should state its limit. An application port resembles a provider abstraction, but it is a code interface. RLS resembles an access policy, but it operates inside database queries. A React render describes UI; it is not a Kubernetes reconcile loop with the same timing or side-effect guarantees.
