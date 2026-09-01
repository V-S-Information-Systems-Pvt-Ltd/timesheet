# Architecture Decision & Spike: Mobile Cross-Platform CSV File Export

**Date**: 2026-09-01  
**Status**: Proposed — compatibility proof pending
**Scope**: Mobile client (Android, iOS, React Native Windows 0.84), Web, and Next.js 16 REST export endpoint.

---

## 1. Context and Problem Statement

Previously, timesheet export on mobile fetched all CSV rows into memory as a raw text string and passed it to `Share.share({ message: csvContent })`. On mobile devices, this resulted in:
1. Large exports consuming excessive JS heap memory and risking OOM crashes.
2. In-memory text blobs presented as raw message bodies (chat/email messages) rather than downloadable `.csv` spreadsheet files attached to the device's native file storage or share sheet.
3. Inability for users on Android, iOS, or Windows to directly "Save to Files" or open in Excel / Sheets.
4. Redundant fetches on the server when streaming chunks.

---

## 2. Server Export Protocol (`/api/v1/reports/export`)

The server endpoint streams RFC 4180 CSV rows authenticated with the standard bearer token:

### HTTP Request
```http
GET /api/v1/reports/export?from=2026-08-01&to=2026-08-31&project=p1&userId=u1 HTTP/1.1
Authorization: Bearer <mobile_access_token>
```

### HTTP Response Specification
1. **Empty Dataset (0 matching rows)**:
   - Status: `204 No Content`
   - Headers: `X-Total-Count: 0`
   - Body: empty.
2. **Non-Empty Dataset (≥ 1 matching rows)**:
   - Status: `200 OK`
   - Headers:
     - `Content-Type: text/csv; charset=utf-8`
     - `Content-Disposition: attachment; filename="timesheets_YYYYMMDD_YYYYMMDD.csv"`
     - `X-Total-Count: <total_count>`
   - Body: `ReadableStream<Uint8Array>` streaming standard CSV headers followed by sequential 500-row chunks.

---

## 3. Proposed platform-neutral client workflow

The unsafe legacy path that buffered a successful CSV response as text and
called `Share.share({ message })` has been removed. The current code contains a
tested, platform-neutral `ReportFileExporter` state machine, but the production
platform factory deliberately returns `native-file-export-not-ready`; both
report screens therefore remain without export controls. Android, iOS, and
React Native Windows file/share adapters and device evidence are still pending.

The diagram below is the intended workflow. Its protocol validation, typed
outcomes, retry policy, filename sanitization, and injected file/share boundary
are implemented in the pure core. Native file creation, share/save UI, and
cleanup remain unimplemented and unverified on devices.

```
[Trigger Export]
       │
       ▼
[Fetch Stream with Bearer Auth]
       │
   ┌───┴────────────────────────────┐
   ▼                                ▼
[HTTP 204 / 0 Count]         [HTTP 200 Stream]
   │                                │
   ▼                                ▼
Return { status: 'empty' }   [Write to Unique Temp CSV File]
                                    │
                                    ▼
                             [Invoke Native Share / Save]
                             (Android / iOS / Windows)
                                    │
                                    ▼
                             [Cleanup Temp File in finally]
                                    │
                                    ▼
                             Return Typed Outcome
                             ('saved' | 'shared' | 'cancelled')
```

### Compatibility evidence required before implementation

| Platform | File write | Share/save UI | Cleanup | Evidence |
| --- | --- | --- | --- | --- |
| Android | Hypothesis | Hypothesis | Hypothesis | Not recorded |
| iOS | Hypothesis | Hypothesis | Hypothesis | Not recorded |
| React Native Windows 0.84 | Hypothesis | Hypothesis | Hypothesis | Not recorded |

---

## 4. Proposed error handling and cleanup invariant

The following requirements are acceptance criteria, not assertions about the
current application:

1. **Abortion**: cancellation must release and remove partial temporary files.
2. **Guaranteed cleanup**: deletion must occur in `finally` after success,
   cancellation, and failure.
3. **Outcome typing**: callers should receive a strongly typed union:
   ```typescript
   export type CsvExportOutcome =
     | { status: 'saved'; count: number; filename: string }
     | { status: 'shared'; count: number; filename: string }
     | { status: 'empty'; count: 0 }
     | { status: 'cancelled' }
     | { status: 'failed'; message: string };
   ```

---

## R2 implementation record (2026-09-01) — typed contract implemented, controls stay absent

Per `MOBILE_ADMIN_CUSTOMIZATION_REVIEW_FINDINGS_FIX_PLAN.md` R2 (STOP gate):
export controls stay absent until all three adapters have real artifact
evidence. This pass implemented the platform-independent core only:

### Dependency/native-module decision (R2.2)
- No pinned dependency supports stream-to-file + native share/save + cleanup
  on all three targets (RN 0.84.1, RNW 0.84.0) without adding a native module
  that this codebase does not yet pin. `Share.share({ message })` is excluded
  by rule; `response.text()` for successful CSV is excluded by rule.
- Decision: implement owned Android/iOS/Windows adapters behind
  `ReportFileExporter` after the real-file spike. **Pending operator device
  evidence** — no artifact recorded yet.

### Implemented (R2.1/R2.3 core)
- `mobile/src/services/reportFileExport.ts` — typed
  `interface ReportFileExporter { export(request): Promise<ReportExportOutcome> }`
  with outcomes `shared | saved | empty | cancelled | failed(retryable, reason)`;
  validates status, `Content-Type`, `X-Total-Count`,
  sanitized `Content-Disposition` filename; streams to a unique temp `.csv`
  file; deletes partial/complete files in `finally` (success, cancel, timeout,
  error); single refresh-and-retry after 401.
- `mobile/__tests__/report-file-export.test.ts` — mocked unit coverage for empty,
  success, cancel, 401 refresh, 403, timeout/abort, response status/count,
  invalid content type, malicious and platform-invalid filenames, disk failure,
  partial download, share failure, cleanup failure, and retry. It asserts the
  share surface receives a file URI ending in `.csv` and never CSV text in a
  `message` field. These tests exercise the pure core, not native adapters.
- `mobile/src/auth/SessionProvider.tsx` — `exportReportsFile(params, { signal })`
  replaces `exportReportsCsv`; `mobile/src/api/client.ts` `exportReportsCsv`
  removed.
- `rg "Share\.share|response\.text\(\)" mobile/src/screens mobile/src/services`
  finds no successful report-export text path.

**Status remains `Proposed`** until all three platforms share/save a real CSV
file artifact and the cleanup results are recorded here.

### Post-remediation hardening (P2, 2026-09-01) — no native workflow accepted

Following the post-remediation review, the typed core was hardened but no
native file workflow is accepted:

- `exportWithRetry` now triggers a token refresh only for the exact
  `{ kind: 'failed', retryable: true, reason: 'unauthorized' }` outcome;
  network, partial-download, disk, validation, sharing, and cleanup failures
  never rotate auth state (one refresh, one reissued request, cancellation
  preserved).
- The response contract is enforced before any temporary file is created:
  only `200` and `204` are accepted; `204` is `empty` only with canonical
  `X-Total-Count: 0`; `200` requires `0` or a positive decimal without leading
  zeros (missing/malformed values are non-retryable `invalid-total-count`);
  unexpected 2xx responses such as `206` are rejected before stream/file/share
  side effects; `200` + `0` returns `empty` without touching adapters.
- The pure-core `sanitizeExportFilename` discards traversal, replaces
  `<>:"/\|?*`, trims trailing Windows dots/spaces, rejects Windows device-name
  stems even with extra extensions, forces one lowercase `.csv`, drops unpaired
  surrogates, and caps the full result at 244 UTF-8 bytes. Real native filename
  behavior remains part of the pending device spike.
- 33 mocked unit tests cover retry, status/count, and filename regressions.

**Status remains `Proposed`.** Export controls stay absent until Android, iOS,
and React Native Windows create, share/save, and clean a real CSV file and the
cleanup results are recorded here.
