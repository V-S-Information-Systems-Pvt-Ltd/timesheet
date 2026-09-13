import { entryWord, formatEntryCount } from '../src/utils/plural';

describe('entry count wording', () => {
  it('uses the singular noun for exactly one entry', () => {
    expect(entryWord(1)).toBe('entry');
    expect(formatEntryCount(1)).toBe('1 entry');
  });

  it('uses the plural noun for zero and many entries', () => {
    expect(entryWord(0)).toBe('entries');
    expect(entryWord(2)).toBe('entries');
    expect(entryWord(11)).toBe('entries');
    expect(formatEntryCount(0)).toBe('0 entries');
    expect(formatEntryCount(3)).toBe('3 entries');
  });
});
