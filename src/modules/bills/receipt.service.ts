import { DateTime } from 'luxon';
import type { BillHydrated } from './bill.model';
import type { BusinessSettingsHydrated } from '../settings/settings.model';
import type { ReceiptData, ReceiptItem } from './receipt.types';
import { priceSession } from './billCalculator';
import { SessionPricingMode } from '../../common/constants/pricingModes';
import { formatMoney } from '../../common/utils/money';
import {
  centerText,
  dashLine,
  formatDuration,
  getPaperWidthChars,
  twoColumnLine,
  wrapText,
} from './receiptText';

export const receiptService = {
  buildReceiptData(bill: BillHydrated, settings: BusinessSettingsHydrated): ReceiptData {
    const paidMoment = bill.paidAt ? DateTime.fromJSDate(bill.paidAt).setZone(settings.timezone) : null;

    return {
      business: {
        name: settings.businessName,
        address: settings.address,
        phoneNumber: settings.phoneNumber,
      },
      bill: {
        billNumber: bill.billNumber,
        date: paidMoment ? paidMoment.toFormat('yyyy-MM-dd') : '',
        time: paidMoment ? paidMoment.toFormat('HH:mm') : '',
        cashierName: bill.cashierName,
        parentName: bill.parentName,
        items: bill.items.map((item) => {
          const receiptItem: ReceiptItem = {
            childName: item.childName,
            packageName: item.packageName,
            durationMinutes: item.durationMinutes,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
          };

          // Only session-billed items carry times; legacy flat-price items have none and
          // fall through to the original layout untouched.
          if (item.billedMinutes !== null && item.billedMinutes !== undefined) {
            receiptItem.billedMinutes = item.billedMinutes;
            receiptItem.billedDuration = formatDuration(item.billedMinutes);
          }
          if (item.checkInAt) {
            receiptItem.checkInTime = DateTime.fromJSDate(item.checkInAt)
              .setZone(settings.timezone)
              .toFormat('hh:mm a');
          }
          if (item.checkOutAt) {
            receiptItem.checkOutTime = DateTime.fromJSDate(item.checkOutAt)
              .setZone(settings.timezone)
              .toFormat('hh:mm a');
          }

          // A block line's total is blocks + overage, not a rate scaled to the time
          // played, so the pro-rata "@price/duration" line below would misdescribe it.
          if (
            item.pricingMode === SessionPricingMode.BLOCK_WITH_GRACE &&
            item.billedMinutes !== null &&
            item.billedMinutes !== undefined
          ) {
            const breakdown = priceSession(
              {
                pricingMode: SessionPricingMode.BLOCK_WITH_GRACE,
                unitPrice: item.unitPrice,
                rateDurationMinutes: item.durationMinutes,
                graceMinutes: item.graceMinutes ?? 0,
              },
              item.billedMinutes,
            );

            const blockLabel = `${breakdown.blocksCharged} x ${formatDuration(item.durationMinutes)}`;
            receiptItem.blockSummary = breakdown.overageAmount > 0
              ? `${blockLabel} + ${formatDuration(breakdown.overageMinutes)}`
              : breakdown.graceApplied
                ? `${blockLabel} (${formatDuration(item.graceMinutes ?? 0)} free)`
                : blockLabel;
            receiptItem.overageMinutes = breakdown.overageMinutes;
            receiptItem.overageAmount = breakdown.overageAmount;
          }

          return receiptItem;
        }),
        subtotal: bill.subtotal,
        discount: bill.discount,
        tax: bill.tax,
        grandTotal: bill.grandTotal,
        paidAmount: bill.paidAmount,
        balance: bill.balance,
        paymentMethod: bill.paymentMethod,
      },
      receipt: {
        paperWidth: settings.receiptPaperWidth,
        header: settings.receiptHeader,
        footer: settings.receiptFooter,
        currency: settings.currency,
      },
    };
  },

  buildPlainTextReceipt(data: ReceiptData): string {
    const width = getPaperWidthChars(data.receipt.paperWidth);
    const lines: string[] = [];

    lines.push(centerText(data.business.name.toUpperCase(), width));
    if (data.business.address) lines.push(centerText(data.business.address, width));
    if (data.business.phoneNumber) lines.push(centerText(data.business.phoneNumber, width));
    lines.push(dashLine(width));

    const paidMoment = data.bill.date
      ? DateTime.fromFormat(`${data.bill.date} ${data.bill.time}`, 'yyyy-MM-dd HH:mm')
      : null;

    lines.push(`Bill: ${data.bill.billNumber ?? ''}`);
    if (paidMoment) lines.push(`Date: ${paidMoment.toFormat('dd/MM/yyyy')}  ${paidMoment.toFormat('hh:mm a')}`);
    lines.push(`Cashier: ${data.bill.cashierName}`);
    if (data.bill.parentName) lines.push(`Parent: ${data.bill.parentName}`);
    lines.push(dashLine(width));

    for (const item of data.bill.items) {
      lines.push(...wrapText(`Child: ${item.childName}`, width));

      // Time-billed item: show the parent what they are actually paying for - when the
      // child went in, when they came out, and the rate that was applied.
      if (item.checkInTime && item.checkOutTime) {
        lines.push(...wrapText(`In ${item.checkInTime}  Out ${item.checkOutTime}`, width));
      }
      if (item.billedDuration) {
        lines.push(
          twoColumnLine(
            `Time: ${item.billedDuration}`,
            // A block line shows how the total was made up. The pro-rata form would read
            // as a per-minute rate and invite the parent to multiply it out, which is not
            // how a block line is priced.
            item.blockSummary ?? `@${formatMoney(item.unitPrice)}/${item.durationMinutes}m`,
            width,
          ),
        );
      }
      if (item.overageAmount) {
        lines.push(
          twoColumnLine(
            `  incl. extra ${formatDuration(item.overageMinutes ?? 0)}`,
            formatMoney(item.overageAmount),
            width,
          ),
        );
      }

      const label = item.billedMinutes ? item.packageName : `${item.packageName} x ${item.quantity}`;
      lines.push(twoColumnLine(label, formatMoney(item.lineTotal), width));
    }
    lines.push(dashLine(width));

    lines.push(twoColumnLine('Subtotal', formatMoney(data.bill.subtotal), width));
    if (data.bill.discount > 0) {
      lines.push(twoColumnLine('Discount', `-${formatMoney(data.bill.discount)}`, width));
    }
    if (data.bill.tax > 0) {
      lines.push(twoColumnLine('Tax', formatMoney(data.bill.tax), width));
    }
    lines.push(twoColumnLine('TOTAL', formatMoney(data.bill.grandTotal), width));
    lines.push(twoColumnLine('Paid', formatMoney(data.bill.paidAmount), width));
    lines.push(twoColumnLine('Balance', formatMoney(data.bill.balance), width));
    if (data.bill.paymentMethod) lines.push(`Payment: ${data.bill.paymentMethod}`);
    lines.push(dashLine(width));

    lines.push(centerText(data.receipt.footer, width));

    return lines.join('\n');
  },
};
