import { Router } from 'express';
import { playSessionController } from './playSession.controller';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../common/utils/asyncHandler';
import {
  checkInSchema,
  listPlaySessionsQuerySchema,
  playSessionIdParamSchema,
  ticketCodeParamSchema,
  voidSessionSchema,
} from './playSession.validation';

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * /play-sessions:
 *   post:
 *     tags: [Play Sessions]
 *     summary: Check a child in and open a play session
 *     description: >
 *       Opens a timed session and returns the ticket the QR slip encodes. The client
 *       supplies `ticketCode`, which is unique - re-sending the same code returns the
 *       existing session with a 200 instead of creating a duplicate, so an offline
 *       cashier app can retry a failed sync safely without an Idempotency-Key header.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ticketCode, childName, playPackageId]
 *             properties:
 *               ticketCode:
 *                 type: string
 *                 description: Device-generated code encoded in the printed QR
 *               childName: { type: string }
 *               playPackageId: { type: string }
 *               checkInAt:
 *                 type: string
 *                 format: date-time
 *                 description: Device clock time; defaults to server time when omitted
 *               customer:
 *                 type: object
 *                 properties:
 *                   customerId: { type: string }
 *                   parentName: { type: string }
 *                   phoneNumber: { type: string }
 *     responses:
 *       201: { description: Session opened }
 *       200: { description: Ticket was already checked in (idempotent replay) }
 *       422: { description: Play package missing or inactive }
 */
router.post('/', validate({ body: checkInSchema }), asyncHandler(playSessionController.checkIn));

/**
 * @openapi
 * /play-sessions:
 *   get:
 *     tags: [Play Sessions]
 *     summary: List play sessions
 *     description: >
 *       Filter by `status=ACTIVE` for the "currently playing" board. Active sessions
 *       carry a live `quote` priced as of the moment of the request.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: status, schema: { type: string, enum: [ACTIVE, CLOSED, VOIDED] } }
 *       - { in: query, name: phoneNumber, schema: { type: string } }
 *       - { in: query, name: childName, schema: { type: string } }
 *       - { in: query, name: from, schema: { type: string, format: date-time } }
 *       - { in: query, name: to, schema: { type: string, format: date-time } }
 *       - { in: query, name: sort, schema: { type: string, enum: [newest, oldest] } }
 *     responses:
 *       200: { description: Paginated sessions, each with a quote when active }
 */
router.get('/', validate({ query: listPlaySessionsQuerySchema }), asyncHandler(playSessionController.list));

/**
 * @openapi
 * /play-sessions/ticket/{ticketCode}:
 *   get:
 *     tags: [Play Sessions]
 *     summary: Resolve a scanned QR ticket and price it as of now
 *     description: >
 *       The checkout scan endpoint. The returned `quote` is advisory - a live number for
 *       the cashier's screen. The amount actually charged is recomputed inside
 *       `POST /bills/from-sessions`.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: ticketCode, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Session and its current quote }
 *       404: { description: No ticket found for this code }
 */
router.get(
  '/ticket/:ticketCode',
  validate({ params: ticketCodeParamSchema }),
  asyncHandler(playSessionController.getByTicketCode),
);

/**
 * @openapi
 * /play-sessions/{id}:
 *   get:
 *     tags: [Play Sessions]
 *     summary: Get a play session by id
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Session and its current quote }
 *       404: { description: Session not found }
 */
router.get(
  '/:id',
  validate({ params: playSessionIdParamSchema }),
  asyncHandler(playSessionController.getById),
);

/**
 * @openapi
 * /play-sessions/{id}/void:
 *   post:
 *     tags: [Play Sessions]
 *     summary: Void a mistaken check-in
 *     description: >
 *       Writes the session off without ever producing a bill. Cashiers may only void
 *       sessions they checked in; admins may void any. Always audit-logged.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string, minLength: 3 }
 *     responses:
 *       200: { description: Session voided }
 *       403: { description: Cashier attempted to void another cashier's session }
 *       409: { description: Session is no longer active }
 */
router.post(
  '/:id/void',
  validate({ params: playSessionIdParamSchema, body: voidSessionSchema }),
  asyncHandler(playSessionController.void),
);

export const playSessionRoutes = router;
