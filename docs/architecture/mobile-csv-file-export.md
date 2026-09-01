# Architecture Decision & Spike: Mobile Cross-Platform CSV File Export

**Date**: 2026-09-01  
**Status**: Accepted  
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

## 3. Platform-Neutral Client Workflow

The client uses `mobile/src/services/csvExport.ts` with a standardized lifecycle:

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

### Platform Compatibility Matrix
- **Android**: Saves temporary file to application cache/temp directory; invokes Android Share Intent with MIME `text/csv` or Storage Access Framework.
- **iOS**: Uses `UIActivityViewController` referencing `file://...` URI, enabling "Save to Files", AirDrop, and third-party spreadsheet apps.
- **React Native Windows (RNW 0.84)**: Writes to local temp storage (`AppData\Local\Temp`), supports Windows `FileSavePicker` / `DataTransferManager` share contracts.

---

## 4. Error Handling and Cleanup Invariant

1. **Abortion**: When user cancels an active download, `AbortController.abort()` triggers and temp file handles are immediately released and removed.
2. **Guaranteed Cleanup**: Temporary file deletion is performed in a `finally` block to prevent storage leaks.
3. **Outcome Typing**: Callers receive a strongly-typed union:
   ```typescript
   export type CsvExportOutcome =
     | { status: 'saved'; count: number; filename: string }
     | { status: 'shared'; count: number; filename: string }
     | { status: 'empty'; count: 0 }
     | { status: 'cancelled' }
     | { status: 'failed'; message: string };
   ```
