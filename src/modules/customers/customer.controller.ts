import type { Request, Response } from 'express';
import { customerService } from './customer.service';
import { sendSuccess } from '../../common/utils/apiResponse';
import type { CreateCustomerInput, UpdateCustomerInput, ListCustomersQuery } from './customer.types';

export const customerController = {
  async create(req: Request, res: Response): Promise<void> {
    const customer = await customerService.create(req.body as CreateCustomerInput);
    sendSuccess(res, customer, { statusCode: 201, message: 'Customer created successfully' });
  },

  async list(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as ListCustomersQuery;
    const { customers, meta } = await customerService.list(query);
    sendSuccess(res, customers, { meta });
  },

  async getById(req: Request, res: Response): Promise<void> {
    const customer = await customerService.getById(req.params.id);
    sendSuccess(res, customer);
  },

  async update(req: Request, res: Response): Promise<void> {
    const customer = await customerService.update(req.params.id, req.body as UpdateCustomerInput);
    sendSuccess(res, customer, { message: 'Customer updated successfully' });
  },

  async search(req: Request, res: Response): Promise<void> {
    const { phoneNumber } = req.query as unknown as { phoneNumber: string };
    const customers = await customerService.searchByPhoneNumber(phoneNumber);
    sendSuccess(res, customers);
  },
};
