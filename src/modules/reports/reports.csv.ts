/**
 * The CSV dialect every report export uses: UTF-8 with a BOM (without one Excel opens the
 * file as ANSI and mangles every Sinhala or Tamil name), CRLF line ends, RFC 4180 quoting.
 */

import { toLocalPhone } from '../../common/utils/phone';

export const CSV_BOM = '﻿';
const LINE_END = '\r\n';

/**
 * `text` cells hold whatever a cashier typed - a child's name, a reason - and are guarded
 * against formula injection. `raw` cells are values this module produced itself (money,
 * dates, counts) and are written verbatim, so a negative amount keeps its minus sign.
 */
export type CsvColumnKind = 'text' | 'raw';

export interface CsvColumn<T> {
  header: string;
  kind?: CsvColumnKind;
  value: (row: T) => string | number | null | undefined;
}

/**
 * A cell beginning with one of these is evaluated as a formula by Excel and Sheets, so a
 * child registered as `=HYPERLINK("http://evil","click")` would become a live link in the
 * accountant's spreadsheet. A leading apostrophe makes it inert text.
 */
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

export function escapeCsvCell(value: string | number | null | undefined, kind: CsvColumnKind = 'text'): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (kind === 'text' && text.length > 0 && FORMULA_TRIGGERS.has(text[0])) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function csvHeaderLine<T>(columns: CsvColumn<T>[]): string {
  return columns.map((column) => escapeCsvCell(column.header, 'raw')).join(',') + LINE_END;
}

export function csvRowLine<T>(columns: CsvColumn<T>[], row: T): string {
  return columns.map((column) => escapeCsvCell(column.value(row), column.kind ?? 'text')).join(',') + LINE_END;
}

/**
 * Keeps the first three and last three digits: `0771234567` -> `077****567`. Enough to
 * match a row to a customer who is standing in front of you, not enough to call them.
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  // Masked in the local form a cashier recognises, not the stored +94 one.
  const digits = toLocalPhone(phone.trim());
  if (digits.length <= 6) return '*'.repeat(digits.length);
  return `${digits.slice(0, 3)}${'*'.repeat(digits.length - 6)}${digits.slice(-3)}`;
}
