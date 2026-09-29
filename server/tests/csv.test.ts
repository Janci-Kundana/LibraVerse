import { parseCsv, parseCsvObjects } from '../src/core/csv';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded commas and newlines, CRLF and a BOM', () => {
    const text = '﻿title,authors\r\n"Hello, World","A ""B"" C"\r\n"Multi\nline",x\n';
    expect(parseCsv(text)).toEqual([
      ['title', 'authors'],
      ['Hello, World', 'A "B" C'],
      ['Multi\nline', 'x'],
    ]);
  });

  it('keys rows by the lower-cased header and skips blank lines', () => {
    expect(parseCsvObjects('Title, ISBN \nDune,123\n\n')).toEqual([{ title: 'Dune', isbn: '123' }]);
  });
});
