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

function utf8ByteLength(input: string): number {
  let bytes = 0;
  for (const char of input) {
    const codePoint = char.codePointAt(0)!;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function hasUnpairedSurrogate(input: string): boolean {
  for (let i = 0; i < input.length; i += 1) {
    const unit = input.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = input.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
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
  it('forces exactly one lowercase .csv extension', () => {
    expect(sanitizeExportFilename('report')).toBe('report.csv');
    expect(sanitizeExportFilename('report.csv')).toBe('report.csv');
    expect(sanitizeExportFilename('report.CSV')).toBe('report.csv');
    expect(sanitizeExportFilename('report.csv.csv')).toBe('report.csv');
  });

  it('discards path traversal and takes only the filename component', () => {
    expect(sanitizeExportFilename('../../etc/passwd')).toBe('passwd.csv');
  });

  it('replaces reserved characters with a safe separator', () => {
    expect(sanitizeExportFilename('a<b>c:d"e/f\\g|h?i*j.csv')).toBe('g_h_i_j.csv');
    expect(sanitizeExportFilename('a\u0000b\u001fc')).toBe('abc.csv');
  });

  it('trims surrounding whitespace and trailing Windows dots/spaces', () => {
    expect(sanitizeExportFilename('  report  ')).toBe('report.csv');
    expect(sanitizeExportFilename('report.')).toBe('report.csv');
    expect(sanitizeExportFilename('report.. ')).toBe('report.csv');
  });

  it('falls back to the default for empty, dot, and dot-dot names', () => {
    expect(sanitizeExportFilename('   ')).toBe('timesheet_report.csv');
    expect(sanitizeExportFilename('.')).toBe('timesheet_report.csv');
    expect(sanitizeExportFilename('..')).toBe('timesheet_report.csv');
  });

  it('rejects Windows device names including with arbitrary extensions', () => {
    for (const device of ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM9', 'LPT1', 'LPT9']) {
      expect(sanitizeExportFilename(device)).toBe('timesheet_report.csv');
      expect(sanitizeExportFilename(`${device}.csv`)).toBe('timesheet_report.csv');
      expect(sanitizeExportFilename(`${device.toLowerCase()}.CSV`)).toBe('timesheet_report.csv');
      expect(sanitizeExportFilename(`${device}.backup`)).toBe('timesheet_report.csv');
    }
    expect(sanitizeExportFilename('com2.csv')).toBe('timesheet_report.csv');
    expect(sanitizeExportFilename('CON.txt.csv')).toBe('timesheet_report.csv');
    expect(sanitizeExportFilename('nul.data.csv')).toBe('timesheet_report.csv');
    expect(sanitizeExportFilename('report.final.csv')).toBe('report.final.csv');
  });

  it('caps long ASCII names by UTF-8 bytes while retaining the extension', () => {
    const longName = 'x'.repeat(400);
    const result = sanitizeExportFilename(longName);
    expect(result).toBe(`${'x'.repeat(240)}.csv`);
    expect(utf8ByteLength(result)).toBe(244);
  });

  it('caps long Unicode names without exceeding the UTF-8 byte budget', () => {
    const heavyUnicode = `报表-${'长'.repeat(500)}`;
    const result = sanitizeExportFilename(heavyUnicode);
    expect(result.endsWith('.csv')).toBe(true);
    expect(utf8ByteLength(result)).toBeLessThanOrEqual(244);
    expect(hasUnpairedSurrogate(result)).toBe(false);
  });

  it('never splits supplementary characters or preserves lone surrogates', () => {
    const result = sanitizeExportFilename(`a${'😀'.repeat(200)}`);
    expect(utf8ByteLength(result)).toBeLessThanOrEqual(244);
    expect(hasUnpairedSurrogate(result)).toBe(false);
    expect(sanitizeExportFilename(`safe\ud83dname.csv`)).toBe('safename.csv');
  });

  it('sanitizes the reviewed ../../evil?.csv case to an exact safe name', () => {
    expect(sanitizeExportFilename('../../evil?.csv')).toBe('evil_.csv');
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
    const createTempUri = jest.fn(async (name: string) => `/tmp/${name}`);
    const share = jest.fn(async () => 'shared' as const);
    const exporter = createReportFileExporter({
      transport: {
        fetch: async () => ({
          ok: true,
          status: 204,
          headers: { get: (name: string) => (name === 'x-total-count' ? '0' : null) },
          text: async () => '',
          stream: () => chunksOf(),
        }),
      },
      file: { createTempUri, write: async () => {}, remove: async () => {} },
      share: { invoke: share },
    });
    expect(await exporter.export(baseRequest)).toEqual({ kind: 'empty' });
    expect(createTempUri).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
  });

  it('fails without side effects when the total-count contract is invalid', async () => {
    const invalidCases: Array<{ status: number; count: string | null }> = [
      { status: 204, count: null },
      { status: 204, count: '00' },
      ...[null, '', '00', '01', '+1', '-1', '1.0', '1e3', ' 1', '1 ', 'abc'].map((count) => ({
        status: 200,
        count,
      })),
    ];

    for (const { status, count } of invalidCases) {
      const stream = jest.fn(() => chunksOf());
      const createTempUri = jest.fn(async (name: string) => `/tmp/${name}`);
      const write = jest.fn(async () => {});
      const remove = jest.fn(async () => {});
      const share = jest.fn(async () => 'shared' as const);
      const exporter = createReportFileExporter({
        transport: {
          fetch: async () => ({
            ok: true,
            status,
            headers: {
              get: (name: string) =>
                name === 'x-total-count' ? count : name === 'content-type' ? 'text/csv' : null,
            },
            text: async () => '',
            stream,
          }),
        },
        file: { createTempUri, write, remove },
        share: { invoke: share },
      });

      expect(await exporter.export(baseRequest)).toEqual({
        kind: 'failed',
        retryable: false,
        reason: 'invalid-total-count',
      });
      expect(stream).not.toHaveBeenCalled();
      expect(createTempUri).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(share).not.toHaveBeenCalled();
    }
  });

  it('accepts canonical positive total counts including large digit strings', async () => {
    for (const count of ['1', '999999999999999999999999']) {
      const createTempUri = jest.fn(async (name: string) => `/tmp/${name}`);
      const exporter = createReportFileExporter(
        makeDeps({
          transport: {
            fetch: async () =>
              okCsvResponse({
                headers: {
                  get: (name: string) =>
                    name === 'x-total-count'
                      ? count
                      : name === 'content-type'
                        ? 'text/csv'
                        : name === 'content-disposition'
                          ? 'attachment; filename="report.csv"'
                          : null,
                },
              }),
          },
          file: { createTempUri, write: async () => {}, remove: async () => {} },
        })
      );
      expect(await exporter.export(baseRequest)).toEqual({ kind: 'shared' });
      expect(createTempUri).toHaveBeenCalledWith('report.csv');
    }
  });

  it('returns empty without touching the file or share adapters for 200 + X-Total-Count: 0', async () => {
    const createTempUri = jest.fn(async (name: string) => `/tmp/${name}`);
    const remove = jest.fn(async () => {});
    const share = jest.fn(async () => 'shared' as const);
    const exporter = createReportFileExporter({
      transport: {
        fetch: async () =>
          okCsvResponse({ headers: { get: (name: string) => (name === 'x-total-count' ? '0' : name === 'content-type' ? 'text/csv' : null) } }),
      },
      file: { createTempUri, write: async () => {}, remove },
      share: { invoke: share },
    });
    expect(await exporter.export(baseRequest)).toEqual({ kind: 'empty' });
    expect(createTempUri).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
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

  it('rejects unexpected successful statuses and status/ok disagreement without side effects', async () => {
    const cases = [
      { status: 201, ok: true, reason: 'http-201' },
      { status: 202, ok: true, reason: 'http-202' },
      { status: 206, ok: true, reason: 'http-206' },
      { status: 200, ok: false, reason: 'invalid-response-status' },
    ];

    for (const testCase of cases) {
      const stream = jest.fn(() => chunksOf('partial'));
      const createTempUri = jest.fn(async (name: string) => `/tmp/${name}`);
      const write = jest.fn(async () => {});
      const remove = jest.fn(async () => {});
      const share = jest.fn(async () => 'shared' as const);
      const exporter = createReportFileExporter({
        transport: {
          fetch: async () => okCsvResponse({ ...testCase, stream }),
        },
        file: { createTempUri, write, remove },
        share: { invoke: share },
      });

      expect(await exporter.export(baseRequest)).toEqual({
        kind: 'failed',
        retryable: false,
        reason: testCase.reason,
      });
      expect(stream).not.toHaveBeenCalled();
      expect(createTempUri).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(share).not.toHaveBeenCalled();
    }
  });

  it('rejects a non-CSV content type', async () => {
    const exporter = createReportFileExporter(
      makeDeps({
        transport: {
          fetch: async () =>
            okCsvResponse({
              headers: {
                get: (name: string) => (name === 'content-type' ? 'application/octet-stream' : name === 'x-total-count' ? '3' : null),
              },
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
    // Exact sanitized name: traversal discarded, `?` replaced, `.csv` once.
    expect(created[0]).toBe('evil_.csv');
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

  it('never refreshes for network or partial-download failures (P2.1)', async () => {
    const refresh = jest.fn();
    const network: ReportFileExporter = {
      export: async () => ({ kind: 'failed', retryable: true, reason: 'network-error' }),
    };
    expect(await exportWithRetry(network, baseRequest, refresh)).toEqual({
      kind: 'failed',
      retryable: true,
      reason: 'network-error',
    });
    expect(refresh).not.toHaveBeenCalled();

    const partial: ReportFileExporter = {
      export: async () => ({ kind: 'failed', retryable: true, reason: 'download-incomplete' }),
    };
    expect(await exportWithRetry(partial, baseRequest, refresh)).toEqual({
      kind: 'failed',
      retryable: true,
      reason: 'download-incomplete',
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a second 401 is returned without another refresh', async () => {
    let calls = 0;
    const refresh = jest.fn(async () => 'token-2');
    const exporter: ReportFileExporter = {
      export: async (request) => {
        calls += 1;
        expect(request.accessToken).toBe(calls === 1 ? 'token-1' : 'token-2');
        return { kind: 'failed', retryable: true, reason: 'unauthorized' };
      },
    };
    const outcome = await exportWithRetry(exporter, baseRequest, refresh);
    expect(outcome).toEqual({ kind: 'failed', retryable: true, reason: 'unauthorized' });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
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
