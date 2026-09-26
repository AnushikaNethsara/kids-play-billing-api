import { Router } from 'express';
import { billController } from './bill.controller';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { UserRole } from '../../common/constants/roles';
import {
  createBillSchema,
  createBillFromSessionsSchema,
  updateBillSchema,
  completeBillSchema,
  cancelBillSchema,
  refundBillSchema,
  setTestBillSchema,
  listBillsQuerySchema,
  billIdParamSchema,
  billNumberParamSchema,
} from './bill.validation';

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * /bills:
 *   post:
 *     summary: Create a draft bill (backend prices every item server-side)
 *     tags: [Bills]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items]
 *             properties:
 *               customer:
 *                 type: object
 *                 properties:
 *                   parentName: { type: string }
 *                   phoneNumber: { type: string }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [childName, playPackageId]
 *                   properties:
 *                     childName: { type: string, example: "Kasun" }
 *                     playPackageId: { type: string }
 *                     quantity: { type: integer, default: 1 }
 *               discount:
 *                 type: object
 *                 properties:
 *                   type: { type: string, enum: [NONE, FIXED, PERCENTAGE] }
 *                   value: { type: number }
 *               paymentMethod: { type: string, enum: [CASH, CARD, BANK_TRANSFER, OTHER] }
 *               notes: { type: string }
 *     responses:
 *       201: { description: Draft bill created }
 *       422: { description: Invalid or inactive play package }
 *   get:
 *     summary: List bills with search and filters (cashiers are scoped to their own bills)
 *     tags: [Bills]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [DRAFT, PAID, CANCELLED, REFUNDED] }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200: { description: Paginated list of bills }
 */
router.post('/', validate({ body: createBillSchema }), asyncHandler(billController.create));
router.get('/', validate({ query: listBillsQuerySchema }), asyncHandler(billController.list));

/**
 * @openapi
 * /bills/from-sessions:
 *   post:
 *     summary: Check out scanned tickets into a draft bill priced on time spent
 *     description: >
 *       The checkout half of QR ticketing. Each ticket is claimed atomically from ACTIVE,
 *       priced pro-rata from the package rate snapshotted at check-in
 *       (`unitPrice x billedMinutes / durationMinutes`, floored at
 *       `minimumBillableMinutes`), and attached to a new DRAFT bill. Take payment with
 *       `POST /bills/{id}/complete` exactly as for any other bill.
 *
 *       Tickets are identified by their printed code rather than by id so a cashier app
 *       that has been offline since check-in can compose this request without a round
 *       trip. Claiming is a compare-and-set, so a ticket can never be billed twice.
 *     tags: [Bills]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ticketCodes]
 *             properties:
 *               ticketCodes:
 *                 type: array
 *                 items: { type: string }
 *               checkOutAt:
 *                 type: string
 *                 format: date-time
 *                 description: Device clock time; defaults to server time when omitted
 *               discount:
 *                 type: object
 *                 properties:
 *                   type: { type: string, enum: [NONE, FIXED, PERCENTAGE] }
 *                   value: { type: number }
 *               customer:
 *                 type: object
 *                 properties:
 *                   customerId: { type: string }
 *                   parentName: { type: string }
 *                   phoneNumber: { type: string }
 *               paymentMethod: { type: string, enum: [CASH, CARD, BANK_TRANSFER, OTHER] }
 *               notes: { type: string }
 *     responses:
 *       201: { description: Draft bill created from tickets }
 *       404: { description: One of the ticket codes is unknown }
 *       409: { description: A ticket was already checked out or was voided }
 */
router.post(
  '/from-sessions',
  validate({ body: createBillFromSessionsSchema }),
  asyncHandler(billController.createFromSessions),
);

/**
 * @openapi
 * /bills/number/{billNumber}:
 *   get:
 *     summary: Get a bill by its human-readable bill number
 *     tags: [Bills]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: billNumber
 *         required: true
 *         schema: { type: string, example: "KPA-20260715-0001" }
 *     responses:
 *       200: { description: Bill details }
 *       404: { description: Bill not found }
 */
router.get(
  '/number/:billNumber',
  validate({ params: billNumberParamSchema }),
  asyncHandler(billController.getByBillNumber),
);

/**
 * @openapi
 * /bills/{id}:
 *   get:
 *     summary: Get a bill by id
 *     tags: [Bills]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Bill details }
 *   patch:
 *     summary: Update a draft bill's items, discount, customer info, or notes
 *     tags: [Bills]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Bill updated }
 *       409: { description: Bill is not in draft status }
 */
router.get('/:id', validate({ params: billIdParamSchema }), asyncHandler(billController.getById));
router.patch(
  '/:id',
  validate({ params: billIdParamSchema, body: updateBillSchema }),
  asyncHandler(billController.update),
);

/**
 * @openapi
 * /bills/{id}/complete:
 *   post:
 *     summary: Complete a draft bill and generate a receipt (idempotent via Idempotency-Key header)
 *     tags: [Bills]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         schema: { type: string }
 *         description: Safe to retry with the same key - the mobile app should send one to avoid duplicate payments on network retries.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [paymentMethod]
 *             properties:
 *               paymentMethod: { type: string, enum: [CASH, CARD, BANK_TRANSFER, OTHER] }
 *               paidAmount: { type: integer, description: "Defaults to the grand total if omitted" }
 *     responses:
 *       200: { description: Bill completed, includes receipt-ready data }
 *       409: { description: Bill already completed or not in draft status }
 */
router.post(
  '/:id/complete',
  validate({ params: billIdParamSchema, body: completeBillSchema }),
  asyncHandler(billController.complete),
);

/**
 * @openapi
 * /bills/{id}/cancel:
 *   post:
 *     summary: Cancel a bill (cashiers may only cancel their own drafts; admins may cancel paid bills too)
 *     tags: [Bills]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200: { description: Bill cancelled }
 */
router.post(
  '/:id/cancel',
  validate({ params: billIdParamSchema, body: cancelBillSchema }),
  asyncHandler(billController.cancel),
);

/**
 * @openapi
 * /bills/{id}/refund:
 *   post:
 *     summary: Refund a paid bill (admin-only)
 *     tags: [Bills]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200: { description: Bill refunded }
 *       403: { description: Only admins may issue refunds }
 *       409: { description: Bill is not paid, or was already refunded }
 */
router.post(
  '/:id/refund',
  requireRole(UserRole.ADMIN),
  validate({ params: billIdParamSchema, body: refundBillSchema }),
  asyncHandler(billController.refund),
);

/**
 * @openapi
 * /bills/{id}/test:
 *   post:
 *     summary: Mark a bill as a test bill, or restore it to normal reporting (admin-only)
 *     description: >
 *       A test bill is one that was rung up to try the system out rather than to take
 *       money - staff training, a printer check, a demo. It keeps its bill number,
 *       receipt and place in the bill list, but every dashboard figure, revenue total and
 *       customer lifetime-spend calculation excludes it.
 *
 *       Only allowed once the bill has been checked out. A DRAFT is a live transaction
 *       whose totals can still change, so flagging one is rejected with a 409.
 *
 *       Idempotent: sending the state the bill is already in succeeds and changes nothing.
 *     tags: [Bills]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isTestBill]
 *             properties:
 *               isTestBill: { type: boolean }
 *               reason:
 *                 type: string
 *                 maxLength: 300
 *                 description: Why this was a test. Ignored when clearing the flag.
 *     responses:
 *       200: { description: Test flag updated }
 *       403: { description: Only admins may mark test bills }
 *       409: { description: Bill is still a draft and has not been checked out }
 */
router.post(
  '/:id/test',
  requireRole(UserRole.ADMIN),
  validate({ params: billIdParamSchema, body: setTestBillSchema }),
  asyncHandler(billController.setTestFlag),
);

/**
 * @openapi
 * /bills/{id}/receipt:
 *   get:
 *     summary: Get structured receipt-ready JSON data for a paid bill
 *     tags: [Bills]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Receipt data }
 */
router.get(
  '/:id/receipt',
  validate({ params: billIdParamSchema }),
  asyncHandler(billController.receipt),
);

/**
 * @openapi
 * /bills/{id}/receipt/text:
 *   get:
 *     summary: Get a monospace plain-text receipt formatted for 58mm/80mm thermal printers
 *     tags: [Bills]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Plain-text receipt
 *         content:
 *           text/plain:
 *             schema: { type: string }
 */
router.get(
  '/:id/receipt/text',
  validate({ params: billIdParamSchema }),
  asyncHandler(billController.plainTextReceipt),
);

/**
 * @openapi
 * /bills/{id}/print-data:
 *   get:
 *     summary: Get the same structured data as /receipt, intended for ESC/POS conversion on the mobile app
 *     tags: [Bills]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Print-ready receipt data }
 */
router.get(
  '/:id/print-data',
  validate({ params: billIdParamSchema }),
  asyncHandler(billController.printData),
);

export const billRoutes = router;
