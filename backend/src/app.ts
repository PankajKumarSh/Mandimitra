import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { PrismaClient } from '@mandimitra/database';
import type { Env } from './config/env.ts';
import type { Logger } from './config/logger.ts';
import { AuthController } from './controllers/auth.controller.ts';
import { BusinessController } from './controllers/business.controller.ts';
import { StaffController } from './controllers/staff.controller.ts';
import { authenticate } from './middleware/auth.ts';
import { csrfGuard, notFoundHandler, rateLimiter, requestId } from './middleware/core.ts';
import { errorHandler } from './middleware/error-handler.ts';
import { resolveTenant, TenantCache } from './middleware/tenant.ts';
import { v1Router } from './routes/v1/index.ts';
import { AuthService } from './services/auth.service.ts';
import { BusinessService } from './services/business.service.ts';
import { StaffService } from './services/staff.service.ts';
import { TokenSigner } from './utils/jwt.ts';
import { FieldCipher } from './utils/field-crypto.ts';
import { BuyerController, CommodityController, FarmerController, ReportController } from './controllers/masters.controller.ts';
import { BuyerService } from './services/buyer.service.ts';
import { CommodityService } from './services/commodity.service.ts';
import { DashboardService } from './services/dashboard.service.ts';
import { FarmerService } from './services/farmer.service.ts';
import { OperationsController } from './controllers/operations.controller.ts';
import { idempotent } from './middleware/idempotency.ts';
import { ApprovalService } from './services/approval.service.ts';
import { LotService } from './services/lot.service.ts';
import { PattiService } from './services/patti/patti.service.ts';
import { PdfRenderer } from './services/patti/pdf.ts';
import { RuleService } from './services/rule.service.ts';
import { TradeService } from './services/trade.service.ts';
import { MoneyController } from './controllers/money.controller.ts';
import { ExpenseService } from './services/expense.service.ts';
import { PaymentService } from './services/payment.service.ts';
import { ReportService } from './services/report.service.ts';
import { StatementService } from './services/statement.service.ts';
import { AiController, CommunicationController } from './controllers/ai.controller.ts';
import { AssistantService } from './services/ai/assistant.service.ts';
import { anthropicLlm, disabledLlm, type LlmClient } from './services/ai/llm.ts';
import { NotificationService } from './services/notification.service.ts';
import { blobStoreFromEnv, type BlobStore, StorageService } from './services/storage.service.ts';
import { CloudWhatsAppProvider, DisabledWhatsAppProvider, MockWhatsAppProvider, type WhatsAppProvider } from './services/whatsapp/provider.ts';
import { AdminController, BillingController } from './controllers/billing.controller.ts';
import { AdminService, requirePlatformAdmin } from './services/admin.service.ts';
import { BillingService } from './services/billing/billing.service.ts';
import { MockGateway, RazorpayGateway, type PaymentGateway } from './services/billing/gateway.ts';
import { captureException } from './config/sentry.ts';
import { WhatsAppService } from './services/whatsapp/whatsapp.service.ts';

export interface AppDeps {
  env: Env;
  prisma: PrismaClient;
  logger: Logger;
  pdf?: PdfRenderer;
  /** Injected in tests (scripted model); built from env otherwise. */
  llm?: LlmClient;
  whatsapp?: WhatsAppProvider;
  gateway?: PaymentGateway;
  store?: BlobStore;
}

export interface AppServices {
  whatsapp: WhatsAppService;
  billing: BillingService;
  storage: StorageService;
}

export function createApp({
  env,
  prisma,
  logger,
  pdf = new PdfRenderer(logger),
  llm = env.AI_PROVIDER === 'anthropic' ? anthropicLlm(env.ANTHROPIC_API_KEY) : disabledLlm,
  whatsapp = env.WHATSAPP_PROVIDER === 'cloud' ? new CloudWhatsAppProvider(env, logger) : env.WHATSAPP_PROVIDER === 'disabled' ? new DisabledWhatsAppProvider() : new MockWhatsAppProvider(logger),
  gateway = env.BILLING_PROVIDER === 'razorpay' ? new RazorpayGateway(env, logger) : new MockGateway(),
  store = blobStoreFromEnv(env),
}: AppDeps): { app: Express; cache: TenantCache; pdf: PdfRenderer; whatsapp: WhatsAppProvider; gateway: PaymentGateway; services: AppServices } {
  const signer = new TokenSigner(env.JWT_ACCESS_SECRET, env.JWT_ACCESS_TTL_SECONDS);
  const cache = new TenantCache(env.TENANT_CACHE_TTL_MS);

  const authService = new AuthService(prisma, env, signer, cache);
  const staffService = new StaffService(prisma, env, cache, authService);
  const businessService = new BusinessService(prisma, cache);

  const lotService = new LotService(prisma);
  const tradeService = new TradeService(prisma);
  const pattiService = new PattiService(prisma, pdf);
  const approvals = new ApprovalService(prisma);
  approvals.register('Lot', lotService.cancelTx);
  approvals.register('Sale', tradeService.cancelSaleTx);
  approvals.register('Purchase', tradeService.cancelPurchaseTx);
  approvals.register('Patti', pattiService.cancelTx);
  const paymentService = new PaymentService(prisma);
  const expenseService = new ExpenseService(prisma);
  approvals.register('Payment', paymentService.cancelTx);
  approvals.register('Expense', expenseService.cancelTx);
  const reportService = new ReportService(prisma);
  const statementService = new StatementService(prisma);
  const storage = new StorageService(prisma, store);
  const assistant = new AssistantService(prisma, env, llm, { reports: reportService, statements: statementService }, storage, logger);
  const whatsappService = new WhatsAppService(prisma, env, whatsapp, pdf, storage, pattiService, statementService, paymentService, logger);

  const billingService = new BillingService(prisma, env, gateway, cache, logger);

  const app = express();
  app.disable('x-powered-by');
  // Ledger `seq` is BIGINT; Decimal already serialises to string via toJSON.
  app.set('json replacer', (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      customProps: (req) => ({ userId: (req as express.Request).auth?.userId, businessId: (req as express.Request).auth?.businessId }),
      autoLogging: { ignore: (req) => req.url === '/healthz' },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: env.WEB_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true,
      allowedHeaders: ['content-type', 'x-requested-with', 'idempotency-key', 'if-match', 'x-request-id'],
    }),
  );
  app.use(rateLimiter(env, { windowMs: 60_000, limit: 300 }));
  // Photo extraction carries a base64 image (≤ 5 MB decoded); everything else stays at 1 MB.
  app.use('/api/v1/ai/extract', express.json({ limit: '8mb' }));
  // Webhooks keep the raw bytes for signature verification.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        if ((req as express.Request).originalUrl?.startsWith('/api/v1/webhooks/')) (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(cookieParser());
  app.use(csrfGuard);

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/readyz', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  app.use(
    '/api/v1',
    v1Router({
      env,
      authenticate: authenticate(signer),
      tenant: resolveTenant(prisma, cache),
      controllers: {
        auth: new AuthController(env, authService, staffService),
        business: new BusinessController(businessService),
        staff: new StaffController(staffService),
        farmer: new FarmerController(new FarmerService(prisma, new FieldCipher(env.FIELD_ENCRYPTION_KEY))),
        buyer: new BuyerController(new BuyerService(prisma)),
        commodity: new CommodityController(new CommodityService(prisma)),
        report: new ReportController(new DashboardService(prisma)),
        operations: new OperationsController(lotService, tradeService, pattiService, new RuleService(prisma), approvals),
        money: new MoneyController(prisma, paymentService, statementService, expenseService, reportService, approvals, pdf),
        ai: new AiController(assistant),
        comm: new CommunicationController(whatsappService, new NotificationService()),
        billing: new BillingController(billingService, gateway),
        admin: new AdminController(new AdminService(prisma, cache)),
      },
      idempotent: idempotent(prisma, logger),
      platformAdmin: requirePlatformAdmin(prisma),
      mockBilling: gateway.name === 'mock' && !env.isProd,
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler(logger, captureException));
  return { app, cache, pdf, whatsapp, gateway, services: { whatsapp: whatsappService, billing: billingService, storage } };
}
