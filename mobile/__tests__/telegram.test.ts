import {
  botDate,
  formatHours,
  flattenDescription,
  resolveBotNumber,
  buildBotCommand,
} from '../src/utils/telegram';

describe('Telegram Utilities (mobile parity)', () => {
  it('formats bot dates without leading zeros', () => {
    expect(botDate('2026-08-11')).toBe('2026-8-11');
    expect(botDate('2026-01-05')).toBe('2026-1-5');
    expect(botDate('invalid')).toBe('invalid');
  });

  it('formats hours cleanly', () => {
    expect(formatHours(7.5)).toBe('7.5');
    expect(formatHours(8)).toBe('8');
    expect(formatHours(0.25)).toBe('0.25');
  });

  it('flattens multiline descriptions', () => {
    expect(flattenDescription('Line 1\nLine 2\n\nLine 3')).toBe('Line 1 Line 2 Line 3');
  });

  it('resolves bot numbers with fallback rules', () => {
    expect(resolveBotNumber({ telegram_no: 101 }, { telegram_no: 202 })).toBe(101);
    expect(resolveBotNumber(null, { telegram_no: 202 })).toBe(202);
    expect(resolveBotNumber({ name: 'Internal', telegram_no: 1000 }, { telegram_no: 505 })).toBe(505);
    expect(resolveBotNumber(null, null)).toBeNull();
  });

  it('builds /log, /logyesterday, and dated commands', () => {
    const today = '2026-08-26';
    const entry = {
      log_date: '2026-08-26',
      hours_worked: 7.5,
      work_done: 'Implemented telegram helper',
    };
    const proj = { telegram_no: 42 };

    // Today
    expect(buildBotCommand(entry, proj, null, today)).toEqual({
      command: '/log 42 7.5 Implemented telegram helper',
    });

    // Yesterday
    expect(buildBotCommand({ ...entry, log_date: '2026-08-25' }, proj, null, today)).toEqual({
      command: '/logyesterday 42 7.5 Implemented telegram helper',
    });

    // Older date
    expect(buildBotCommand({ ...entry, log_date: '2026-08-10' }, proj, null, today)).toEqual({
      command: '/logyesterday 2026-8-10 42 7.5 Implemented telegram helper',
    });
  });

  it('returns reason when no bot number is found', () => {
    expect(
      buildBotCommand(
        { log_date: '2026-08-26', hours_worked: 8, work_done: 'Work' },
        null,
        null
      )
    ).toEqual({
      command: null,
      reason: expect.stringMatching(/no bot number/i),
    });
  });
});
