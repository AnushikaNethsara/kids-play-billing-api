import { describe, it, expect } from 'vitest';
import { escapeCsvCell, csvRowLine, maskPhone, type CsvColumn } from './reports.csv';
import { formatMinorAsDecimal } from '../../common/utils/money';

describe('formatMinorAsDecimal', () => {
  it('writes minor units as a plain two-decimal string', () => {
    expect(formatMinorAsDecimal(80000)).toBe('800.00');
    expect(formatMinorAsDecimal(5)).toBe('0.05');
    expect(formatMinorAsDecimal(0)).toBe('0.00');
    expect(formatMinorAsDecimal(-5)).toBe('-0.05');
    expect(formatMinorAsDecimal(123456789)).toBe('1234567.89');
  });
});

describe('escapeCsvCell', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(escapeCsvCell('Perera, Nimal')).toBe('"Perera, Nimal"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('neutralises formula triggers in text cells only', () => {
    expect(escapeCsvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(escapeCsvCell('-12.00', 'raw')).toBe('-12.00');
  });

  it('writes null and undefined as empty cells', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });

  it('builds a CRLF-terminated row', () => {
    const columns: CsvColumn<{ a: string; b: number }>[] = [
      { header: 'A', value: (row) => row.a },
      { header: 'B', kind: 'raw', value: (row) => row.b },
    ];
    expect(csvRowLine(columns, { a: 'x', b: 1 })).toBe('x,1\r\n');
  });
});

describe('maskPhone', () => {
  it('keeps the first three and last three digits', () => {
    expect(maskPhone('0771234567')).toBe('077****567');
    expect(maskPhone('')).toBe('');
    expect(maskPhone('12345')).toBe('*****');
  });
});
