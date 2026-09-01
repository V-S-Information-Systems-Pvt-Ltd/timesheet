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

The intended client workflow is below. It is not implemented or verified: the
current prototype reads the response as text and shares it as a message, rather
than creating a file artifact.

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
