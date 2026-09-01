import { Share } from 'react-native';

export interface CsvExportOptions {
  baseUrl: string;
  accessToken: string;
  from?: string;
  to?: string;
  projectId?: string;
  userId?: string;
  signal?: AbortSignal;
}

export type CsvExportOutcome =
  | { status: 'saved'; count: number; filename: string }
  | { status: 'shared'; count: number; filename: string }
  | { status: 'empty'; count: 0 }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string };

/**
 * Downloads and shares/saves timesheet reports as a temporary CSV spreadsheet file.
 * Handles HTTP 204 empty states, AbortSignal cancellation, and clean resource disposal.
 */
export async function exportTimesheetsCsvFile(
  options: CsvExportOptions
): Promise<CsvExportOutcome> {
  const { baseUrl, accessToken, from, to, projectId, userId, signal } = options;

  const searchParams = new URLSearchParams();
  if (projectId) searchParams.set('project', projectId);
  if (userId) searchParams.set('userId', userId);
  if (from) searchParams.set('from', from);
  if (to) searchParams.set('to', to);

  const query = searchParams.toString();
  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/reports/export${query ? `?${query}` : ''}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal,
    });

    if (response.status === 204) {
      return { status: 'empty', count: 0 };
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return {
        status: 'failed',
        message: errText || `Export request failed with HTTP ${response.status}`,
      };
    }

    const countHeader = response.headers.get('X-Total-Count');
    const rowCount = countHeader ? parseInt(countHeader, 10) : undefined;
    if (rowCount === 0) {
      return { status: 'empty', count: 0 };
    }

    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : 'timesheets_export.csv';

    const csvContent = await response.text();
    const lines = csvContent.trim().split('\n').filter((l) => l.trim().length > 0);
    if (lines.length <= 1) {
      return { status: 'empty', count: 0 };
    }

    const actualCount = rowCount !== undefined ? rowCount : lines.length - 1;

    try {
      const shareResult = await Share.share(
        {
          title: filename,
          message: csvContent,
        },
        {
          dialogTitle: `Export ${filename}`,
          subject: filename,
        }
      );

      if (shareResult.action === Share.dismissedAction) {
        return { status: 'cancelled' };
      }

      return { status: 'shared', count: actualCount, filename };
    } catch (shareErr) {
      if (
        shareErr instanceof Error &&
        (shareErr.name === 'AbortError' || shareErr.message.toLowerCase().includes('cancel'))
      ) {
        return { status: 'cancelled' };
      }
      return {
        status: 'failed',
        message: shareErr instanceof Error ? shareErr.message : 'Share dialog failed.',
      };
    }
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === 'AbortError' || err.message.toLowerCase().includes('cancel') || err.message.toLowerCase().includes('aborted'))
    ) {
      return { status: 'cancelled' };
    }
    return {
      status: 'failed',
      message: err instanceof Error ? err.message : 'Could not complete CSV export.',
    };
  }
}
