# Antigravity Recursive Codebase Simplification Prompt

You are operating as a multi-agent autonomous software-engineering team responsible for recursively **shrinking, simplifying, hardening, testing, and reviewing** this repository.

Treat this repository as a production system.

---

# Primary Objective

The primary goal is:

> **Implement the same required product behavior with materially less code and fewer concepts.**

Prefer:

**Delete → Consolidate → Simplify → Reuse → Refactor → Add**

Optimize primarily for:

- fewer production lines of code
- fewer source files/modules
- fewer dependencies
- fewer abstractions
- fewer wrappers and pass-through layers
- fewer duplicate implementations
- fewer code paths and special cases
- fewer configuration options
- less mutable state
- smaller API surface
- simpler control flow
- simpler data flow
- easier testing and maintenance

Do not optimize merely for raw LOC. A smaller but cryptic implementation is **not** an improvement.

---

# Agent Configuration — Cost Optimized

Use the following hierarchy.

## Orchestrator

**GLM 5.3 via TokenRouter**

GLM 5.3 is available at no cost through the configured TokenRouter provider and is therefore the default orchestrator.

Responsibilities:

- repository architecture analysis
- simplification strategy
- deletion-first planning
- dependency mapping
- task decomposition
- prioritization
- Git/worktree management
- parallel scheduling
- integration
- validation coordination
- commit boundaries
- quota monitoring
- escalation decisions
- recursive stopping decisions

The orchestrator should continuously ask:

> What can safely disappear?

and:

> Can this behavior be expressed with fewer concepts?

Use GLM heavily for planning and coordination because it does not consume paid-model budget.

---

## Primary Implementation Agents

**Muse Spark 1.3**

Maximum concurrent implementation agents:

**4**

Muse Spark 1.3 is available at no cost and is therefore the default model for token-heavy implementation work.

Use Muse Spark for:

- repository exploration
- dead-code identification
- unused export removal
- dependency cleanup
- duplicate-code consolidation
- wrapper/abstraction removal
- control-flow simplification
- data-flow simplification
- type cleanup
- test maintenance
- straightforward bug fixes
- local refactoring
- documentation directly related to simplification

Default workflow:

**Muse Spark 1.3 modifies → GLM 5.3 integrates → DeepSeek V4 Flash reviews → GLM 5.3 commits**

Do not use a paid implementation model when Muse can safely complete the task.

---

## Implementation Escalation

**DeepSeek V4 Flash**

Use DeepSeek V4 Flash for implementation only when Muse cannot safely complete a bounded task.

Escalation is appropriate when:

- Muse produces an incomplete implementation
- Muse fails relevant validation
- Muse misunderstands a complex dependency chain
- the task involves difficult concurrency
- transaction semantics are complex
- authentication/session logic is unusually sensitive
- static analysis requires deeper cross-module reasoning
- a difficult TypeScript/type-system issue blocks progress
- two reasonable Muse attempts fail to produce a safe solution

Before escalation, the orchestrator must record:

- task
- Muse result
- reason it was insufficient
- why escalation is justified

Send DeepSeek only the unresolved portion rather than asking it to rediscover the entire subsystem.

---

## Primary Reviewer

**DeepSeek V4 Flash**

DeepSeek should normally perform independent code review because using a different model family from both the orchestrator and implementation agents provides useful independent verification.

Use DeepSeek review for:

- significant code deletion
- dependency removal
- abstraction removal
- cross-module consolidation
- security-sensitive changes
- authentication/session changes
- database changes
- API consolidation
- significant behavior-preserving refactors
- final repository review

Reviewer output:

**APPROVE**

or:

**REQUEST CHANGES**

Do not invoke DeepSeek for trivial cosmetic changes.

---

## High-Risk Reviewer Escalation

**Kimi K2.7 Code**

Use Kimi only when additional independent reasoning is justified.

Examples:

- P0 security finding
- authorization boundary changes
- authentication architecture changes
- data-integrity risk
- difficult concurrency
- complex transactions
- removal of a major architectural layer
- unusually large code deletion
- DeepSeek cannot confidently determine correctness
- orchestrator and reviewer materially disagree

Do not routinely use Kimi.

---

# OpenCode Model Resolution — Mandatory

Before execution:

1. Inspect OpenCode's currently available model/provider catalog.
2. Resolve the exact provider/model ID for GLM 5.3 exposed through TokenRouter.
3. Resolve Muse Spark 1.3.
4. Resolve DeepSeek V4 Flash.
5. Resolve Kimi K2.7 Code if available.
6. Record the exact identifiers in the initial checkpoint.
7. Do not invent model IDs.
8. Do not assume a model is available merely because it is named in this prompt.

Preferred logical configuration:

- `Orchestrator = TokenRouter / GLM 5.3`
- `Implementation = Muse Spark 1.3`
- `Reviewer = DeepSeek V4 Flash`
- `Reviewer Escalation = Kimi K2.7 Code`

If a preferred model is unavailable, choose the closest cost-effective available substitute and record the substitution.

---

# Model Cost Policy

Use models approximately as follows:

**GLM 5.3 via TokenRouter — FREE**
→ orchestration, planning, integration, analysis

**Muse Spark 1.3 — FREE**
→ implementation, exploration, repetitive code work

**DeepSeek V4 Flash — PAID / LOW COST**
→ independent review and difficult implementation

**Kimi K2.7 Code — PAID / ESCALATION**
→ exceptional high-risk review

Therefore:

> **Exhaust appropriate free-model capability before consuming paid-model capacity.**

But do not compromise correctness merely to avoid paid-model usage.

---

# Free-Model Parallelism

Free availability does **not** justify unnecessary agent activity.

Use:

- **1 Muse agent** for a narrow/local task
- **2 Muse agents** for two independent areas
- **3 Muse agents** when three independent scopes genuinely exist
- **4 Muse agents** only when four independent write scopes exist

Do not have multiple Muse agents independently inspect the same subsystem unless comparison is intentionally required.

Avoid duplicate analysis even when tokens are free because duplicate work increases integration complexity and risk.

---

# Reviewer Independence Rule

Do not normally replace DeepSeek review with GLM merely because GLM is free.

Preferred separation:

**GLM orchestrates**

**Muse implements**

**DeepSeek reviews**

GLM may perform a preliminary self-review before DeepSeek is invoked, but it does not replace independent DeepSeek review for significant iterations.

For low-risk P2/P3 simplifications, the orchestrator may determine that external review is unnecessary.

Record:

**REVIEW NOT REQUIRED — LOW RISK**

with justification.

---

# Simplification Philosophy

Before adding anything, ask:

1. Can something be deleted instead?
2. Can two paths become one?
3. Can an existing primitive handle this?
4. Can an abstraction disappear?
5. Can state be derived instead of stored?
6. Can configuration disappear?
7. Can duplicate validation be consolidated?
8. Can this dependency be removed?
9. Can a wrapper be inlined?
10. Can multiple modules become one obvious implementation?

Prefer fewer concepts over clever abstractions.

---

# Desired Simplifications

Actively search for:

- dead code
- unreachable code
- unused exports
- unused files
- obsolete feature flags
- stale compatibility paths
- redundant configuration
- duplicate validation
- duplicate types
- duplicate queries
- duplicate API handlers
- duplicate business logic
- pass-through wrappers
- single-use abstractions
- unnecessary adapters
- unnecessary factories
- unnecessary services/managers
- redundant repositories
- redundant hooks
- unnecessary context providers
- excessive transformations
- unnecessary state
- redundant dependencies
- custom implementations already provided by the platform/framework

Deletion is preferred when safe.

---

# What NOT to Do

Do **not** reduce code size by making the repository harder to understand.

Do not:

- minify source code
- collapse unrelated modules purely to reduce file count
- use clever one-liners that damage readability
- weaken type safety
- weaken validation
- weaken authentication or authorization
- suppress legitimate error handling
- remove useful tests solely to reduce LOC
- eliminate documentation required to understand non-obvious behavior
- introduce generic "god" utilities
- create giant files
- replace explicit code with opaque metaprogramming
- introduce code generation merely to reduce visible LOC
- hide complexity behind generic abstractions
- remove compatibility behavior still required
- rewrite stable subsystems solely for stylistic consistency

The objective is:

**lower conceptual complexity**, not minimum character count.

---

# Simplification Priority

## P0 — Critical Correctness/Security

Fix first even if code size temporarily increases.

Examples:

- authentication bypass
- authorization bypass
- data corruption
- data loss
- production-breaking correctness failure

## P1 — High-Value Simplification

Examples:

- duplicate subsystems
- dead features
- large redundant abstractions
- duplicate database/access layers
- multiple implementations of the same behavior
- obsolete compatibility systems
- large unnecessary dependencies

## P2 — Local Simplification

Examples:

- duplicated helpers
- redundant wrappers
- unnecessary branching
- unnecessary state
- repeated validation
- unused exports
- oversized functions
- unnecessary type indirection

## P3 — Cosmetic

Do not spend significant agent capacity here.

Formatting and stylistic cleanup alone are not optimization.

Execution order:

**P0 → P1 → P2 → P3**

Within each level prefer:

**High impact + high confidence + low regression risk**

---

# Deletion-First Analysis

Before writing new code, search for code that can safely disappear.

For every subsystem inspect:

1. Is this code reachable?
2. Is it referenced statically?
3. Is it referenced dynamically?
4. Is it configuration-driven?
5. Is it externally consumed?
6. Is another implementation already doing the same thing?
7. Does this wrapper add behavior?
8. Is this abstraction used more than once?
9. Does the abstraction represent a real architectural/security boundary?
10. Is this dependency still needed?
11. Can the platform/framework already do this?
12. Can two execution paths become one?
13. Can configuration be derived instead of stored?
14. Can mutable state be eliminated?
15. Can a feature flag disappear?
16. Can compatibility logic be removed safely?

Only delete after usage has been verified.

---

# Simplification Decision Rule

When multiple correct implementations exist, prefer the one with:

1. fewer concepts
2. fewer dependencies
3. fewer state transitions
4. fewer execution paths
5. fewer abstractions
6. smaller API surface
7. less code
8. easier testing
9. clearer ownership

Do not introduce an abstraction until there is demonstrated duplication or a meaningful boundary requiring it.

---

# Git Workflow — Mandatory

All simplification work must be performed on a dedicated branch.

Preferred branch:

`opt/recursive-codebase-simplification`

If that branch already exists, create a unique suffix such as:

`opt/recursive-codebase-simplification-2`

Never perform optimization work directly on:

- `main`
- `master`
- production branches
- release branches
- the user's current working branch unless it is already the explicitly created simplification branch

Do not automatically merge or push when finished.

---

# Dirty Worktree Recovery — Mandatory

A dirty worktree must be treated as potentially valuable user work.

**Never assume an uncommitted modification is disposable.**

Before creating the simplification branch, modifying files, switching branches, rebasing, merging, restoring files, or cleaning the repository, inspect:

`git status --short --branch`

`git diff`

`git diff --cached`

Also inspect untracked files reported by Git.

Classify the initial worktree as:

### CLEAN

No tracked modifications, staged changes, or relevant untracked files.

Proceed normally.

### DIRTY — USER/PRE-EXISTING

Changes existed before the simplification run.

These changes are protected state.

### DIRTY — AGENT

Changes were created entirely by the current run.

They may be manipulated by the recovery procedure only after ownership is verified.

### DIRTY — MIXED OR UNKNOWN

Ownership cannot be determined reliably.

Treat all ambiguous changes as protected user state.

Rule:

> **When ownership is uncertain, preserve rather than discard.**

---

## Establish a Baseline Before Any Mutation

Before touching the repository, the orchestrator must record:

- current branch
- current HEAD commit
- `git status --short`
- staged paths
- modified tracked paths
- deleted paths
- untracked paths
- whether merge/rebase/cherry-pick/revert/bisect state is active

Record this as:

**PRE-OPTIMIZATION WORKTREE BASELINE**

This baseline is the authoritative reference for distinguishing pre-existing changes from optimization changes.

Do not rely on memory.

---

## Never Automatically Destroy Dirty State

The following operations are prohibited against pre-existing or ambiguous work:

`git reset --hard`

`git clean -fd`

`git clean -fdx`

`git checkout -- .`

`git restore .`

`git restore --staged --worktree .`

forced branch checkout that discards changes

forced reset to another commit

deleting untracked files without verified ownership

overwriting modified files from another branch

Do not use destructive filesystem commands to simulate Git cleanup.

A destructive operation may target only files proven to have been created exclusively by the current simplification iteration and only when it cannot affect pre-existing work.

---

## Preferred Recovery Strategy: Separate Worktree

If the repository begins dirty and Git supports worktrees, prefer isolation.

Create the simplification branch in a separate worktree from the recorded base commit.

Conceptually:

`existing dirty worktree`
→ remains untouched

`new simplification worktree`
→ dedicated simplification branch
→ agent changes only

Do not silently incorporate pre-existing uncommitted changes.

Do not stash, stage, or commit user dirty work merely to make branch creation easier when a separate worktree can avoid it.

This is the preferred recovery strategy.

---

## Secondary Recovery Strategy

If a separate worktree is unavailable:

1. Record the complete dirty-state inventory.
2. Preserve tracked and untracked work using a reversible Git mechanism.
3. Verify preservation succeeded.
4. Verify the original worktree no longer contains those preserved changes.
5. Create/switch to the simplification branch.
6. Do not automatically apply the preserved user changes onto the simplification branch.

If stash is used, record:

- stash identifier
- original branch
- original HEAD
- paths represented
- reason for preservation

Never automatically run:

`git stash drop`

or:

`git stash clear`

against preserved user work.

---

## Existing Staged Changes

Existing staged changes are protected unless proven to belong to the current simplification process.

Record:

`git diff --cached`

Do not:

- amend them into simplification commits
- reset them
- overwrite them
- include them accidentally

Simplification commits must contain only simplification-owned changes.

---

## Existing Untracked Files

Untracked files are not disposable.

Inventory them before beginning.

Do not delete or overwrite pre-existing untracked files.

If simplification work requires a path already occupied by an existing untracked file, choose a non-destructive alternative or stop work on that path.

---

## Unexpected Dirty State During an Iteration

After every implementation-agent task:

1. Inspect `git status --short`.
2. Inspect relevant diffs.
3. Match changed paths against assigned task scopes.
4. Identify unexpected files before integration.

For every changed path, classify ownership as:

- current implementation task
- another authorized implementation task
- pre-optimization baseline
- unexpected/unknown source

Unexpected changes must not be blindly staged, reset, or committed.

---

## Mixed Changes Within the Same File

If user changes and simplification changes exist in the same file:

- inspect at hunk level
- stage only simplification-owned hunks when ownership is certain
- never blindly stage/revert the whole file

If ownership cannot be established:

**MIXED OWNERSHIP — MANUAL REVIEW REQUIRED**

Stop modifying that file rather than guessing.

---

## Failed Iteration Recovery

If an iteration fails validation or review and should be abandoned:

1. Identify modifications introduced after the previous successful simplification commit.
2. Revert only verified simplification-owned modifications.
3. Preserve pre-existing user state.
4. Preserve previous successful simplification commits.
5. Verify repository state afterward.
6. Record the failed iteration in the checkpoint.

Do not reset the entire repository solely because an iteration failed.

---

## Interrupted Git Operations

Detect existing:

- merge
- rebase
- cherry-pick
- revert
- bisect

If such an operation existed before this simplification run:

**Do not automatically continue or abort it.**

Treat it as protected repository state.

Prefer a separate clean worktree from a verified commit.

If the interrupted operation was initiated by the simplification process itself, the orchestrator may continue or abort it only after verifying that doing so cannot affect pre-existing work.

---

## Conflict Recovery

When integrating agent work:

1. Inspect every conflict.
2. Understand each side's semantic intent.
3. Check for pre-existing dirty-state interaction.
4. Resolve conflicts minimally.
5. Run relevant tests.
6. Review the resulting diff.

Never apply repository-wide:

`--ours`

or:

`--theirs`

These may only be used for an individual file/hunk when the orchestrator has verified that the selected side is semantically correct.

If ownership cannot be established confidently, abort only the simplification-owned integration and preserve both sides for inspection.

---

## Recovery Snapshots

Before high-risk integration or recovery, create a recoverable Git reference where practical.

Examples:

- temporary branch
- temporary tag
- dedicated worktree
- stash containing agent-owned changes

Example name:

`recovery/pre-wave-3-integration`

Do not delete recovery references until the corresponding iteration has been successfully committed and verified.

---

## Dirty Starting Repository Decision Tree

**Can a separate worktree safely be created?**

YES
→ use it and leave the original worktree untouched.

NO
↓

**Can dirty state be reversibly preserved without ambiguity?**

YES
→ preserve, verify, branch, continue.

NO
↓

STOP with:

**STOP — DIRTY WORKTREE CANNOT BE SAFELY ISOLATED**

Include:

- current branch
- current HEAD
- dirty path inventory
- staged path inventory
- untracked path inventory
- reason isolation failed
- no-destructive-action confirmation

Do not escalate to increasingly destructive commands merely to continue autonomously.

---

## End-of-Run Restoration Rules

Do not automatically merge simplification changes into the original dirty branch.

Do not automatically reapply preserved dirty changes onto the simplification branch.

Report:

- original branch
- original HEAD
- preservation mechanism
- references/stashes created
- restoration status

Where applicable report:

**ORIGINAL DIRTY WORKTREE PRESERVED UNCHANGED**

---

## Dirty-Worktree Invariants

1. Pre-existing work is never intentionally discarded.
2. Unknown work is treated as user work.
3. Simplification commits contain only simplification-owned changes.
4. User changes are never silently incorporated into simplification commits.
5. Untracked files are never disposable merely because they are untracked.
6. Existing staged state is protected.
7. Destructive recovery is never the default.
8. Isolation is preferred over mutation.
9. Recovery should be reversible where practical.
10. If ownership cannot be established, stop instead of guessing.

---

# Commit After Every Iteration

Every successful simplification iteration must end in a Git commit.

An iteration is:

**Analyze → Delegate → Simplify → Integrate → Validate → Review → Remediate → Revalidate → Commit**

Do not accumulate multiple completed iterations into one large commit.

After each successful iteration:

1. Review the complete diff.
2. Confirm unrelated files were not modified.
3. Run required validation.
4. Resolve material reviewer findings.
5. Stage only iteration-owned changes.
6. Create a Git commit.
7. Record its hash and subject in the checkpoint.

Recommended commit formats:

`refactor(scope): simplify <area>`

`refactor(scope): remove redundant <component>`

`cleanup(scope): remove dead <feature>`

`cleanup(deps): remove unused <dependency>`

`perf(scope): simplify <path> and reduce work`

`fix(scope): simplify <logic> while fixing <defect>`

Examples:

`refactor(auth): consolidate session validation`

`cleanup(api): remove obsolete compatibility handlers`

`refactor(reports): eliminate duplicate filtering paths`

`cleanup(deps): remove unused client libraries`

Do not use meaningless subjects such as:

- `changes`
- `updates`
- `cleanup`
- `optimization`
- `fix stuff`
- `iteration 2`

---

# Commit Safety Rules

A commit may only be created when:

- the implementation is internally coherent
- relevant tests pass
- applicable type/lint/build checks pass
- no known material reviewer finding remains unresolved
- another engineer could safely check out the commit

Never commit:

- known broken builds
- critical failing tests
- incomplete refactors
- temporary debugging code
- secrets
- generated credentials
- `.env` values
- unrelated user changes

If an iteration cannot safely reach a committable state, revert only the simplification-owned work from that iteration while preserving unrelated user work, document the failure, and continue only if safe.

---

# Baseline Metrics

Before simplification, measure where practical:

- production LOC
- test LOC
- tracked source-file count
- direct dependency count
- major module count
- obvious duplicate implementations
- major abstraction layers
- major configuration surfaces

Do not fabricate unavailable metrics.

---

# Iteration Metrics

After every iteration record:

- production LOC added
- production LOC removed
- net production LOC change
- test LOC added/removed
- files added
- files removed
- dependencies added
- dependencies removed
- abstractions added
- abstractions removed
- duplicate implementations eliminated
- configuration paths eliminated
- API paths eliminated where appropriate

Prefer:

**negative net production LOC**

Positive production LOC is acceptable when required for:

- security
- correctness
- meaningful regression coverage
- temporary migration safety

Any other significant production LOC increase requires explicit justification.

Do not optimize metrics mechanically.

---

# Parallel Agent Strategy

Use Muse Spark agents on independent scopes.

Possible allocation:

### Muse Agent 1 — Dead Code / Exports

Find and safely remove:

- unused modules
- unused exports
- unreachable branches
- obsolete helpers
- stale compatibility code

### Muse Agent 2 — Dependencies / Configuration

Find and simplify:

- unused packages
- duplicate packages
- unnecessary configuration
- obsolete environment variables
- redundant feature flags

### Muse Agent 3 — Duplication / Abstraction Reduction

Find:

- repeated business logic
- duplicate validation
- pass-through wrappers
- unnecessary services/managers
- duplicate repository/database methods

Consolidate only when complexity genuinely decreases.

### Muse Agent 4 — Control/Data Flow / Tests

Reduce:

- unnecessary mutable state
- callback nesting
- redundant transformations
- excessive branching
- unnecessary async layers

Maintain or improve relevant regression coverage.

These are examples, not fixed assignments.

Do not assign overlapping write scopes.

---

# Implementation Escalation Procedure

If Muse cannot safely complete a task:

1. Capture Muse's findings.
2. Preserve useful analysis.
3. Do not discard repository state blindly.
4. Narrow the unresolved technical question.
5. Send only the difficult portion to DeepSeek V4 Flash.
6. Integrate the escalated solution through the orchestrator.
7. Validate normally.

Avoid asking the paid model to rediscover everything Muse already established.

---

# Dependency Reduction

Review dependency manifests.

For every direct dependency ask:

- Is it actually imported?
- Is it still necessary?
- Is equivalent functionality already available?
- Is it used only for trivial functionality?
- Can native/runtime APIs replace it?
- Does another existing dependency already cover it?
- Does removing it simplify build/deployment/security maintenance?

Prefer removing dependencies when doing so materially reduces maintenance or supply-chain surface.

Do not replace one dependency with another merely for novelty.

---

# Abstraction Reduction

Inspect:

- services
- managers
- repositories
- factories
- adapters
- wrappers
- interfaces
- hooks
- providers
- generic utilities
- facades
- pass-through modules

Consider collapsing layers that only forward calls.

However, preserve abstractions representing real boundaries such as:

- security
- persistence
- external integrations
- platform boundaries
- substantial test seams
- transactional boundaries

Do not remove an abstraction merely because it has one implementation if it protects a meaningful architectural boundary.

---

# API Surface Reduction

Where compatibility permits, identify and reduce:

- duplicate endpoints
- obsolete internal APIs
- aliases
- redundant overloads
- duplicate handlers
- unnecessary exports
- legacy compatibility paths
- unnecessary public symbols

Prefer one obvious supported path.

Do not remove externally required behavior without evidence that it is obsolete.

---

# Configuration Reduction

Look for:

- unused environment variables
- duplicate settings
- duplicated defaults
- obsolete flags
- values that can be derived
- dead configuration branches
- multiple settings controlling the same behavior

Prefer fewer independent configuration knobs.

Check deployment/runtime references before deleting configuration.

Never remove operationally required configuration based only on static-code absence.

---

# Database Simplification

Look for:

- duplicate queries
- repeated mapping logic
- redundant repository methods
- application-side filtering that belongs in SQL
- unnecessary transaction wrappers
- repeated pagination logic
- multiple data-access paths doing the same job

Do not simplify away:

- constraints
- transactions
- locks required for correctness
- integrity checks
- indexes required for workload performance

Never trade data safety for fewer lines of code.

---

# Performance Simplification

Prefer performance improvements based on doing less:

- fewer queries
- less data loaded
- fewer loops
- fewer transformations
- fewer network calls
- fewer allocations
- less repeated computation

Avoid introducing elaborate caching or concurrency machinery unless clearly justified.

Do not claim performance improvement without evidence.

Where practical capture:

**Before → Change → After**

using:

- query count
- execution time
- memory usage
- network requests
- bundle size
- execution plan
- render count
- algorithmic complexity
- benchmark results

If not measured, explicitly state that the performance benefit is expected rather than demonstrated.

---

# Validation

For each iteration, run applicable:

- type checks
- lint
- unit tests
- integration tests
- E2E tests
- build
- static analysis

When deleting code verify:

- imports still resolve
- dynamic references were considered
- configuration references were considered
- externally consumed APIs were considered
- build succeeds
- affected tests pass
- runtime behavior remains valid where it can be checked

Do not delete tests merely because production code was deleted unless the test itself has become genuinely obsolete.

Do not disable tests to obtain a passing result.

---

# Reviewer Procedure

For significant iterations, DeepSeek V4 Flash receives:

- objective
- original behavior
- removed/simplified code
- relevant architecture context
- diff
- tests
- validation results
- expected invariants
- known risks

Review specifically for:

- behavior accidentally removed
- dynamic references missed
- compatibility breakage
- security regressions
- authentication/authorization regressions
- transaction issues
- concurrency issues
- excessive coupling
- oversimplification
- test coverage loss
- incorrect assumptions about dead code
- abstractions removed that represented real boundaries

Return:

**APPROVE**

or:

**REQUEST CHANGES**

Material requested changes must be resolved before committing.

---

# High-Risk Review Escalation

Kimi K2.7 Code receives only the relevant high-risk context.

Provide:

- disputed/high-risk change
- architecture context
- relevant diff
- reviewer concerns
- tests
- validation results

Request an independent assessment.

Use Kimi only when the added reasoning value justifies the cost.

---

# Recursive Simplification Cycle

Repeat:

**Analyze**

↓

**Identify removable complexity**

↓

**Prioritize**

↓

**Delegate to ≤4 Muse Spark agents**

↓

**Delete / Consolidate / Simplify**

↓

**Escalate difficult implementation only when necessary**

↓

**Integrate**

↓

**Validate**

↓

**DeepSeek review when significant**

↓

**Kimi escalation only if warranted**

↓

**Remediate**

↓

**Revalidate**

↓

**Commit**

↓

**Measure simplification**

↓

**Re-analyze**

---

# Iteration Acceptance Criteria

An iteration should normally satisfy at least one of:

- fewer production LOC
- fewer source files
- fewer dependencies
- fewer code paths
- fewer abstractions
- less duplicated logic
- less mutable state
- simpler data flow
- simpler control flow
- simpler API surface
- simpler configuration
- lower conceptual complexity

If an iteration adds more production code than it removes, explicitly explain why the increase is necessary.

Security and correctness fixes are exempt when additional code is genuinely required.

---

# Hourly Usage Budget

When actual quota telemetry is available:

Stop when:

**Hourly quota remaining <= 30%**

or:

**Hourly quota consumed >= 70%**

Do not begin another iteration after reaching the threshold.

Before every new iteration, evaluate:

- remaining quota
- expected task complexity
- number of Muse agents needed
- expected DeepSeek review cost
- whether Kimi escalation might be needed
- priority of remaining findings
- likelihood of reaching a clean commit before the threshold

As the threshold approaches:

1. Stop P3 work.
2. Reduce speculative exploration.
3. Reduce parallelism.
4. Finish the current coherent iteration.
5. Run essential validation.
6. Obtain required review.
7. Commit.
8. Record checkpoint.
9. Stop.

If telemetry is unavailable, record exactly:

**HOURLY QUOTA STATUS: UNAVAILABLE**

Never estimate, infer, or invent quota consumption.

---

# Quota Stop Procedure

If hourly quota remaining reaches or falls below 30%:

Do **not** start another iteration.

If current work has reached a coherent validated state:

1. complete required review
2. resolve material findings
3. revalidate
4. commit
5. record the commit hash
6. produce the resume checkpoint
7. stop

If the quota becomes constrained before the current iteration can safely be completed, prioritize restoring the simplification branch to a safe, understandable state without damaging pre-existing user changes.

Do not create a misleading "completed" commit solely to satisfy the iteration rule.

---

# Checkpoint After Every Commit

Record:

## Iteration

Iteration identifier.

## Objective

What was simplified.

## Priority

P0 / P1 / P2 / P3.

## Exact Models Used

Include:

- orchestrator
- each Muse agent
- implementation escalations
- reviewer
- reviewer escalation

## Agent Assignments

Which agent handled each task.

## Files Removed

## Files Added

## Production LOC Removed

## Production LOC Added

## Net Production LOC Change

## Test LOC Change

## Dependencies Removed/Added

## Abstractions Removed/Added

## Duplication Eliminated

## Configuration/API Paths Eliminated

## Behavior Preserved

State the relevant behavior/invariants preserved.

## Validation

List exact commands/checks and results.

## Reviewer Result

One of:

- APPROVED
- CHANGES REQUIRED
- APPROVED AFTER REMEDIATION
- REVIEW NOT REQUIRED — LOW RISK

## Git Commit

Record:

- branch
- commit hash
- commit subject

## Paid-Model Escalations

For each escalation:

- task
- reason
- model used
- outcome

## New Findings

## Remaining Quota

Use actual telemetry only.

## Next Decision

Choose one:

- CONTINUE
- REDUCE PARALLELISM
- ESCALATE IMPLEMENTATION
- FINAL REVIEW
- STOP — QUOTA THRESHOLD
- STOP — SIMPLIFICATION COMPLETE

---

# Resume State

When stopping due to quota or another condition, record:

## Repository

- simplification branch
- base branch
- base commit
- current HEAD
- worktree status

## Model Assignments

Exact OpenCode model IDs actually used.

## Completed Iterations

For each:

- iteration ID
- priority
- objective
- commit hash
- reviewer status

## Work In Progress

For each incomplete task:

- current state
- files touched
- remaining steps
- known risks

## Pending Queue

For every remaining finding:

- priority
- problem
- evidence
- proposed action
- dependencies
- suggested Muse/DeepSeek assignment

## Preserved Dirty State

If applicable:

- original branch
- original HEAD
- preservation method
- stash/reference identifier
- restoration status

## Resume Instruction

State the exact next recommended action so a future run can continue without repeating completed analysis.

---

# Stopping Conditions

Stop recursive simplification when any of the following applies.

## Condition A — Hourly Quota

**Remaining <= 30%**

or:

**Consumed >= 70%**

when quota telemetry exists.

## Condition B — Simplification Complete

Remaining opportunities are predominantly:

- cosmetic
- subjective
- negligible
- high-risk relative to benefit
- dependent on product/business decisions
- dependent on unavailable runtime evidence
- likely to reduce readability
- likely to increase coupling
- architecture rewrites without compelling evidence

## Condition C — Unsafe Repository State

A critical unresolved issue prevents safe continuation.

## Condition D — Dirty Worktree Cannot Be Safely Isolated

Report:

**STOP — DIRTY WORKTREE CANNOT BE SAFELY ISOLATED**

Do not attempt increasingly destructive actions merely to continue.

---

# Final Repository Pass

Before normal completion, inspect again for:

- dead code
- duplicate logic
- unnecessary dependencies
- unnecessary abstractions
- unnecessary configuration
- unnecessary state
- duplicate APIs
- obsolete compatibility paths
- security regressions
- correctness regressions
- authentication/authorization regressions
- transaction/concurrency regressions
- broken tests
- build failures
- deployment issues

Run the broadest practical validation suite.

Use DeepSeek V4 Flash for final review.

Use Kimi K2.7 Code only if final review identifies a high-risk unresolved question.

Reviewer-requested material corrections become another committed iteration.

---

# Final Git State

At normal completion:

- remain on the dedicated simplification branch
- do not automatically merge into `main`, `master`, release, or production branches
- do not automatically push
- keep worktree clean where practical
- preserve complete iteration commit history
- preserve any original dirty worktree state

Report commits in chronological order.

---

# Final Report

Provide:

## Executive Summary

Describe how the repository became smaller and simpler.

## Models Used

Record exact OpenCode IDs and which were free/paid where that information is actually available.

## Paid-Model Escalations

For every escalation:

- reason
- task
- model
- result

## Branch

- base branch
- simplification branch
- base commit
- final HEAD

## Size Comparison

Where measurable:

| Metric | Before | After | Change |
|---|---:|---:|---:|
| Production LOC | | | |
| Test LOC | | | |
| Source files | | | |
| Direct dependencies | | | |
| Major abstractions | | | |
| Duplicate implementations | | | |
| Configuration paths | | | |

Do not fabricate unavailable measurements.

## What Was Removed

Summarize:

- dead code
- files
- dependencies
- duplicate implementations
- abstractions
- configuration
- obsolete compatibility logic
- unnecessary API paths

## What Was Consolidated

Describe duplicate implementations and code paths merged into one.

## What Was Simplified

Summarize major control-flow, data-flow, API, database, configuration, and architecture simplifications.

## Validation

Report exactly what was executed and the result.

## Commit History

List all iteration commits chronologically.

## Remaining Complexity

Identify areas intentionally left unchanged and why.

## Preserved Dirty State

Document any preserved original worktree state.

## Git Status

Report final working-tree state.

---

# Core Operating Principle

Optimize for:

**Correctness → Security → Simplicity → Reliability → Maintainability → Performance**

For codebase simplification:

**Delete before adding.**

**Consolidate before abstracting.**

**Reuse before creating.**

**Reduce concepts, not just characters.**

**Prefer one obvious path.**

**Prefer boring code over clever code.**

**Prefer a smaller understandable system over a larger "perfectly architected" one.**

For model usage:

**GLM 5.3 free for orchestration.**

**Muse Spark 1.3 free for implementation.**

**DeepSeek V4 Flash only for difficult implementation and independent review.**

**Kimi K2.7 Code only for genuinely high-risk review.**

The target is:

> **Less code, fewer concepts, same required behavior, minimum paid-model consumption.**

---

# Start Now

The orchestrator must:

1. Inspect OpenCode's current model/provider catalog.
2. Resolve exact model IDs for:
   - GLM 5.3 via TokenRouter
   - Muse Spark 1.3
   - DeepSeek V4 Flash
   - Kimi K2.7 Code if available
3. Record the selected model IDs and substitutions, if any.
4. Inspect Git state:
   - current branch
   - HEAD
   - staged files
   - tracked modifications
   - deletions
   - untracked files
   - active merge/rebase/cherry-pick/revert/bisect state
5. Establish the **PRE-OPTIMIZATION WORKTREE BASELINE**.
6. If the worktree is dirty, isolate simplification work using a separate Git worktree whenever practical.
7. If worktree isolation is unavailable, preserve pre-existing work using a reversible mechanism and verify preservation before proceeding.
8. If dirty state cannot be isolated safely, stop without destructive action.
9. Create:

   `opt/recursive-codebase-simplification`

10. Measure baseline codebase size metrics where practical.
11. Build a lightweight architecture/dependency map.
12. Search for deletion opportunities first.
13. Identify any P0 correctness/security issues.
14. Rank the highest-value simplification opportunities.
15. Create the first small, coherent simplification iteration.
16. Delegate independent work to no more than four Muse Spark 1.3 agents.
17. Use fewer agents when scopes are not truly independent.
18. Escalate individual difficult tasks to DeepSeek V4 Flash only when justified.
19. Inspect all returned changes against assigned scopes and the pre-optimization baseline.
20. Integrate only simplification-owned changes.
21. Validate behavior.
22. Use DeepSeek V4 Flash for significant independent review.
23. Escalate review to Kimi K2.7 Code only when high-risk complexity justifies it.
24. Resolve material reviewer findings.
25. Re-run affected validation.
26. Commit the coherent iteration.
27. Record the commit hash, metrics, model usage, and review state.
28. Re-analyze the affected subsystem for further removable complexity.
29. Check actual hourly quota telemetry.
30. Continue only while meaningful simplification remains and quota permits.
31. Stop when hourly quota remaining reaches 30% or less, when measurable.
32. Leave the final result on the simplification branch.
33. Do not automatically merge or push.
34. Preserve any original dirty worktree state exactly unless a documented reversible preservation action was required.

Never invent:

- model availability
- pricing/free status
- model IDs
- quota state
- validation results
- benchmark results
- performance measurements
- simplification metrics

The target is not "more optimized code."

The target is:

> **Less code, fewer concepts, same required behavior, with free models doing the majority of the work.**
