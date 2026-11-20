import type { Request, Response } from 'express';
import type { PrismaClient } from '@mandimitra/database';
import type { ExpenseListQuery, PaymentListQuery, ReportKey, ReportQuery, StatementQuery } from '@mandimitra/shared';
import type { ApprovalService } from '../services/approval.service.ts';
import { writeActivity } from '../services/audit.service.ts';
import type { ExpenseService } from '../services/expense.service.ts';
import type { PdfRenderer } from '../services/patti/pdf.ts';
import type { PaymentService } from '../services/payment.service.ts';
import type { ReportService } from '../services/report.service.ts';
import type { StatementService } from '../services/statement.service.ts';
import { Errors } from '../utils/errors.ts';
import { ok, requestContext } from '../utils/http.ts';

const id = (req: Request) => (req.validated.params as { id: string }).id;
const DOC_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

export class MoneyController {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly payments: PaymentService,
    private readonly statements: StatementService,
    private readonly expenses: ExpenseService,
    private readonly reports: ReportService,
    private readonly approvals: ApprovalService,
    private readonly pdf: PdfRenderer,
  ) {}

  /** Export gate: permission + plan feature, and every export is logged. */
  private async beforeExport(req: Request, what: string) {
    if (!req.tenant!.permissions.has('report:export')) throw Errors.forbidden('FORBIDDEN', { missing: ['report:export'] });
    const plan = await this.prisma.subscription.findUnique({ where: { businessId: req.tenant!.businessId }, select: { plan: { select: { exportsEnabled: true } } } });
    if (plan && !plan.plan.exportsEnabled) throw Errors.paymentRequired('PLAN_LIMIT_REACHED', { resource: 'exports' });
    await writeActivity(this.prisma, { businessId: req.tenant!.businessId, userId: req.auth!.userId, activityType: 'REPORT_EXPORTED', metadata: { what, query: req.query } }, requestContext(req));
  }

  private sendHtml(res: Response, html: string) {
    res.status(200).type('html').setHeader('cache-control', 'private, no-store').setHeader('content-security-policy', DOC_CSP).send(html);
  }

  private async sendPdf(req: Request, res: Response, html: string, fileName: string) {
    if (!this.pdf.available) throw Errors.unprocessable('PDF_UNAVAILABLE');
    const buf = await this.pdf.render(html);
    res
      .status(200)
      .type('application/pdf')
      .setHeader('cache-control', 'private, no-store')
      .setHeader('content-disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${fileName}"`)
      .send(buf);
  }

  // ---------------------------------------------------------------- payments
  listPayments = async (req: Request, res: Response) => {
    const q = req.validated.query as PaymentListQuery;
    const { items, total, totals } = await this.payments.list(req.tenant!, q);
    ok(res, items, 200, { page: q.page, pageSize: q.pageSize, total, totals });
  };
  getPayment = async (req: Request, res: Response) => ok(res, await this.payments.get(req.tenant!, id(req)));
  createPayment = async (req: Request, res: Response) => {
    const r = await this.payments.create(req.tenant!, req.auth!.userId, req.body, req.get('idempotency-key')!, requestContext(req));
    ok(res, r.payment, 201, { warnings: r.warnings });
  };
  cancelPayment = async (req: Request, res: Response) => {
    const r = await this.approvals.cancelOrRequest(req.tenant!, req.auth!.userId, 'Payment', id(req), req.body.reason, requestContext(req));
    if (r.status === 'PENDING_APPROVAL') ok(res, { status: r.status, approvalRequest: r.result }, 202);
    else ok(res, { status: r.status, record: r.result });
  };
  receipt = async (req: Request, res: Response) => {
    const { html, fileName } = await this.payments.receiptHtml(req.tenant!, id(req), req.query.print === '1');
    if (req.query.format === 'pdf') return this.sendPdf(req, res, (await this.payments.receiptHtml(req.tenant!, id(req), false)).html, fileName);
    this.sendHtml(res, html);
  };

  // ---------------------------------------------------------------- statements
  statement = (side: 'farmer' | 'buyer') => async (req: Request, res: Response) => {
    const q = req.validated.query as StatementQuery;
    const partyId = id(req);
    if (q.format === 'json') return ok(res, await this.statements.statement(req.tenant!, side, partyId, q.from, q.to));
    const lang = req.query.lang === 'en' ? 'en' : 'hi';
    const doc = await this.statements.document(req.tenant!, side, partyId, q.from, q.to, lang);
    if (q.format === 'pdf') {
      await this.beforeExport(req, `statement:${side}`);
      return this.sendPdf(req, res, doc.html(false), doc.fileName);
    }
    this.sendHtml(res, doc.html(req.query.print === '1'));
  };

  // ---------------------------------------------------------------- expenses
  listExpenses = async (req: Request, res: Response) => {
    const q = req.validated.query as ExpenseListQuery;
    const { items, total, totals } = await this.expenses.list(req.tenant!, q);
    ok(res, items, 200, { page: q.page, pageSize: q.pageSize, total, totals });
  };
  createExpense = async (req: Request, res: Response) => ok(res, await this.expenses.create(req.tenant!, req.auth!.userId, req.body, requestContext(req)), 201);
  cancelExpense = async (req: Request, res: Response) => {
    const r = await this.approvals.cancelOrRequest(req.tenant!, req.auth!.userId, 'Expense', id(req), req.body.reason, requestContext(req));
    if (r.status === 'PENDING_APPROVAL') ok(res, { status: r.status, approvalRequest: r.result }, 202);
    else ok(res, { status: r.status, record: r.result });
  };
  categories = async (req: Request, res: Response) => ok(res, await this.expenses.categories(req.tenant!, req.query.includeInactive === 'true'));
  createCategory = async (req: Request, res: Response) => ok(res, await this.expenses.createCategory(req.tenant!, req.auth!.userId, req.body, requestContext(req)), 201);
  updateCategory = async (req: Request, res: Response) => ok(res, await this.expenses.updateCategory(req.tenant!, req.auth!.userId, id(req), req.body, requestContext(req)));

  // ---------------------------------------------------------------- reports
  report = async (req: Request, res: Response) => {
    const key = (req.validated.params as { key: ReportKey }).key;
    const q = req.validated.query as ReportQuery;
    const result = await this.reports.run(req.tenant!, key, q.from, q.to);
    if (q.format === 'json') return ok(res, result);
    const doc = await this.reports.toDoc(req.tenant!, result, q.lang);
    const base = `${key}-${result.from ?? ''}${result.from ? '_' : ''}${result.to ?? ''}`;
    if (q.format === 'html') return this.sendHtml(res, this.reports.html(doc, req.query.print === '1'));
    await this.beforeExport(req, `report:${key}:${q.format}`);
    if (q.format === 'pdf') return this.sendPdf(req, res, this.reports.html(doc, false), `${base}.pdf`);
    res
      .status(200)
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader('cache-control', 'private, no-store')
      .setHeader('content-disposition', `attachment; filename="${base}.xlsx"`)
      .send(this.reports.xlsx(doc));
  };
}
