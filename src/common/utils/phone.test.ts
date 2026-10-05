import { describe, expect, it } from 'vitest';
import { normalizePhone, phoneSearchDigits } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['0771234567', '+94771234567'],
    ['077 123 4567', '+94771234567'],
    ['077-123-4567', '+94771234567'],
    ['+94771234567', '+94771234567'],
    ['+94 77 123 4567', '+94771234567'],
    ['94771234567', '+94771234567'],
    ['0094771234567', '+94771234567'],
    ['+94 0771234567', '+94771234567'],
    ['771234567', '+94771234567'],
    ['0112345678', '+94112345678'],
  ])('stores %s as %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it('is idempotent', () => {
    expect(normalizePhone(normalizePhone('0771234567'))).toBe('+94771234567');
  });

  it.each([
    ['', ''],
    [null, ''],
    [undefined, ''],
    ['   ', ''],
    ['n/a', ''],
  ])('stores %s as nothing', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it('keeps the digits of a number it cannot place, rather than losing it', () => {
    expect(normalizePhone('12345')).toBe('12345');
    expect(normalizePhone('077123456')).toBe('077123456');
  });
});

describe('phoneSearchDigits', () => {
  it.each([
    ['077', '77'],
    ['0771234', '771234'],
    ['+9477', '77'],
    ['94 77', '77'],
    ['+94 077', '77'],
    ['4567', '4567'],
    ['9', '9'],
    ['94', '94'],
    ['', ''],
  ])('searches %s as %s', (partial, expected) => {
    expect(phoneSearchDigits(partial)).toBe(expected);
  });

  it('finds the stored form from any way of typing the start of it', () => {
    const stored = normalizePhone('0771234567');
    for (const typed of ['077123', '+94 77 12', '77123', '4567']) {
      expect(stored).toContain(phoneSearchDigits(typed));
    }
  });
});
