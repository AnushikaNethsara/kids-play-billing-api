/**
 * Phone numbers are the identity of a family: every bill and every ticket carries the
 * number typed at the till, and a customer is looked up by it. Typed freely, the same
 * parent arrives as `0771234567`, `+94 77 123 4567` and `771234567` - three customers,
 * each with a third of the visits. So every number is stored in one form, `+94XXXXXXXXX`.
 *
 * The business is in Sri Lanka and only takes Sri Lankan numbers. Anything that does not
 * fit a Sri Lankan shape is kept as its digits rather than rejected or guessed at: a
 * cashier's typo must never stop a check-in, and nothing typed is ever thrown away.
 *
 * Normalised here and only here - the zod schemas apply it to every incoming number, and
 * the clients send whatever the cashier typed. Same principle as money: one authority.
 */

import { z } from 'zod';

const COUNTRY_CODE = '94';
const NATIONAL_DIGITS = 9;

/** The stored form of a phone number. `''` for nothing typed. */
export function normalizePhone(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return '';

  // 0771234567 - the way almost every parent says their number.
  if (digits.length === NATIONAL_DIGITS + 1 && digits.startsWith('0')) {
    return `+${COUNTRY_CODE}${digits.slice(1)}`;
  }
  // +94771234567 / 94771234567.
  if (digits.length === NATIONAL_DIGITS + 2 && digits.startsWith(COUNTRY_CODE)) {
    return `+${digits}`;
  }
  // 0094771234567 - the international dialling prefix.
  if (digits.length === NATIONAL_DIGITS + 4 && digits.startsWith(`00${COUNTRY_CODE}`)) {
    return `+${digits.slice(2)}`;
  }
  // +94 0771234567 - the country code typed in front of the trunk zero.
  if (digits.length === NATIONAL_DIGITS + 3 && digits.startsWith(`${COUNTRY_CODE}0`)) {
    return `+${COUNTRY_CODE}${digits.slice(3)}`;
  }
  // 771234567 - the leading zero dropped.
  if (digits.length === NATIONAL_DIGITS && !digits.startsWith('0')) {
    return `+${COUNTRY_CODE}${digits}`;
  }

  return digits;
}

/**
 * The digits of a partly typed number that can be matched *anywhere* inside a stored
 * one, for search boxes and list filters. A leading trunk zero or country code is
 * dropped, because the stored form spells those differently: `0771234` becomes
 * `771234`, which is found inside `+94771234567`, and so is `4567`.
 */
export function phoneSearchDigits(partial: string | null | undefined): string {
  const digits = (partial ?? '').replace(/\D/g, '');
  if (digits.startsWith(`00${COUNTRY_CODE}`)) return digits.slice(4);
  if (digits.startsWith(`${COUNTRY_CODE}0`)) return digits.slice(3);
  if (digits.startsWith(COUNTRY_CODE) && digits.length > COUNTRY_CODE.length) return digits.slice(2);
  if (digits.startsWith('0')) return digits.slice(1);
  return digits;
}

/**
 * A stored number the way a parent would say it - `+94771234567` reads as `0771234567`.
 * For display and masking; a number not in the stored Sri Lankan form is returned as is.
 */
export function toLocalPhone(stored: string | null | undefined): string {
  const phone = stored ?? '';
  return /^\+94\d{9}$/.test(phone) ? `0${phone.slice(3)}` : phone;
}

/** A phone number as it arrives in a request body: anything typed, stored normalised. */
export const phoneNumberInputSchema = z.string().trim().max(30).transform(normalizePhone);
