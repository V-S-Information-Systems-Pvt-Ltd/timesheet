# Global reminder banner decision packet

Question: how can administrators choose banner presentation while retaining
existing reminder timing, dismissal, backends and older clients?

Constraints: preserve action names, response envelopes, authorization and personal
reminders. Add migrations rather than modifying applied SQL. Banners must remain
visible across dashboard tabs and with the reminder tile disabled. Failed
dismissal must not hide a reminder.

Evidence: `FACT` — `GlobalRemindersPanel` previously loaded due reminders inside
the optional tile. `FACT` — `createGlobalReminder` validates input at the domain
boundary; native explicit SELECT/INSERT and Supabase inserts require the new
field. `FACT` — application backup exports explicit columns; native and Supabase
restores deduplicated only by message/time. `FACT` — portable `entitySpec` and
`canonicalizeRow` require exact v1/v2 columns, making an unversioned addition
incompatible with old fingerprints.

Alternatives: a user-only preference cannot express per-announcement intent;
duplicating tile and banner fetching risks inconsistent dismissal. The chosen
additive boolean with a shared dashboard provider preserves defaults and avoids
duplicate presentation. A portable v3/sidecar is outside this UI task; root review
approved preserving v1/v2 and documenting the omission.

Acceptance: create true/false and reject invalid flags; omission defaults false;
native/Supabase persist and map preferences; future/dismissed reminders stay
hidden; dismissal failure keeps the banner; application backups roundtrip mixed
preferences with repeat-restore idempotency. Targeted domain, transport, adapter,
dashboard controller and backup tests cover these contracts. `UNKNOWN` — runtime
migration execution and mounted browser behavior require a test database and
production browser verification; unit tests alone do not establish these.
