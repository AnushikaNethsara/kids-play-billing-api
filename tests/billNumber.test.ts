/**
 * The bill number is printed on every receipt a customer walks away with, so what it does
 * and does not reveal is a product decision, not an implementation detail. These pin both
 * halves: the shape it takes, and the guarantee that two cashiers can never be handed the
 * same one.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Settings } from 'luxon';
import { billNumberService } from '../src/modules/bills/billNumber.service';
import { CounterModel } from '../src/modules/bills/counter.model';

/**
 * Freezes luxon's clock, which is what the generator reads.
 *
 * The instant is parsed natively and captured up front: resolving it inside the closure
 * would call back into luxon, which asks `Settings.now` for the current time, and the
 * whole thing recurses until the stack gives out.
 */
function freezeAt(iso: string) {
  const millis = Date.parse(iso);
  Settings.now = () => millis;
}

describe('billNumberService.generate', () => {
  afterEach(() => {
    Settings.now = () => Date.now();
    vi.restoreAllMocks();
  });

  it('carries the date and the time of payment, not a position in a sequence', async () => {
    freezeAt('2026-09-26T09:02:15.000Z');

    // Asia/Colombo is UTC+5:30, so 09:02:15Z is 14:32:15 on the business's own clock.
    expect(await billNumberService.generate('Asia/Colombo')).toBe('KPA-20260926-143215');
  });

  it('renders the business timezone, not the server, which runs in UTC', async () => {
    freezeAt('2026-09-26T21:30:00.000Z');

    // Already the next day in Colombo. Getting this wrong would date a bill to yesterday.
    expect(await billNumberService.generate('Asia/Colombo')).toBe('KPA-20260927-030000');
    expect(await billNumberService.generate('UTC')).toBe('KPA-20260926-213000');
  });

  it('gives two bills a second apart strictly increasing numbers', async () => {
    freezeAt('2026-09-26T09:02:15.000Z');
    const first = await billNumberService.generate('Asia/Colombo');

    freezeAt('2026-09-26T09:02:16.000Z');
    const second = await billNumberService.generate('Asia/Colombo');

    expect(second).not.toBe(first);
    // Plain string comparison, so anything sorting by bill number stays chronological.
    expect(second > first).toBe(true);
  });

  it('disambiguates two payments completed in the same second', async () => {
    freezeAt('2026-09-26T09:02:15.000Z');

    expect(await billNumberService.generate('Asia/Colombo')).toBe('KPA-20260926-143215');
    expect(await billNumberService.generate('Asia/Colombo')).toBe('KPA-20260926-143215-2');
    expect(await billNumberService.generate('Asia/Colombo')).toBe('KPA-20260926-143215-3');
  });

  it('keys the counter per second, so the row can be expired the next day', async () => {
    freezeAt('2026-09-26T09:02:15.000Z');
    await billNumberService.generate('Asia/Colombo');

    const counter = await CounterModel.findById('KPA-20260926-143215');
    expect(counter?.seq).toBe(1);
    // The TTL is what stops one row per bill accumulating forever.
    expect(counter?.createdAt).toBeInstanceOf(Date);
  });

  it('reveals nothing about how many bills the business has taken', async () => {
    // The point of the change: a customer holding one receipt, or two from the same day,
    // learns only when they paid. Ten bills across the day, none of them counting.
    const numbers: string[] = [];
    for (let minute = 0; minute < 10; minute += 1) {
      freezeAt(`2026-09-26T09:${String(minute).padStart(2, '0')}:00.000Z`);
      numbers.push(await billNumberService.generate('Asia/Colombo'));
    }

    expect(new Set(numbers).size).toBe(10);
    for (const number of numbers) {
      expect(number).toMatch(/^KPA-\d{8}-\d{6}$/);
    }
  });
});
