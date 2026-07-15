import type { Request, Response } from 'express';
import { dashboardService } from './dashboard.service';
import { sendSuccess } from '../../common/utils/apiResponse';
import type { DashboardQuery, RevenueQuery, RecentBillsQuery } from './dashboard.types';

export const dashboardController = {
  async summary(req: Request, res: Response): Promise<void> {
    const summary = await dashboardService.getSummary(req.query as unknown as DashboardQuery);
    sendSuccess(res, summary);
  },

  async revenue(req: Request, res: Response): Promise<void> {
    const revenue = await dashboardService.getRevenue(req.query as unknown as RevenueQuery);
    sendSuccess(res, revenue);
  },

  async bills(req: Request, res: Response): Promise<void> {
    const breakdown = await dashboardService.getBillsBreakdown(req.query as unknown as DashboardQuery);
    sendSuccess(res, breakdown);
  },

  async packages(req: Request, res: Response): Promise<void> {
    const packages = await dashboardService.getPackagePerformance(req.query as unknown as DashboardQuery);
    sendSuccess(res, packages);
  },

  async paymentMethods(req: Request, res: Response): Promise<void> {
    const breakdown = await dashboardService.getPaymentMethodBreakdown(
      req.query as unknown as DashboardQuery,
    );
    sendSuccess(res, breakdown);
  },

  async cashiers(req: Request, res: Response): Promise<void> {
    const performance = await dashboardService.getCashierPerformance(req.query as unknown as DashboardQuery);
    sendSuccess(res, performance);
  },

  async recentBills(req: Request, res: Response): Promise<void> {
    const bills = await dashboardService.getRecentBills(req.query as unknown as RecentBillsQuery);
    sendSuccess(res, bills);
  },
};
