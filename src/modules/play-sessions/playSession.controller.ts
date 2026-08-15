import type { Request, Response } from 'express';
import { playSessionService } from './playSession.service';
import { sendSuccess } from '../../common/utils/apiResponse';
import { AuthenticationError } from '../../common/errors';
import type { CheckInInput, ListPlaySessionsQuery, VoidSessionInput } from './playSession.types';

function requireActor(req: Request) {
  if (!req.user) throw new AuthenticationError();
  return req.user;
}

export const playSessionController = {
  async checkIn(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const { session, created } = await playSessionService.checkIn(req.body as CheckInInput, actor);
    sendSuccess(res, session, {
      statusCode: created ? 201 : 200,
      message: created ? 'Child checked in successfully' : 'This ticket was already checked in',
    });
  },

  async list(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as ListPlaySessionsQuery;
    const { sessions, meta } = await playSessionService.list(query);
    sendSuccess(res, sessions, { meta });
  },

  async getByTicketCode(req: Request, res: Response): Promise<void> {
    const result = await playSessionService.getByTicketCode(req.params.ticketCode);
    sendSuccess(res, result);
  },

  async getById(req: Request, res: Response): Promise<void> {
    const result = await playSessionService.getPublicById(req.params.id);
    sendSuccess(res, result);
  },

  async void(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const session = await playSessionService.voidSession(req.params.id, req.body as VoidSessionInput, actor);
    sendSuccess(res, session, { message: 'Session voided successfully' });
  },
};
