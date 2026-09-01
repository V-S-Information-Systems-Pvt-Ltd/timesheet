import {
  createReportFileExporter,
  exportWithRetry,
  parseContentDispositionFilename,
  reportFileExporter,
  ReportFileError,
  sanitizeExportFilename,
  type ReportFileExporter,
  type ReportFileExporterDeps,
  type ReportHttpResponse,
  type ReportExportRequest,
} from '../src/services/reportFileExport';

// Node-free ASCII encoding: the RN tsconfig has no DOM lib, so TextEncoder is
// unavailable in typecheck. Test payloads are ASCII csv/text only.
function chunksOf(...lines: string[]): AsyncIterable<Uint8Array> {
  return (async function* () {
    for (const line of lines) yield new Uint8Array([...line].map((c) => c.charCodeAt(0)));
  })();
}

function okCsvResponse(overrides: Partial<ReportHttpResponse> = {}): ReportHttpResponse {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => {
        const headers: Record<string, string> = {
          'content-type': 'text/csv; charset=utf-8',
          'x-total-count': '3',
          'content-disposition': 'attachment; filename="timesheets_20260101_20260131.csv"',
        };
        return headers[name] ?? null;
      },
    },
    text: async () => '',
    stream: () => chunksOf('a,b\n', '1,2\n'),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ReportFileExporterDeps> = {}): ReportFileExporterDeps {
  const calls: { created: string[]; removed: string[]; shares: unknown[] } = {
    created: [],
    removed: [],
    shares: [],
  };
  const deps: ReportFileExporterDeps = {
    transport: {
      fetch: async () => okCsvResponse(),
    },
    file: {
      createTempUri: async (name: string) => {
        calls.created.push(name);
        return `/tmp/${name}`;
      },
      write: async () => {},
      remove: async (uri: string) => {
        calls.removed.push(uri);
      },
    },
    share: {
      invoke: async (file) => {
        calls.shares.push(file);
        return 'shared';
      },
    },
    ...overrides,
  };
  return deps;
}

const baseRequest: ReportExportRequest = {
  url: 'https://timesheet.example.com/api/v1/reports/export?from=2026-01-01&to=2026-01-31',
  accessToken: 'token-1',
  suggestedFilename: 'timesheets.csv',
};

describe('sanitizeExportFilename', () => {
  it('forces a .csv extension', () => {
    expect(sanitizeExportFilename('report')).toBe('report.csv');
    expect(sanitizeExportFilename('report.csv')).toBe('report.csv');
    expect(sanitizeExportFilename('report.CSV')).toBe('report.CSV');
  });

  it('strips path separators and control characters', () => {
    expect(sanitizeExportFilename('../../etc\\passwd')).not.toMatch(/[/\\]/);
    expect(sanitizeExportFilename('a\u0000b\u001fc')).toBe('abc.csv');
  });

  it('falls back to a safe default for empty names', () => {
    expect(sanitizeExportFilename('   ')).toBe('timesheet_report.csv');
  });
});

describe('parseContentDispositionFilename', () => {
  it('extracts quoted and unquoted filenames', () => {
    expect(parseContentDispositionFilename('attachment; filename="x.csv"')).toBe('x.csv');
    expect(parseContentDispositionFilename('attachment; filename=x.csv')).toBe('x.csv');
    expect(parseContentDispositionFilename(null)).toBeNull();
  });
});

describe('createReportFileExporter', () => {
  it('shares a streamed CSV file and cleans it up on success', async () => {
    const deps = makeDeps();
    const exporter = createReportFileExporter(deps);

    const outcome = await exporter.export(baseRequest);

    expect(outcome).toEqual({ kind: 'shared' });
    const created = (deps.file as { createTempUri: (n: string) => Promise<string> }).createTempUri;
    expect(created).toBeDefined();
  });

  it('returns empty without creating a file for 204 and X-Total-Count: 0', async () => {
    const deps = makeDeps({
      transport: {
        fetch: async () => ({
          ok: true,
          status: 204,
          headers: { get: () => null },
          text: async () => '',
          stream: () => chunksOf(),
        }),
      },
    });
    const exporter = createReportFileExporter(deps);
    expect(await exporter.export(baseRequest)).toEqual({ kind: 'empty' });
  });

  it('maps saved and cancelled share results', async () => {
    const saved = createReportFileExporter(
      makeDeps({ share: { invoke: async () => 'saved' } })
    );
    expect(await saved.export(baseRequest)).toEqual({ kind: 'saved' });

    const cancelled = createReportFileExporter(
      makeDeps({ share: { invoke: async () => 'cancelled' } })
    );
    expect(await cancelled.export(baseRequest)).toEqual({ kind: 'cancelled' });
  });

  it('maps 401 to retryable unauthorized and 403 to forbidden', async () => {
    const unauthorized = createReportFileExporter(
      makeDeps({
        transport: {
          fetch: async () => ({ ok: false, status: 401, headers: { get: () => null }, text: async () => '{}', stream: () => chunksOf() }),
        },
      })
    );
    expect(await unauthorized.export(baseRequest)).toEqual({ kind: 'failed', retryable: true, reason: 'unauthorized' });

    const forbidden = createReportFileExporter(
      makeDeps({
        transport: {
          fetch: async () => ({ ok: false, status: 403, headers: { get: () => null }, text: async () => '{}', stream: () => chunksOf() }),
        },
      })
    );
    expect(await forbidden.export(baseRequest)).toEqual({ kind: 'failed', retryable: false, reason: 'forbidden' });

    const serverError = createReportFileExporter(
      makeDeps({
        transport: {
          fetch: async () => ({ ok: false, status: 500, headers: { get: () => null }, text: async () => '{}', stream: () => chunksOf() }),
        },
      })
    );
    expect(await serverError.export(baseRequest)).toEqual({ kind: 'failed', retryable: false, reason: 'http-500' });
  });

  it('rejects a non-CSV content type', async () => {
    const exporter = createReportFileExporter(
      makeDeps({
        transport: {
          fetch: async () =>
            okCsvResponse({
              headers: { get: () => 'application/octet-stream' },
            }),
        },
      })
    );
    expect(await exporter.export(baseRequest)).toEqual({ kind: 'failed', retryable: false, reason: 'invalid-content-type' });
  });

  it('sanitizes a malicious Content-Disposition filename before creating the file', async () => {
    const created: string[] = [];
    const exporter = createReportFileExporter({
      transport: {
        fetch: jest.fn(async () =>
          okCsvResponse({
            headers: {
              get: (name: string) => {
                if (name === 'content-disposition') return 'attachment; filename="../../evil?.csv"';
                if (name === 'content-type') return 'text/csv';
                if (name === 'x-total-count') return '1';
                return null;
              },
            },
          })
        ),
      },
      file: {
        createTempUri: async (name: string) => {
          created.push(name);
          return `/tmp/${name}`;
        },
        write: async () => {},
        remove: async () => {},
      },
      share: { invoke: async () => 'shared' },
    });
    const outcome = await exporter.export(baseRequest);
    expect(outcome).toEqual({ kind: 'shared' });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatch(/^[^/\\]+\.csv$/);
  });

  it('deletes the temp file on disk-write failure', async () => {
    const removed: string[] = [];
    const exporter = createReportFileExporter({
      transport: { fetch: async () => okCsvResponse() },
      file: {
        createTempUri: async (name: string) => `/tmp/${name}`,
        write: async () => {
          throw new ReportFileError('disk', 'out of space');
        },
        remove: async (uri: string) => {
          removed.push(uri);
        },
      },
      share: { invoke: async () => 'shared' },
    });
    const outcome = await exporter.export(baseRequest);
    expect(outcome).toEqual({ kind: 'failed', retryable: false, reason: 'disk-write' });
    expect(removed).toEqual(['/tmp/timesheets_20260101_20260131.csv']);
  });

  it('returns download-incomplete when the stream dies mid-way and still cleans up', async () => {
    const removed: string[] = [];
    const deps = makeDeps({
      file: {
        createTempUri: async (name: string) => `/tmp/${name}`,
        write: async () => {
          throw new ReportFileError('stream', 'connection lost');
        },
        remove: async (uri: string) => {
          removed.push(uri);
        },
      },
    });
    const exporter = createReportFileExporter(deps);
    const outcome = await exporter.export(baseRequest);
    expect(outcome).toEqual({ kind: 'failed', retryable: true, reason: 'download-incomplete' });
    expect(removed).toEqual(['/tmp/timesheets_20260101_20260131.csv']);
  });

  it('maps transport failures to retryable network-error and aborts to cancelled', async () => {
    const network = createReportFileExporter(
      makeDeps({
        transport: {
          fetch: async () => {
            throw new Error('socket hang up');
          },
        },
      })
    );
    expect(await network.export(baseRequest)).toEqual({ kind: 'failed', retryable: true, reason: 'network-error' });

    const aborted = createReportFileExporter(
      makeDeps({
        transport: {
          fetch: async () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            throw err;
          },
        },
      })
    );
    expect(await aborted.export(baseRequest)).toEqual({ kind: 'cancelled' });

    const preAborted = createReportFileExporter(makeDeps());
    expect(await preAborted.export({ ...baseRequest, signal: { aborted: true } as AbortSignal })).toEqual({
      kind: 'cancelled',
    });
  });

  it('keeps the primary outcome when cleanup fails', async () => {
    const deps = makeDeps({
      file: {
        createTempUri: async (name: string) => `/tmp/${name}`,
        write: async () => {},
        remove: async () => {
          throw new Error('cannot delete');
        },
      },
      share: { invoke: async () => 'shared' },
    });
    const exporter = createReportFileExporter(deps);
    expect(await exporter.export(baseRequest)).toEqual({ kind: 'shared' });
  });

  it('never passes CSV text to the share surface', async () => {
    const shares: unknown[] = [];
    const exporter = createReportFileExporter(
      makeDeps({
        share: {
          invoke: async (file) => {
            shares.push(file);
            return 'shared';
          },
        },
      })
    );
    await exporter.export(baseRequest);
    expect(shares).toEqual([
      { uri: '/tmp/timesheets_20260101_20260131.csv', name: 'timesheets_20260101_20260131.csv', mimeType: 'text/csv' },
    ]);
  });

  it('queues a not-ready outcome until the platform spike wires real adapters', async () => {
    expect(await reportFileExporter.export(baseRequest)).toEqual({
      kind: 'failed',
      retryable: false,
      reason: 'native-file-export-not-ready',
    });
  });
});

describe('exportWithRetry', () => {
  it('refreshes once and retries after a 401, preserving the final outcome', async () => {
    let calls = 0;
    const refresh = jest.fn(async () => 'token-2');
    const exporter: ReportFileExporter = {
      export: async (request) => {
        calls += 1;
        if (calls === 1) return { kind: 'failed', retryable: true, reason: 'unauthorized' };
        expect(request.accessToken).toBe('token-2');
        return { kind: 'shared' };
      },
    };
    const outcome = await exportWithRetry(exporter, baseRequest, refresh);
    expect(outcome).toEqual({ kind: 'shared' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh for non-retryable failures', async () => {
    const refresh = jest.fn();
    const exporter: ReportFileExporter = {
      export: async () => ({ kind: 'failed', retryable: false, reason: 'forbidden' }),
    };
    const outcome = await exportWithRetry(exporter, baseRequest, refresh);
    expect(outcome).toEqual({ kind: 'failed', retryable: false, reason: 'forbidden' });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps the original outcome when refresh itself fails', async () => {
    const refresh = jest.fn(async () => {
      throw new Error('refresh failed');
    });
    const exporter: ReportFileExporter = {
      export: async () => ({ kind: 'failed', retryable: true, reason: 'unauthorized' }),
    };
    const outcome = await exportWithRetry(exporter, baseRequest, refresh as () => Promise<string>);
    expect(outcome).toEqual({ kind: 'failed', retryable: true, reason: 'unauthorized' });
  });

  it('cancels when the signal aborts during retry', async () => {
    const signal = { aborted: false } as AbortSignal;
    const abortRequest = { ...baseRequest, signal };
    const exporter: ReportFileExporter = {
      export: async () => ({ kind: 'failed', retryable: true, reason: 'unauthorized' }),
    };
    const outcome = await exportWithRetry(exporter, abortRequest, async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });
    expect(outcome).toEqual({ kind: 'cancelled' });
  });
});