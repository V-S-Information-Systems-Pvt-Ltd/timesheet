# Neon preview cutover — 2026-10-16

Target: Neon project `timesheet-vsis`, branch `preview` (`br-old-frog-b7pgbjo4`).
Production was not touched. Script: [`scripts/neon-preview-cutover.sql`](../../scripts/neon-preview-cutover.sql).

## Result

| Step | Outcome |
| --- | --- |
| Retire records dated before 2026-10-01 | 839 rows (2026-08-05 → 2026-09-30, 2,673 h) moved to `public.timesheets_archive`; 0 remain in `timesheets` |
| Convert old-format rows from 2026-10-01 | 16 of 45 converted; originals logged in `public.timesheet_format_conversions` |
| Conflicts left in old format | 29 rows, listed below; unchanged |
| Retire Telegram | Migration `0042_retire_telegram.sql` applied and recorded in `schema_migrations`; `telegram_no` dropped from `projects` and `activity_types` |

Row count check: 178 live + 839 archived = 1,017 (the starting total).
Live rows by format: internal 58, support 62, project 29, old format 29.

## Conversion rule

An old-format row is converted only when its activity type and project kind map
to exactly one new Type → Activity. Project kind means a real timesheet project
versus the reserved Internal/Support rows.

| Old activity type | Project kind | New format | Converted |
| --- | --- | --- | --- |
| Certification | Internal/Support | internal → certifications | 4 |
| Meeting | Internal/Support | internal → meetings | 4 |
| R&D | Internal/Support | internal → research_development | 4 |
| POC | Internal/Support | internal → poc | 0 |
| Presales support | Internal/Support | internal → presales_support | 0 |
| Implementation | real project | project → implementation (project kept) | 3 |
| R&D | real project | project → research_development (project kept) | 1 |

Internal entries drop `project_id`; every converted row drops `activity_type_id`.

## Conflicts and how to match them

The new format needs facts the old rows never recorded. Each group below has a
suggested match; none has been applied.

### A — Support with one ticket in the description (13 rows)

Suggested: `support → customers`, `ticket_number` = the ticket from the
description, normalised (spaces removed: `INC 00088370` → `INC00088370`).

| Record | Date | Hours | Ticket | Work |
| --- | --- | --- | --- | --- |
| `ddb3c908-bf79-4d53-abaa-3197e481921c` | 10-01 | 1.50 | INC00085952 | part replacement coordination |
| `ad02156e-6857-49a2-8f6a-76e9bff1c5a5` | 10-01 | 2.50 | INC00085952 | part replacement coordination |
| `0df2b589-9e86-4835-bc7f-7517a8161e3c` | 10-01 | 4.00 | SVR00088220 | BitLocker policy in Intune |
| `663a37e1-1739-4571-b07f-b092cf53bc55` | 10-01 | 4.00 | SVR00088280 | (ticket only) |
| `8353f348-b334-41e4-81a1-e5c51df74acc` | 10-02 | 1.00 | INC00088422 | Oracle HDD issue |
| `d8a91b86-65c8-4878-ac3d-df20e2a6b5bc` | 10-05 | 3.00 | INC00088435 | tape library issue |
| `ce2ec995-3175-4ebc-ba62-36425a92d85c` | 10-05 | 2.00 | INC00088435 | SR follow-up |
| `63d33a9e-4079-43a1-b42b-a3dcca89b90f` | 10-05 | 1.00 | INC00088370 | SR follow-up |
| `f29a3a50-a555-450d-b221-fc1a959aeb50` | 10-07 | 2.00 | INC00087424 | iDRAC logging issue |
| `54c8e22d-5f43-4c35-aa34-472a83d2f7f4` | 10-07 | 1.50 | INC00087021 | disk failure |
| `5a2eeb94-dc6c-4771-b192-c38af1556ac8` | 10-09 | 1.50 | INC00087021 | log collection |
| `6f156ca0-c4fe-4edb-b48e-03663a62a576` | 10-09 | 2.50 | INC00088698 | remote session |
| `aa28fbc4-939d-49e4-96cc-98f522f0296e` | 10-09 | 1.00 | INC00088750 | remote session |

### B — Support with several tickets (2 rows)

`ticket_number` holds one value of up to 100 characters. Either store the
comma-joined list, or split the hours across one entry per ticket (needs the
owner's split).

| Record | Date | Hours | Tickets |
| --- | --- | --- | --- |
| `df177791-b739-44f5-8976-ed73a235adbb` | 10-08 | 1.50 | INC00088241, INC00088370, INC00088435 |
| `1237de28-426e-480f-b923-4bb021c61b4c` | 10-03 | 4.00 | SVR00088397, SVR00088398 |

### C — Support with no ticket (12 rows)

The owner must choose `support → customers` (and supply a ticket) or
`support → internal_it` (no ticket). Customer work without a ticket cannot be
stored as `customers`.

| Record | Date | Hours | Work |
| --- | --- | --- | --- |
| `6f64df15-5fd6-4d29-a7b3-6365a91ec9bc` | 10-01 | 1.00 | customer storage capacity check |
| `22514025-6dac-4b3b-b0eb-0d9a4dbd7e82` | 10-01 | 5.00 | customer server issue |
| `28ea69d0-edc5-44ac-b392-80eb49ce97df` | 10-02 | 2.00 | customer server OS installation |
| `7e76dfa2-5dd1-4fdc-813d-d05e9ebf5888` | 10-02 | 2.00 | Veeam CDP filter deployment |
| `8e24edf0-d9ce-4879-8a6f-6afcd4b3cdf5` | 10-02 | 3.00 | VMware alarm check |
| `c37d09f4-4539-4a74-8110-3d6a07ed322f` | 10-02 | 4.00 | STG Longhorn volume migration — likely `internal_it` |
| `b62f507d-8d1e-4bb9-9445-7a61a149099b` | 10-03 | 7.00 | customer DR drill |
| `24048746-6bf5-4dfa-85d2-addc1d33897d` | 10-05 | 4.00 | vSphere replication issue |
| `4266cd96-2cb8-4958-b267-e11f390ce461` | 10-05 | 2.00 | LLD support — possibly presales |
| `e6bfae62-7cd6-4fb3-a158-8269fa8309a5` | 10-05 | 2.00 | HyperFlex licensing issue |
| `27282dcb-f4d7-4584-97ae-1246c13d2281` | 10-06 | 1.50 | hardware commissioning |
| `307694b3-1058-4d55-8995-ea7ea4168293` | 10-06 | 4.00 | Rancher PROD Longhorn issue |

### D — Support on a real project (1 row)

`c60b8112-dcfe-40ce-8c3b-16509413842e` (10-02, 4.00 h, TATA Lanka Server Project,
"LLD document creation"). The new Project type has no support activity. The
description is design work, so the suggested match is `project → planning` on the
same project.

### E — Implementation on Internal (1 row)

`0291eb98-09e8-484e-9daa-cd48d088ade5` (10-02, 3.25 h, "supported LLD creation
for TATA"). The Internal type has no implementation activity. Suggested: either
`internal → other` with `activity_other = 'Implementation'`, or
`project → planning` on TATA Lanka Server Project.

## Applying a decision

Run per row on the preview branch, recording the original in the conversion log
first. Example for group A:

```sql
insert into public.timesheet_format_conversions
  (timesheet_id, old_project_id, old_activity_type_id, new_entry_type, new_activity_code)
select id, project_id, activity_type_id, 'support', 'customers'
from public.timesheets where id = '<record id>' and entry_type is null;

update public.timesheets
set entry_type = 'support', activity_code = 'customers', ticket_number = '<ticket>',
    project_id = null, activity_type_id = null
where id = '<record id>' and entry_type is null;
```

The undo statements are at the end of the cutover script.
