// mobile/src/services/reportFileExport.ts
// Typed report CSV file export, independent of React components and of any
// native file/share module.
//
// Post-remediation contract
// (docs/plans/mobile-admin-parity/MOBILE_ADMIN_CUSTOMIZATION_REVIEW_FINDINGS_FIX_PLAN.md, R2):
//  * the request carries the authenticated endpoint, bearer token, abort
//    signal, and suggested filename — never CSV content;
//  * the outcome covers shared / saved / empty / cancelled / failed without
//    exposing file contents or tokens;
//  * a successful CSV response is streamed to a unique app-owned temporary
//    .csv file and never buffered via response.text();
//  * partial and complete files are deleted in `finally` after success,
//    cancellation, timeout, and error.
//
// The transport / file / share surfaces are injected so the entire state
// machine is unit-testable in jest without native modules. The production
// platform wiring (Android/iOS/Windows adapters) is supplied by
// `createPlatformReportFileExporter` once the real-file spike lands (R2.2);
// until then the exported `reportFileExporter` returns a distinguishable
// `native-file-export-not-ready` outcome and export controls stay absent.

export type ReportExportOutcome =
  | { kind: 'shared' }
  | { kind: 'saved' }
  | { kind: 'empty' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; retryable: boolean; reason: string };

export interface ReportExportRequest {
  /** Fully-qualified authenticated endpoint, e.g. `${baseUrl}/api/v1/reports/export?...`. */
  url: string;
  /** Bearer token sent in the Authorization header. Never logged or persisted. */
  accessToken: string;
  /** Cancellation signal (unmount / user abort). */
  signal?: AbortSignal | null;
  /** Suggested file base name when the server omits Content-Disposition. */
  suggestedFilename: string;
}

/** Transport response restricted to what the exporter consumes. */
export interface ReportHttpResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  /** Reads the body only for error responses; success bodies go through `stream()`. */
  text(): Promise<string>;
  /** The CSV body as chunks; used exclusively for successful responses. */
  stream(): AsyncIterable<Uint8Array>;
}

export interface ReportFileExporterDeps {
  transport: {
    fetch(request: ReportExportRequest): Promise<ReportHttpResponse>;
  };
  file: {
    /** Creates a unique, app-owned temporary file URI for the sanitized name. */
    createTempUri(name: string): Promise<string>;
    /** Streams chunks to the temp file; throws with `kind: 'disk'` on fs errors. */
    write(uri: string, chunks: AsyncIterable<Uint8Array>): Promise<void>;
    /** Best-effort deletion of partial and complete files. */
    remove(uri: string): Promise<void>;
  };
  share: {
    /** Invokes the native share/save surface; never receives CSV text. */
    invoke(file: { uri: string; name: string; mimeType: string }): Promise<'shared' | 'saved' | 'cancelled'>;
  };
}

export interface ReportFileExporter {
  export(request: ReportExportRequest): Promise<ReportExportOutcome>;
}

/** Thrown by injected surfaces so the core can map failure kinds. */
export class ReportFileError extends Error {
  readonly kind: 'disk' | 'stream' | 'share' | 'refresh';
  constructor(kind: ReportFileError['kind'], message: string) {
    super(message);
    this.name = 'ReportFileError';
    this.kind = kind;
  }
}

const isAbort = (err: unknown): boolean =>
  err instanceof Error && (err.name === 'AbortError' || err.name === 'CanceledError');

const DEFAULT_EXPORT_FILENAME = 'timesheet_report.csv';
const CSV_EXTENSION = '.csv';
/** 240-byte basename + `.csv`, leaving headroom below 255-byte component limits. */
const MAX_EXPORT_BASENAME_BYTES = 240;
/** Windows device names that are invalid as a filename base. */
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
/** Characters that are never legal in a portable filename. */
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*]/g;
/** Trailing Windows-invalid dots/spaces. */
const TRAILING_DOTS_SPACES = /[. ]+$/;

function utf8Width(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function removeUnsafeFilenameCharacters(input: string): string {
  return Array.from(input)
    .filter((char) => {
      const codePoint = char.codePointAt(0);
      return (
        codePoint !== undefined &&
        codePoint > 0x1f &&
        codePoint !== 0x7f &&
        !(codePoint >= 0xd800 && codePoint <= 0xdfff)
      );
    })
    .join('');
}

/** Truncates at Unicode scalar boundaries and drops unpaired UTF-16 surrogates. */
function truncateUtf8(input: string, maxBytes: number): string {
  let bytes = 0;
  let output = '';
  for (const char of input) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined || (codePoint >= 0xd800 && codePoint <= 0xdfff)) continue;
    const width = utf8Width(codePoint);
    if (bytes + width > maxBytes) break;
    output += char;
    bytes += width;
  }
  return output;
}

function isWindowsReservedName(name: string): boolean {
  const stem = (name.split('.')[0] ?? '').replace(TRAILING_DOTS_SPACES, '');
  return WINDOWS_RESERVED_NAMES.test(stem);
}

/**
 * Cross-platform-safe export filename, shared by every platform adapter
 * (P2.3 of the post-remediation review plan):
 *  1. only the filename component survives (path traversal is discarded);
 *  2. control characters are removed and `<>:"/\|?*` become `_`;
 *  3. surrounding whitespace and trailing Windows dots/spaces are trimmed;
 *  4. `.`, `..`, and Windows device-name stems (`CON`, `PRN`, `AUX`, `NUL`,
 *     `COM1`-`COM9`, `LPT1`-`LPT9`) yield the default even with extensions;
 *  5. empty/unusable input yields `timesheet_report.csv`;
 *  6. exactly one lowercase `.csv` extension (never `.csv.csv`);
 *  7. the basename is capped by complete Unicode code points and UTF-8 bytes.
 */
export function sanitizeExportFilename(name: string): string {
  // 1. Discard any directory component.
  const rawBasename = name.split(/[\\/]/).pop() ?? '';
  // 2. Remove controls; replace the reserved filename characters with `_`.
  const cleaned = removeUnsafeFilenameCharacters(rawBasename).replace(INVALID_FILENAME_CHARS, '_');
  // 3. Trim surrounding whitespace and trailing Windows dots/spaces.
  const trimmed = cleaned.trim().replace(TRAILING_DOTS_SPACES, '');
  // 4/6. Remove repeated CSV suffixes before validating the portable basename.
  let baseWithoutCsv = trimmed.replace(/\.csv$/i, '');
  while (/\.csv$/i.test(baseWithoutCsv) && baseWithoutCsv.length > 0) {
    baseWithoutCsv = baseWithoutCsv.replace(/\.csv$/i, '');
  }
  baseWithoutCsv = baseWithoutCsv.trim().replace(TRAILING_DOTS_SPACES, '');
  if (!baseWithoutCsv || baseWithoutCsv === '.' || baseWithoutCsv === '..') {
    return DEFAULT_EXPORT_FILENAME;
  }
  const normalized = baseWithoutCsv.normalize('NFC');
  if (isWindowsReservedName(normalized)) return DEFAULT_EXPORT_FILENAME;

  // 7. Cap without splitting a surrogate pair or exceeding the UTF-8 budget.
  const truncated = truncateUtf8(normalized, MAX_EXPORT_BASENAME_BYTES)
    .trim()
    .replace(TRAILING_DOTS_SPACES, '');
  if (!truncated || isWindowsReservedName(truncated)) return DEFAULT_EXPORT_FILENAME;
  return `${truncated}${CSV_EXTENSION}`;
}

/** Extracts the `filename="..."` token from a Content-Disposition header. */
export function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match?.[1] ?? null;
}

export function createReportFileExporter(deps: ReportFileExporterDeps): ReportFileExporter {
  const failed = (retryable: boolean, reason: string): ReportExportOutcome => ({
    kind: 'failed',
    retryable,
    reason,
  });

  return {
    async export(request): Promise<ReportExportOutcome> {
      if (request.signal?.aborted) return { kind: 'cancelled' };

      let response: ReportHttpResponse;
      try {
        response = await deps.transport.fetch(request);
      } catch (err) {
        if (request.signal?.aborted || isAbort(err)) return { kind: 'cancelled' };
        return failed(true, 'network-error');
      }
      if (request.signal?.aborted) return { kind: 'cancelled' };

      if (response.status === 401) return failed(true, 'unauthorized');
      if (response.status === 403) return failed(false, 'forbidden');
      if (response.status !== 200 && response.status !== 204) {
        return failed(false, `http-${response.status}`);
      }
      if (!response.ok) return failed(false, 'invalid-response-status');

      // Total-count contract (P2.2): no temporary file is created until the
      // response satisfies the complete contract, including a canonical
      // non-negative integer X-Total-Count for 200 and the canonical "0" for
      // 204. Missing, negative, decimal, whitespace-padded, or malformed
      // values are non-retryable invalid-total-count failures.
      const totalCount = response.headers.get('x-total-count');
      const isCanonicalCount = totalCount !== null && /^(?:0|[1-9]\d*)$/.test(totalCount);
      if (response.status === 204) {
        return totalCount === '0' ? { kind: 'empty' } : failed(false, 'invalid-total-count');
      }
      if (!isCanonicalCount) {
        return failed(false, 'invalid-total-count');
      }
      if (totalCount === '0') return { kind: 'empty' };

      const contentType = response.headers.get('content-type') ?? '';
      if (!/^text\/csv(?:\s*;|$)/i.test(contentType)) {
        return failed(false, 'invalid-content-type');
      }

      const dispositionName = parseContentDispositionFilename(response.headers.get('content-disposition'));
      const fileName = sanitizeExportFilename(dispositionName ?? request.suggestedFilename);

      let tempUri: string;
      try {
        tempUri = await deps.file.createTempUri(fileName);
      } catch {
        return failed(false, 'disk-write');
      }

      let outcome: ReportExportOutcome;
      try {
        try {
          await deps.file.write(tempUri, response.stream());
        } catch (err) {
          if (request.signal?.aborted || isAbort(err)) return { kind: 'cancelled' };
          const isDisk = err instanceof ReportFileError && err.kind === 'disk';
          return failed(isDisk ? false : true, isDisk ? 'disk-write' : 'download-incomplete');
        }

        let shareResult: 'shared' | 'saved' | 'cancelled';
        try {
          shareResult = await deps.share.invoke({ uri: tempUri, name: fileName, mimeType: 'text/csv' });
        } catch {
          return failed(false, 'share-failed');
        }
        outcome =
          shareResult === 'shared' ? { kind: 'shared' } : shareResult === 'saved' ? { kind: 'saved' } : { kind: 'cancelled' };
      } finally {
        await deps.file.remove(tempUri).catch(() => {
          // Cleanup failure must not mask the primary outcome; the spike
          // records cleanup results separately.
        });
      }
      return outcome;
    },
  };
}

/**
 * Single refresh-and-retry after a 401. A token refresh is an authentication
 * recovery operation, not a general network retry (P2.1): it runs only when
 * the first outcome is exactly `{ kind: 'failed', retryable: true, reason:
 * 'unauthorized' }`. Transport, stream, disk, validation, sharing, and cleanup
 * failures never rotate auth state. At most one refresh and one reissued
 * export request occur; aborting during refresh still returns `cancelled`.
 */
export async function exportWithRetry(
  exporter: ReportFileExporter,
  request: ReportExportRequest,
  refreshAccessToken?: () => Promise<string>
): Promise<ReportExportOutcome> {
  const first = await exporter.export(request);
  if (
    first.kind !== 'failed' ||
    !first.retryable ||
    first.reason !== 'unauthorized' ||
    !refreshAccessToken
  ) {
    return first;
  }
  try {
    const nextToken = await refreshAccessToken();
    return exporter.export({ ...request, accessToken: nextToken });
  } catch (err) {
    if (isAbort(err) || request.signal?.aborted) return { kind: 'cancelled' };
    return first;
  }
}

/** Platform wiring placeholder — replaced by the R2.2 spike adapters. */
export function createPlatformReportFileExporter(): ReportFileExporter {
  return {
    export: async () => failedOutcome('native-file-export-not-ready'),
  };
}

function failedOutcome(reason: string): ReportExportOutcome {
  return { kind: 'failed', retryable: false, reason };
}

/** The instance used by the session action; swap the factory once the spike lands. */
export const reportFileExporter: ReportFileExporter = createPlatformReportFileExporter();
