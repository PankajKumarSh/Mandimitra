import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import {
  adminBusinessListSchema,
  adminExtendSchema,
  adminPaymentListSchema,
  adminReasonSchema,
  changePlanSchema,
  checkoutSchema,
  mockCompleteSchema,
  verifyPaymentSchema,
  acceptInviteSchema,
  askSchema,
  confirmDraftSchema,
  extractSchema,
  messageListQuerySchema,
  reminderSchema,
  whatsappSendSchema,
  REPORT_KEYS,
  createExpenseSchema,
  createPaymentSchema,
  expenseCategorySchema,
  expenseListQuerySchema,
  paymentListQuerySchema,
  reportQuerySchema,
  statementQuerySchema,
  updateExpenseCategorySchema,
  approvalDecisionSchema,
  approvalListQuerySchema,
  calcAmountSchema,
  createLotSchema,
  createPurchaseSchema,
  createRuleSchema,
  createSaleSchema,
  lotListQuerySchema,
  pattiInputSchema,
  pattiListQuerySchema,
  reasonSchema,
  txnListQuerySchema,
  updateLotSchema,
  updateRuleSchema,
  buyerListQuerySchema,
  changePasswordSchema,
  commodityGradeSchema,
  createBankAccountSchema,
  createBuyerSchema,
  createCommoditySchema,
  createFarmerSchema,
  createInviteSchema,
  dateRangeQuerySchema,
  farmerListQuerySchema,
  idParamSchema,
  updateBuyerSchema,
  updateCommoditySchema,
  updateFarmerSchema,
  updateGradeSchema,
  loginSchema,
  paginationSchema,
  registerSchema,
  switchBusinessSchema,
  updateBusinessSchema,
  updateMembershipSchema,
  updateSettingsSchema,
} from '@mandimitra/shared';
import type { Env } from '../../config/env.ts';
import type { AuthController } from '../../controllers/auth.controller.ts';
import type { BusinessController } from '../../controllers/business.controller.ts';
import type { StaffController } from '../../controllers/staff.controller.ts';
import type { BuyerController, CommodityController, FarmerController, ReportController } from '../../controllers/masters.controller.ts';
import type { OperationsController } from '../../controllers/operations.controller.ts';
import type { MoneyController } from '../../controllers/money.controller.ts';
import type { AiController, CommunicationController } from '../../controllers/ai.controller.ts';
import type { AdminController, BillingController } from '../../controllers/billing.controller.ts';
import { rateLimiter, validate } from '../../middleware/core.ts';
import { requirePermission, requireWritableSubscription } from '../../middleware/tenant.ts';

interface Deps {
  env: Env;
  authenticate: RequestHandler;
  tenant: RequestHandler;
  idempotent: RequestHandler;
  platformAdmin: RequestHandler;
  /** Dev-only test checkout route (BILLING_PROVIDER=mock outside production). */
  mockBilling: boolean;
  controllers: {
    billing: BillingController;
    admin: AdminController;
    auth: AuthController;
    business: BusinessController;
    staff: StaffController;
    farmer: FarmerController;
    buyer: BuyerController;
    commodity: CommodityController;
    report: ReportController;
    operations: OperationsController;
    money: MoneyController;
    ai: AiController;
    comm: CommunicationController;
  };
}

export function v1Router({ env, authenticate, tenant, idempotent, platformAdmin, mockBilling, controllers: c }: Deps): Router {
  const router = Router();
  const authLimit = rateLimiter(env, { windowMs: 15 * 60_000, limit: env.AUTH_RATE_LIMIT });

  // ------------------------------------------------------------------ /auth
  const auth = Router();
  auth.post('/register', authLimit, validate({ body: registerSchema }), c.auth.register);
  auth.post('/login', authLimit, validate({ body: loginSchema }), c.auth.login);
  auth.post('/refresh', authLimit, c.auth.refresh);
  auth.post('/logout', c.auth.logout); // works with only the refresh cookie (access may be expired)
  auth.get('/me', authenticate, c.auth.me);
  auth.post('/switch-business', authenticate, validate({ body: switchBusinessSchema }), c.auth.switchBusiness);
  auth.post('/change-password', authLimit, authenticate, validate({ body: changePasswordSchema }), c.auth.changePassword);
  auth.get('/invites/:token', authLimit, c.auth.previewInvite);
  auth.post('/invites/:token/accept', authLimit, validate({ body: acceptInviteSchema }), c.auth.acceptInvite);
  router.use('/auth', auth);

  // Everything below is tenant-scoped: auth → tenant → subscription gate.
  const scoped = [authenticate, tenant, requireWritableSubscription];

  // ------------------------------------------------------------------ /businesses
  const biz = Router();
  biz.get('/current', requirePermission('business:read'), c.business.getCurrent);
  biz.patch('/current', requirePermission('business:manage'), validate({ body: updateBusinessSchema }), c.business.updateCurrent);
  biz.get('/current/settings', requirePermission('business:read'), c.business.getSettings);
  biz.patch('/current/settings', requirePermission('settings:manage'), validate({ body: updateSettingsSchema }), c.business.updateSettings);
  router.use('/businesses', ...scoped, biz);

  // ------------------------------------------------------------------ /staff
  const staff = Router();
  staff.get('/', requirePermission('staff:read'), c.staff.list);
  staff.get('/roles', requirePermission('staff:read'), c.staff.roles);
  staff.get(
    '/audit-log',
    requirePermission('audit:read'),
    validate({
      query: paginationSchema.extend({
        entityType: z.string().max(40).optional(),
        entityId: z.uuid().optional(),
        actorUserId: z.uuid().optional(),
      }),
    }),
    c.staff.auditLog,
  );
  staff.post('/invites', requirePermission('staff:manage'), validate({ body: createInviteSchema }), c.staff.createInvite);
  staff.delete('/invites/:id', requirePermission('staff:manage'), validate({ params: idParamSchema }), c.staff.revokeInvite);
  staff.patch('/:id', requirePermission('staff:manage'), validate({ params: idParamSchema, body: updateMembershipSchema }), c.staff.updateMembership);
  staff.get('/:id/activity', requirePermission('staff:read'), validate({ params: idParamSchema }), c.staff.activity);
  router.use('/staff', ...scoped, staff);

  const idSub = z.object({ id: z.uuid(), subId: z.uuid() });

  // ------------------------------------------------------------------ /farmers
  const farmers = Router();
  farmers.get('/', requirePermission('farmer:read'), validate({ query: farmerListQuerySchema }), c.farmer.list);
  farmers.get('/villages', requirePermission('farmer:read'), c.farmer.villages);
  farmers.post('/', requirePermission('farmer:create'), validate({ body: createFarmerSchema }), c.farmer.create);
  farmers.get('/:id', requirePermission('farmer:read'), validate({ params: idParamSchema }), c.farmer.get);
  farmers.get('/:id/summary', requirePermission('farmer:read'), validate({ params: idParamSchema }), c.farmer.summary);
  farmers.patch('/:id', requirePermission('farmer:update'), validate({ params: idParamSchema, body: updateFarmerSchema }), c.farmer.update);
  farmers.delete('/:id', requirePermission('farmer:delete'), validate({ params: idParamSchema }), c.farmer.remove);
  farmers.get('/:id/bank-accounts', requirePermission('farmer:bank'), validate({ params: idParamSchema }), c.farmer.listBank);
  farmers.post('/:id/bank-accounts', requirePermission('farmer:bank'), validate({ params: idParamSchema, body: createBankAccountSchema }), c.farmer.addBank);
  farmers.post('/:id/bank-accounts/:subId/reveal', requirePermission('farmer:bank'), validate({ params: idSub }), c.farmer.revealBank);
  farmers.delete('/:id/bank-accounts/:subId', requirePermission('farmer:bank'), validate({ params: idSub }), c.farmer.removeBank);
  router.use('/farmers', ...scoped, farmers);

  // ------------------------------------------------------------------ /buyers
  const buyers = Router();
  buyers.get('/', requirePermission('buyer:read'), validate({ query: buyerListQuerySchema }), c.buyer.list);
  buyers.post('/', requirePermission('buyer:create'), validate({ body: createBuyerSchema }), c.buyer.create);
  buyers.get('/:id', requirePermission('buyer:read'), validate({ params: idParamSchema }), c.buyer.get);
  buyers.get('/:id/summary', requirePermission('buyer:read'), validate({ params: idParamSchema }), c.buyer.summary);
  buyers.patch('/:id', requirePermission('buyer:update'), validate({ params: idParamSchema, body: updateBuyerSchema }), c.buyer.update);
  buyers.delete('/:id', requirePermission('buyer:delete'), validate({ params: idParamSchema }), c.buyer.remove);
  router.use('/buyers', ...scoped, buyers);

  // ------------------------------------------------------------------ /commodities
  const commodities = Router();
  commodities.get('/', requirePermission('commodity:read'), validate({ query: z.object({ includeInactive: z.stringbool().optional() }) }), c.commodity.list);
  commodities.post('/', requirePermission('commodity:manage'), validate({ body: createCommoditySchema }), c.commodity.create);
  commodities.get('/:id', requirePermission('commodity:read'), validate({ params: idParamSchema }), c.commodity.get);
  commodities.patch('/:id', requirePermission('commodity:manage'), validate({ params: idParamSchema, body: updateCommoditySchema }), c.commodity.update);
  commodities.post('/:id/grades', requirePermission('commodity:manage'), validate({ params: idParamSchema, body: commodityGradeSchema }), c.commodity.addGrade);
  commodities.patch('/:id/grades/:subId', requirePermission('commodity:manage'), validate({ params: idSub, body: updateGradeSchema }), c.commodity.updateGrade);
  router.use('/commodities', ...scoped, commodities);

  const o = c.operations;
  const idem = idempotent;

  // ------------------------------------------------------------------ /lots
  const lots = Router();
  lots.get('/', requirePermission('lot:read'), validate({ query: lotListQuerySchema }), o.listLots);
  lots.post('/', requirePermission('lot:create'), validate({ body: createLotSchema }), idem, o.createLot);
  lots.get('/:id', requirePermission('lot:read'), validate({ params: idParamSchema }), o.getLot);
  lots.patch('/:id', requirePermission('lot:update'), validate({ params: idParamSchema, body: updateLotSchema }), o.updateLot);
  lots.post('/:id/confirm', requirePermission('lot:create'), validate({ params: idParamSchema }), o.confirmLot);
  lots.post('/:id/cancel', requirePermission('lot:read'), validate({ params: idParamSchema, body: reasonSchema }), idem, o.cancelLot);
  router.use('/lots', ...scoped, lots);

  // ------------------------------------------------------------------ /sales, /purchases
  const sales = Router();
  sales.get('/', requirePermission('sale:read'), validate({ query: txnListQuerySchema }), o.listSales);
  sales.post('/', requirePermission('sale:create'), validate({ body: createSaleSchema }), idem, o.createSale);
  sales.get('/:id', requirePermission('sale:read'), validate({ params: idParamSchema }), o.getSale);
  sales.post('/:id/cancel', requirePermission('sale:read'), validate({ params: idParamSchema, body: reasonSchema }), idem, o.cancelSale);
  router.use('/sales', ...scoped, sales);

  const purchases = Router();
  purchases.get('/', requirePermission('purchase:read'), validate({ query: txnListQuerySchema }), o.listPurchases);
  purchases.post('/', requirePermission('purchase:create'), validate({ body: createPurchaseSchema }), idem, o.createPurchase);
  purchases.post('/:id/cancel', requirePermission('purchase:read'), validate({ params: idParamSchema, body: reasonSchema }), idem, o.cancelPurchase);
  router.use('/purchases', ...scoped, purchases);

  // ------------------------------------------------------------------ /patti
  const patti = Router();
  patti.get('/', requirePermission('patti:read'), validate({ query: pattiListQuerySchema }), o.listPatti);
  patti.post('/preview', requirePermission('patti:read'), validate({ body: pattiInputSchema }), o.previewPatti);
  patti.post('/', requirePermission('patti:create'), validate({ body: pattiInputSchema }), idem, o.createPatti);
  patti.get('/:id', requirePermission('patti:read'), validate({ params: idParamSchema }), o.getPatti);
  patti.get('/:id/print', requirePermission('patti:read'), validate({ params: idParamSchema }), o.printPatti);
  patti.get('/:id/pdf', requirePermission('patti:read'), validate({ params: idParamSchema }), o.pdfPatti);
  patti.post('/:id/cancel', requirePermission('patti:read'), validate({ params: idParamSchema, body: reasonSchema }), idem, o.cancelPatti);
  router.use('/patti', ...scoped, patti);

  // ------------------------------------------------------------------ /commission-rules
  const rules = Router();
  rules.get('/', requirePermission('commodity:read'), validate({ query: z.object({ appliesTo: z.enum(['FARMER', 'BUYER']).optional() }) }), o.listRules);
  rules.post('/', requirePermission('settings:manage'), validate({ body: createRuleSchema }), o.createRule);
  rules.patch('/:id', requirePermission('settings:manage'), validate({ params: idParamSchema, body: updateRuleSchema }), o.updateRule);
  router.use('/commission-rules', ...scoped, rules);

  // ------------------------------------------------------------------ /calculate (read-only previews)
  const calc = Router();
  calc.post('/amount', requirePermission('sale:read'), validate({ body: calcAmountSchema }), o.calcAmount);
  calc.post('/sale', requirePermission('sale:read'), validate({ body: createSaleSchema }), o.calcSale);
  calc.post(
    '/lot',
    requirePermission('lot:read'),
    validate({ body: z.object({ weightUnit: z.enum(['KG', 'QUINTAL']).default('KG'), grossWeight: z.string().regex(/^\d{1,11}(\.\d{1,3})?$/), tareWeight: z.string().regex(/^\d{1,11}(\.\d{1,3})?$/).default('0') }).strict() }),
    o.calcLot,
  );
  router.use('/calculate', ...scoped, calc);

  // ------------------------------------------------------------------ /approvals
  const approvals = Router();
  approvals.get('/', requirePermission('approval:decide'), validate({ query: approvalListQuerySchema }), o.listApprovals);
  approvals.post('/:id/approve', requirePermission('approval:decide'), validate({ params: idParamSchema, body: approvalDecisionSchema }), o.approve);
  approvals.post('/:id/reject', requirePermission('approval:decide'), validate({ params: idParamSchema, body: approvalDecisionSchema }), o.reject);
  router.use('/approvals', ...scoped, approvals);

  const m = c.money;

  // ------------------------------------------------------------------ /payments
  const payments = Router();
  payments.get('/', requirePermission('payment:read'), validate({ query: paymentListQuerySchema }), m.listPayments);
  payments.post('/', requirePermission('payment:create'), validate({ body: createPaymentSchema }), idem, m.createPayment);
  payments.get('/:id', requirePermission('payment:read'), validate({ params: idParamSchema }), m.getPayment);
  payments.get('/:id/receipt', requirePermission('payment:read'), validate({ params: idParamSchema }), m.receipt);
  payments.post('/:id/cancel', requirePermission('payment:read'), validate({ params: idParamSchema, body: reasonSchema }), idem, m.cancelPayment);
  router.use('/payments', ...scoped, payments);

  // ------------------------------------------------------------------ /ledger
  const ledger = Router();
  ledger.get('/farmers/:id', requirePermission('ledger:read'), validate({ params: idParamSchema, query: statementQuerySchema }), m.statement('farmer'));
  ledger.get('/buyers/:id', requirePermission('ledger:read'), validate({ params: idParamSchema, query: statementQuerySchema }), m.statement('buyer'));
  router.use('/ledger', ...scoped, ledger);

  // ------------------------------------------------------------------ /expenses
  const expenses = Router();
  expenses.get('/categories', requirePermission('expense:read'), m.categories);
  expenses.post('/categories', requirePermission('settings:manage'), validate({ body: expenseCategorySchema }), m.createCategory);
  expenses.patch('/categories/:id', requirePermission('settings:manage'), validate({ params: idParamSchema, body: updateExpenseCategorySchema }), m.updateCategory);
  expenses.get('/', requirePermission('expense:read'), validate({ query: expenseListQuerySchema }), m.listExpenses);
  expenses.post('/', requirePermission('expense:create'), validate({ body: createExpenseSchema }), idem, m.createExpense);
  expenses.post('/:id/cancel', requirePermission('expense:read'), validate({ params: idParamSchema, body: reasonSchema }), idem, m.cancelExpense);
  router.use('/expenses', ...scoped, expenses);

  // ------------------------------------------------------------------ /ai (read-only assistant + drafts)
  const ai = Router();
  const aiLimit = rateLimiter(env, { windowMs: 60_000, limit: 20 });
  ai.get('/usage', requirePermission('ai:query'), c.ai.usage);
  ai.get('/conversations', requirePermission('ai:query'), c.ai.conversations);
  ai.get('/conversations/:id', requirePermission('ai:query'), validate({ params: idParamSchema }), c.ai.conversation);
  ai.post('/ask', aiLimit, requirePermission('ai:query'), validate({ body: askSchema }), c.ai.ask);
  ai.post('/extract', aiLimit, requirePermission('ai:draft'), validate({ body: extractSchema }), c.ai.extract);
  ai.get('/drafts/:id', requirePermission('ai:draft'), validate({ params: idParamSchema }), c.ai.draft);
  ai.post('/drafts/:id/confirm', requirePermission('ai:draft'), validate({ params: idParamSchema, body: confirmDraftSchema }), c.ai.confirmDraft);
  ai.post('/drafts/:id/discard', requirePermission('ai:draft'), validate({ params: idParamSchema }), c.ai.discardDraft);
  ai.post('/reminder', aiLimit, requirePermission('whatsapp:send'), validate({ body: reminderSchema }), c.ai.reminder);
  router.use('/ai', ...scoped, ai);

  // ------------------------------------------------------------------ /notifications (+ WhatsApp)
  const notif = Router();
  notif.get('/', c.comm.notificationsList);
  notif.post('/read-all', c.comm.markAllRead);
  notif.post('/:id/read', validate({ params: idParamSchema }), c.comm.markRead);
  notif.post('/whatsapp/send', requirePermission('whatsapp:send'), validate({ body: whatsappSendSchema }), idem, c.comm.send);
  notif.get('/whatsapp/messages', requirePermission('whatsapp:send'), validate({ query: messageListQuerySchema }), c.comm.messages);
  router.use('/notifications', ...scoped, notif);

  // ------------------------------------------------------------------ /webhooks (no session; signature-verified)
  router.get('/webhooks/whatsapp', c.comm.webhookVerify);
  router.post('/webhooks/whatsapp', c.comm.webhook);

  // ------------------------------------------------------------------ /billing (SaaS subscription)
  // No writable-subscription gate here: an expired or past-due business must always be able to pay.
  const billing = Router();
  const payLimit = rateLimiter(env, { windowMs: 60_000, limit: 20 });
  billing.get('/plans', requirePermission('subscription:read'), c.billing.plans);
  billing.get('/subscription', requirePermission('subscription:read'), c.billing.overview);
  billing.get('/payments', requirePermission('subscription:read'), c.billing.payments);
  billing.get('/payments/:id/receipt', requirePermission('subscription:read'), validate({ params: idParamSchema }), c.billing.receipt);
  billing.post('/checkout', payLimit, requirePermission('subscription:manage'), validate({ body: checkoutSchema }), c.billing.checkout);
  billing.post('/verify', payLimit, requirePermission('subscription:manage'), validate({ body: verifyPaymentSchema }), c.billing.verify);
  billing.post('/change-plan', requirePermission('subscription:manage'), validate({ body: changePlanSchema }), c.billing.scheduleDowngrade);
  billing.post('/change-plan/cancel', requirePermission('subscription:manage'), c.billing.clearPendingPlan);
  billing.post('/cancel', requirePermission('subscription:manage'), c.billing.cancel);
  billing.post('/resume', requirePermission('subscription:manage'), c.billing.resume);
  if (mockBilling) billing.post('/mock/complete', payLimit, requirePermission('subscription:manage'), validate({ body: mockCompleteSchema }), c.billing.mockComplete);
  router.use('/billing', authenticate, tenant, billing);
  router.post('/webhooks/razorpay', c.billing.webhook);

  // ------------------------------------------------------------------ /admin (platform Super Admin; no tenant)
  const admin = Router();
  admin.get('/overview', c.admin.overview);
  admin.get('/businesses', validate({ query: adminBusinessListSchema }), c.admin.businesses);
  admin.get('/businesses/:id', validate({ params: idParamSchema }), c.admin.business);
  admin.post('/businesses/:id/suspend', validate({ params: idParamSchema, body: adminReasonSchema }), c.admin.suspend);
  admin.post('/businesses/:id/reactivate', validate({ params: idParamSchema }), c.admin.reactivate);
  admin.post('/businesses/:id/extend', validate({ params: idParamSchema, body: adminExtendSchema }), c.admin.extend);
  admin.get('/payments', validate({ query: adminPaymentListSchema }), c.admin.payments);
  router.use('/admin', authenticate, platformAdmin, admin);

  // ------------------------------------------------------------------ /reports
  const reports = Router();
  reports.get('/dashboard', requirePermission('report:read'), validate({ query: dateRangeQuerySchema }), c.report.dashboardSummary);
  reports.get('/:key', requirePermission('report:read'), validate({ params: z.object({ key: z.enum(REPORT_KEYS) }), query: reportQuerySchema }), m.report);
  router.use('/reports', ...scoped, reports);

  return router;
}
