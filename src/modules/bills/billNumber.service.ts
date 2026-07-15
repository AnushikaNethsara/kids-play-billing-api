import { DateTime } from 'luxon';
import { CounterModel } from './counter.model';
import { DEFAULT_BILL_NUMBER_PREFIX } from '../../config';

export const billNumberService = {
  /**
   * Atomically increments a per-business-day counter and formats a bill number like
   * KPA-20260715-0001. The $inc/upsert is a single atomic Mongo operation, so two
   * cashiers completing bills at the same instant can never receive the same number -
   * no transaction or application-level locking is required.
   */
  async generate(timezone: string): Promise<string> {
    const dateKey = DateTime.now().setZone(timezone).toFormat('yyyyMMdd');
    const counterId = `${DEFAULT_BILL_NUMBER_PREFIX}-${dateKey}`;

    const counter = await CounterModel.findOneAndUpdate(
      { _id: counterId },
      { $inc: { seq: 1 } },
      { upsert: true, new: true },
    ).exec();

    const sequence = String(counter.seq).padStart(4, '0');
    return `${DEFAULT_BILL_NUMBER_PREFIX}-${dateKey}-${sequence}`;
  },
};
