import { createApi } from '@reduxjs/toolkit/query/react';
import type {
  ActivityRow,
  BankAccount,
  Business,
  BusinessSettings,
  Buyer,
  BuyerListItem,
  BuyerSummary,
  Commodity,
  Dashboard,
  Farmer,
  FarmerListItem,
  FarmerSummary,
  Me,
  RangeKey,
  StaffList,
  ApprovalRequest,
  CancelResult,
  CommissionRule,
  Lot,
  LotDetail,
  Patti,
  PattiPreview,
  Purchase,
  Sale,
  SalePreview,
  Expense,
  ExpenseCategory,
  Payment,
  ReportResult,
  Statement,
  AiAnswer,
  AiConversation,
  AiConversationSummary,
  AiDraft,
  AiUsage,
  AppNotification,
  WhatsAppKind,
} from '@/types/api';
import type {
  AdminBusinessDetail,
  AdminBusinessRow,
  AdminOverview,
  AdminPaymentRow,
  BillingOverview,
  BillingPaymentRow,
  CheckoutOrder,
  Plan,
} from '@/types/billing';
import { baseQueryWithRefresh } from './base-query';

type Ok<T> = { success: true; data: T; meta?: Record<string, unknown> };
type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
type Params = Record<string, string | number | boolean | undefined>;
/** Financial writes carry a client-generated Idempotency-Key (one per form submission intent). */
type Idem<T> = { key: string; body: T };
type Warnings ={ warnings?: { code: string; name?: string; farmerCode?: string; firmName?: string; buyerCode?: string }[] };

const unwrap = <T,>(r: Ok<T>) => r.data;
const unwrapPage = <T,>(r: Ok<T[]>): Page<T> => ({
  items: r.data,
  total: Number(r.meta?.total ?? 0),
  page: Number(r.meta?.page ?? 1),
  pageSize: Number(r.meta?.pageSize ?? 25),
});
const withWarnings = <T,>(r: Ok<T>) => ({ data: r.data, warnings: (r.meta as Warnings | undefined)?.warnings ?? [] });

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
}

export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithRefresh,
  tagTypes: ['Me', 'Dashboard', 'Farmer', 'Buyer', 'Commodity', 'Business', 'Settings', 'Staff', 'Bank', 'Lot', 'Sale', 'Purchase', 'Patti', 'Rule', 'Approval', 'Payment', 'Ledger', 'Expense', 'ExpenseCategory', 'Report', 'AiUsage', 'AiConversation', 'Notification', 'Billing', 'Admin'],
  endpoints: (b) => ({
    // ---------------------------------------------------------------- billing (SaaS subscription)
    plans: b.query<{ plans: Plan[]; provider: string }, void>({
      query: () => '/billing/plans',
      transformResponse: (r: Ok<Plan[]>) => ({ plans: r.data, provider: String(r.meta?.provider ?? '') }),
      providesTags: ['Billing'],
    }),
    billing: b.query<BillingOverview, void>({ query: () => '/billing/subscription', transformResponse: unwrap<BillingOverview>, providesTags: ['Billing'] }),
    billingPayments: b.query<BillingPaymentRow[], void>({ query: () => '/billing/payments', transformResponse: unwrap<BillingPaymentRow[]>, providesTags: ['Billing'] }),
    checkout: b.mutation<CheckoutOrder, string>({ query: (planCode) => ({ url: '/billing/checkout', method: 'POST', body: { planCode } }), transformResponse: unwrap<CheckoutOrder> }),
    mockComplete: b.mutation<{ orderId: string; paymentId: string; signature: string }, string>({
      query: (orderId) => ({ url: '/billing/mock/complete', method: 'POST', body: { orderId } }),
      transformResponse: unwrap<{ orderId: string; paymentId: string; signature: string }>,
    }),
    verifyPayment: b.mutation<BillingOverview, { orderId: string; paymentId: string; signature: string }>({
      query: (body) => ({ url: '/billing/verify', method: 'POST', body }),
      transformResponse: unwrap<BillingOverview>,
      // The plan changes feature flags and limits everywhere — refresh the session view too.
      invalidatesTags: ['Billing', 'Me', 'AiUsage', 'Dashboard'],
    }),
    changePlan: b.mutation<BillingOverview, string>({ query: (planCode) => ({ url: '/billing/change-plan', method: 'POST', body: { planCode } }), transformResponse: unwrap<BillingOverview>, invalidatesTags: ['Billing'] }),
    clearPendingPlan: b.mutation<BillingOverview, void>({ query: () => ({ url: '/billing/change-plan/cancel', method: 'POST', body: {} }), transformResponse: unwrap<BillingOverview>, invalidatesTags: ['Billing'] }),
    setCancelAtPeriodEnd: b.mutation<BillingOverview, boolean>({
      query: (cancel) => ({ url: cancel ? '/billing/cancel' : '/billing/resume', method: 'POST', body: {} }),
      transformResponse: unwrap<BillingOverview>,
      invalidatesTags: ['Billing'],
    }),

    // ---------------------------------------------------------------- platform admin
    adminOverview: b.query<AdminOverview, void>({ query: () => '/admin/overview', transformResponse: unwrap<AdminOverview>, providesTags: ['Admin'] }),
    adminBusinesses: b.query<Page<AdminBusinessRow>, Params>({ query: (p) => `/admin/businesses${qs(p)}`, transformResponse: unwrapPage<AdminBusinessRow>, providesTags: ['Admin'] }),
    adminBusiness: b.query<AdminBusinessDetail, string>({ query: (id) => `/admin/businesses/${id}`, transformResponse: unwrap<AdminBusinessDetail>, providesTags: ['Admin'] }),
    adminAction: b.mutation<AdminBusinessDetail, { id: string; action: 'suspend' | 'reactivate' | 'extend'; body?: Record<string, unknown> }>({
      query: ({ id, action, body }) => ({ url: `/admin/businesses/${id}/${action}`, method: 'POST', body: body ?? {} }),
      transformResponse: unwrap<AdminBusinessDetail>,
      invalidatesTags: ['Admin'],
    }),
    adminPayments: b.query<Page<AdminPaymentRow>, Params>({ query: (p) => `/admin/payments${qs(p)}`, transformResponse: unwrapPage<AdminPaymentRow>, providesTags: ['Admin'] }),

    // ---------------------------------------------------------------- auth
    me: b.query<Me, void>({ query: () => '/auth/me', transformResponse: unwrap<Me>, providesTags: ['Me'] }),
    login: b.mutation<unknown, { mobile: string; password: string }>({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
      invalidatesTags: ['Me'],
    }),
    register: b.mutation<unknown, Record<string, unknown>>({
      query: (body) => ({ url: '/auth/register', method: 'POST', body }),
      invalidatesTags: ['Me'],
    }),
    logout: b.mutation<void, void>({ query: () => ({ url: '/auth/logout', method: 'POST' }) }),
    switchBusiness: b.mutation<unknown, string>({
      query: (businessId) => ({ url: '/auth/switch-business', method: 'POST', body: { businessId } }),
    }),
    changePassword: b.mutation<void, { currentPassword: string; newPassword: string }>({
      query: (body) => ({ url: '/auth/change-password', method: 'POST', body }),
    }),
    invitePreview: b.query<
      { businessName: string; businessNameHindi: string | null; roleKey: string; roleNameHindi: string | null; roleName: string; mobile: string; fullName: string | null; userExists: boolean },
      string
    >({ query: (token) => `/auth/invites/${token}`, transformResponse: unwrap }),
    acceptInvite: b.mutation<unknown, { token: string; password: string; fullName?: string }>({
      query: ({ token, ...body }) => ({ url: `/auth/invites/${token}/accept`, method: 'POST', body }),
      invalidatesTags: ['Me'],
    }),

    // ---------------------------------------------------------------- dashboard
    dashboard: b.query<Dashboard, { range: RangeKey; from?: string; to?: string }>({
      query: (p) => `/reports/dashboard${qs(p)}`,
      transformResponse: unwrap<Dashboard>,
      providesTags: ['Dashboard'],
    }),

    // ---------------------------------------------------------------- farmers
    farmers: b.query<Page<FarmerListItem>, Record<string, string | number | boolean | undefined>>({
      query: (p) => `/farmers${qs(p)}`,
      transformResponse: unwrapPage<FarmerListItem>,
      providesTags: ['Farmer'],
    }),
    villages: b.query<string[], void>({ query: () => '/farmers/villages', transformResponse: unwrap<string[]>, providesTags: ['Farmer'] }),
    farmer: b.query<Farmer, string>({ query: (id) => `/farmers/${id}`, transformResponse: unwrap<Farmer>, providesTags: (_r, _e, id) => [{ type: 'Farmer', id }] }),
    farmerSummary: b.query<FarmerSummary, string>({
      query: (id) => `/farmers/${id}/summary`,
      transformResponse: unwrap<FarmerSummary>,
      providesTags: (_r, _e, id) => [{ type: 'Farmer', id }],
    }),
    createFarmer: b.mutation<ReturnType<typeof withWarnings<Farmer>>, Record<string, unknown>>({
      query: (body) => ({ url: '/farmers', method: 'POST', body }),
      transformResponse: withWarnings<Farmer>,
      invalidatesTags: ['Farmer', 'Dashboard'],
    }),
    updateFarmer: b.mutation<Farmer, { id: string; body: Record<string, unknown> }>({
      query: ({ id, body }) => ({ url: `/farmers/${id}`, method: 'PATCH', body }),
      transformResponse: unwrap<Farmer>,
      invalidatesTags: (_r, _e, a) => ['Farmer', { type: 'Farmer', id: a.id }],
    }),
    deleteFarmer: b.mutation<void, string>({
      query: (id) => ({ url: `/farmers/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Farmer', 'Dashboard'],
    }),
    bankAccounts: b.query<BankAccount[], string>({
      query: (farmerId) => `/farmers/${farmerId}/bank-accounts`,
      transformResponse: unwrap<BankAccount[]>,
      providesTags: (_r, _e, id) => [{ type: 'Bank', id }],
    }),
    addBankAccount: b.mutation<BankAccount, { farmerId: string; body: Record<string, unknown> }>({
      query: ({ farmerId, body }) => ({ url: `/farmers/${farmerId}/bank-accounts`, method: 'POST', body }),
      transformResponse: unwrap<BankAccount>,
      invalidatesTags: (_r, _e, a) => [{ type: 'Bank', id: a.farmerId }],
    }),
    revealBankAccount: b.mutation<{ accountNumber: string }, { farmerId: string; accountId: string }>({
      query: ({ farmerId, accountId }) => ({ url: `/farmers/${farmerId}/bank-accounts/${accountId}/reveal`, method: 'POST' }),
      transformResponse: unwrap<{ accountNumber: string }>,
    }),
    removeBankAccount: b.mutation<void, { farmerId: string; accountId: string }>({
      query: ({ farmerId, accountId }) => ({ url: `/farmers/${farmerId}/bank-accounts/${accountId}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Bank', id: a.farmerId }],
    }),

    // ---------------------------------------------------------------- buyers
    buyers: b.query<Page<BuyerListItem>, Record<string, string | number | boolean | undefined>>({
      query: (p) => `/buyers${qs(p)}`,
      transformResponse: unwrapPage<BuyerListItem>,
      providesTags: ['Buyer'],
    }),
    buyer: b.query<Buyer, string>({ query: (id) => `/buyers/${id}`, transformResponse: unwrap<Buyer>, providesTags: (_r, _e, id) => [{ type: 'Buyer', id }] }),
    buyerSummary: b.query<BuyerSummary, string>({
      query: (id) => `/buyers/${id}/summary`,
      transformResponse: unwrap<BuyerSummary>,
      providesTags: (_r, _e, id) => [{ type: 'Buyer', id }],
    }),
    createBuyer: b.mutation<ReturnType<typeof withWarnings<Buyer>>, Record<string, unknown>>({
      query: (body) => ({ url: '/buyers', method: 'POST', body }),
      transformResponse: withWarnings<Buyer>,
      invalidatesTags: ['Buyer', 'Dashboard'],
    }),
    updateBuyer: b.mutation<Buyer, { id: string; body: Record<string, unknown> }>({
      query: ({ id, body }) => ({ url: `/buyers/${id}`, method: 'PATCH', body }),
      transformResponse: unwrap<Buyer>,
      invalidatesTags: (_r, _e, a) => ['Buyer', { type: 'Buyer', id: a.id }, 'Dashboard'],
    }),
    deleteBuyer: b.mutation<void, string>({ query: (id) => ({ url: `/buyers/${id}`, method: 'DELETE' }), invalidatesTags: ['Buyer', 'Dashboard'] }),

    // ---------------------------------------------------------------- commodities
    commodities: b.query<Commodity[], { includeInactive?: boolean } | void>({
      query: (p) => `/commodities${qs({ includeInactive: p?.includeInactive })}`,
      transformResponse: unwrap<Commodity[]>,
      providesTags: ['Commodity'],
    }),
    createCommodity: b.mutation<Commodity, Record<string, unknown>>({
      query: (body) => ({ url: '/commodities', method: 'POST', body }),
      transformResponse: unwrap<Commodity>,
      invalidatesTags: ['Commodity'],
    }),
    updateCommodity: b.mutation<Commodity, { id: string; body: Record<string, unknown> }>({
      query: ({ id, body }) => ({ url: `/commodities/${id}`, method: 'PATCH', body }),
      transformResponse: unwrap<Commodity>,
      invalidatesTags: ['Commodity'],
    }),
    addGrade: b.mutation<unknown, { id: string; name: string }>({
      query: ({ id, name }) => ({ url: `/commodities/${id}/grades`, method: 'POST', body: { name } }),
      invalidatesTags: ['Commodity'],
    }),
    updateGrade: b.mutation<unknown, { id: string; gradeId: string; isActive: boolean }>({
      query: ({ id, gradeId, isActive }) => ({ url: `/commodities/${id}/grades/${gradeId}`, method: 'PATCH', body: { isActive } }),
      invalidatesTags: ['Commodity'],
    }),

    // ---------------------------------------------------------------- business
    business: b.query<Business, void>({ query: () => '/businesses/current', transformResponse: unwrap<Business>, providesTags: ['Business'] }),
    updateBusiness: b.mutation<Business, Record<string, unknown>>({
      query: (body) => ({ url: '/businesses/current', method: 'PATCH', body }),
      transformResponse: unwrap<Business>,
      invalidatesTags: ['Business', 'Me'],
    }),
    settings: b.query<BusinessSettings, void>({ query: () => '/businesses/current/settings', transformResponse: unwrap<BusinessSettings>, providesTags: ['Settings'] }),
    updateSettings: b.mutation<BusinessSettings, Partial<BusinessSettings>>({
      query: (body) => ({ url: '/businesses/current/settings', method: 'PATCH', body }),
      transformResponse: unwrap<BusinessSettings>,
      invalidatesTags: ['Settings'],
    }),

    // ---------------------------------------------------------------- staff
    staff: b.query<StaffList, void>({ query: () => '/staff', transformResponse: unwrap<StaffList>, providesTags: ['Staff'] }),
    createInvite: b.mutation<{ inviteUrl: string; mobile: string; roleKey: string }, { mobile: string; roleKey: string; fullName?: string }>({
      query: (body) => ({ url: '/staff/invites', method: 'POST', body }),
      transformResponse: unwrap<{ inviteUrl: string; mobile: string; roleKey: string }>,
      invalidatesTags: ['Staff'],
    }),
    revokeInvite: b.mutation<void, string>({ query: (id) => ({ url: `/staff/invites/${id}`, method: 'DELETE' }), invalidatesTags: ['Staff'] }),
    updateMembership: b.mutation<unknown, { id: string; roleKey?: string; status?: 'ACTIVE' | 'DEACTIVATED' }>({
      query: ({ id, ...body }) => ({ url: `/staff/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Staff'],
    }),
    staffActivity: b.query<ActivityRow[], string>({ query: (id) => `/staff/${id}/activity`, transformResponse: unwrap<ActivityRow[]> }),

    // ---------------------------------------------------------------- lots
    lots: b.query<Page<Lot>, Params>({ query: (p) => `/lots${qs(p)}`, transformResponse: unwrapPage<Lot>, providesTags: ['Lot'] }),
    lot: b.query<LotDetail, string>({ query: (id) => `/lots/${id}`, transformResponse: unwrap<LotDetail>, providesTags: (_r, _e, id) => [{ type: 'Lot', id }] }),
    createLot: b.mutation<Lot, Idem<Record<string, unknown>>>({
      query: ({ key, body }) => ({ url: '/lots', method: 'POST', body, headers: { 'Idempotency-Key': key } }),
      transformResponse: unwrap<Lot>,
      invalidatesTags: ['Lot', 'Dashboard'],
    }),
    updateLot: b.mutation<Lot, { id: string; body: Record<string, unknown> }>({
      query: ({ id, body }) => ({ url: `/lots/${id}`, method: 'PATCH', body }),
      transformResponse: unwrap<Lot>,
      invalidatesTags: ['Lot'],
    }),
    confirmLot: b.mutation<Lot, string>({ query: (id) => ({ url: `/lots/${id}/confirm`, method: 'POST' }), transformResponse: unwrap<Lot>, invalidatesTags: ['Lot', 'Dashboard'] }),
    cancelLot: b.mutation<CancelResult<Lot>, Idem<{ id: string; reason: string }>>({
      query: ({ key, body }) => ({ url: `/lots/${body.id}/cancel`, method: 'POST', body: { reason: body.reason }, headers: { 'Idempotency-Key': key } }),
      transformResponse: unwrap<CancelResult<Lot>>,
      invalidatesTags: ['Lot', 'Dashboard', 'Approval'],
    }),
    calcLot: b.mutation<{ netWeightKg: string }, { weightUnit: string; grossWeight: string; tareWeight: string }>({
      query: (body) => ({ url: '/calculate/lot', method: 'POST', body }),
      transformResponse: unwrap<{ netWeightKg: string }>,
    }),

    // ---------------------------------------------------------------- sales & purchases
    sales: b.query<Page<Sale> & { totals?: Record<string, string | null> }, Params>({
      query: (p) => `/sales${qs(p)}`,
      transformResponse: (r: Ok<Sale[]>) => ({ ...unwrapPage<Sale>(r), totals: r.meta?.totals as Record<string, string | null> }),
      providesTags: ['Sale'],
    }),
    createSale: b.mutation<Sale, Idem<Record<string, unknown>>>({
      query: ({ key, body }) => ({ url: '/sales', method: 'POST', body, headers: { 'Idempotency-Key': key } }),
      transformResponse: unwrap<Sale>,
      invalidatesTags: ['Sale', 'Lot', 'Purchase', 'Buyer', 'Dashboard', 'Ledger'],
    }),
    cancelSale: b.mutation<CancelResult<Sale>, Idem<{ id: string; reason: string }>>({
      query: ({ key, body }) => ({ url: `/sales/${body.id}/cancel`, method: 'POST', body: { reason: body.reason }, headers: { 'Idempotency-Key': key } }),
      transformResponse: unwrap<CancelResult<Sale>>,
      invalidatesTags: ['Sale', 'Lot', 'Purchase', 'Buyer', 'Dashboard', 'Approval', 'Ledger'],
    }),
    calcSale: b.mutation<SalePreview, Record<string, unknown>>({ query: (body) => ({ url: '/calculate/sale', method: 'POST', body }), transformResponse: unwrap<SalePreview> }),
    purchases: b.query<Page<Purchase> & { totals?: Record<string, string | null> }, Params>({
      query: (p) => `/purchases${qs(p)}`,
      transformResponse: (r: Ok<Purchase[]>) => ({ ...unwrapPage<Purchase>(r), totals: r.meta?.totals as Record<string, string | null> }),
      providesTags: ['Purchase'],
    }),
    createPurchase: b.mutation<Purchase, Idem<Record<string, unknown>>>({
      query: ({ key, body }) => ({ url: '/purchases', method: 'POST', body, headers: { 'Idempotency-Key': key } }),
      transformResponse: unwrap<Purchase>,
      invalidatesTags: ['Purchase', 'Lot', 'Dashboard'],
    }),
    cancelPurchase: b.mutation<CancelResult<Purchase>, Idem<{ id: string; reason: string }>>({
      query: ({ key, body }) => ({ url: `/purchases/${body.id}/cancel`, method: 'POST', body: { reason: body.reason }, headers: { 'Idempotency-Key': key } }),
      transformResponse: unwrap<CancelResult<Purchase>>,
      invalidatesTags: ['Purchase', 'Lot', 'Dashboard', 'Approval'],
    }),

    // ---------------------------------------------------------------- patti
    pattis: b.query<Page<Patti>, Params>({ query: (p) => `/patti${qs(p)}`, transformResponse: unwrapPage<Patti>, providesTags: ['Patti'] }),
    patti: b.query<Patti, string>({ query: (id) => `/patti/${id}`, transformResponse: unwrap<Patti>, providesTags: (_r, _e, id) => [{ type: 'Patti', id }] }),
    pattiPreview: b.mutation<PattiPreview, Record<string, unknown>>({ query: (body) => ({ url: '/patti/preview', method: 'POST', body }), transformResponse: unwrap<PattiPreview> }),
    createPatti: b.mutation<Patti, Idem<Record<string, unknown>>>({
      query: ({ key, body }) => ({ url: '/patti', method: 'POST', body, headers: { 'Idempotency-Key': key } }),
      transformResponse: unwrap<Patti>,
      invalidatesTags: ['Patti', 'Purchase', 'Farmer', 'Dashboard', 'Ledger'],
    }),
    cancelPatti: b.mutation<CancelResult<Patti>, Idem<{ id: string; reason: string }>>({
      query: ({ key, body }) => ({ url: `/patti/${body.id}/cancel`, method: 'POST', body: { reason: body.reason }, headers: { 'Idempotency-Key': key } }),
      transformResponse: unwrap<CancelResult<Patti>>,
      invalidatesTags: ['Patti', 'Purchase', 'Farmer', 'Dashboard', 'Approval', 'Ledger'],
    }),

    // ---------------------------------------------------------------- rules & approvals
    rules: b.query<CommissionRule[], void>({ query: () => '/commission-rules', transformResponse: unwrap<CommissionRule[]>, providesTags: ['Rule'] }),
    createRule: b.mutation<CommissionRule, Record<string, unknown>>({ query: (body) => ({ url: '/commission-rules', method: 'POST', body }), invalidatesTags: ['Rule'] }),
    updateRule: b.mutation<CommissionRule, { id: string; body: Record<string, unknown> }>({
      query: ({ id, body }) => ({ url: `/commission-rules/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Rule'],
    }),
    approvals: b.query<Page<ApprovalRequest>, Params>({ query: (p) => `/approvals${qs(p)}`, transformResponse: unwrapPage<ApprovalRequest>, providesTags: ['Approval'] }),
    // ---------------------------------------------------------------- payments, ledgers, expenses, reports
    payments: b.query<Page<Payment> & { totals?: { paidOut: string; received: string } }, Params>({
      query: (p) => `/payments${qs(p)}`,
      transformResponse: (r: Ok<Payment[]>) => ({ ...unwrapPage<Payment>(r), totals: r.meta?.totals as { paidOut: string; received: string } }),
      providesTags: ['Payment'],
    }),
    createPayment: b.mutation<{ data: Payment; warnings: { code: string; receiptNumber?: string; outstanding?: string }[] }, Idem<Record<string, unknown>>>({
      query: ({ key, body }) => ({ url: '/payments', method: 'POST', body, headers: { 'Idempotency-Key': key } }),
      transformResponse: (r: Ok<Payment>) => ({ data: r.data, warnings: (r.meta?.warnings as { code: string }[]) ?? [] }),
      invalidatesTags: ['Payment', 'Farmer', 'Buyer', 'Ledger', 'Dashboard'],
    }),
    cancelPayment: b.mutation<CancelResult<Payment>, Idem<{ id: string; reason: string }>>({
      query: ({ key, body }) => ({ url: `/payments/${body.id}/cancel`, method: 'POST', body: { reason: body.reason }, headers: { 'Idempotency-Key': key } }),
      transformResponse: unwrap<CancelResult<Payment>>,
      invalidatesTags: ['Payment', 'Farmer', 'Buyer', 'Ledger', 'Dashboard', 'Approval'],
    }),
    statement: b.query<Statement, { side: 'farmers' | 'buyers'; id: string; from?: string; to?: string }>({
      query: ({ side, id, from, to }) => `/ledger/${side}/${id}${qs({ from, to })}`,
      transformResponse: unwrap<Statement>,
      providesTags: ['Ledger'],
    }),
    expenseCategories: b.query<ExpenseCategory[], { includeInactive?: boolean } | void>({
      query: (p) => `/expenses/categories${qs({ includeInactive: p?.includeInactive })}`,
      transformResponse: unwrap<ExpenseCategory[]>,
      providesTags: ['ExpenseCategory'],
    }),
    createExpenseCategory: b.mutation<ExpenseCategory, { name: string; nameHindi?: string | null }>({
      query: (body) => ({ url: '/expenses/categories', method: 'POST', body }),
      invalidatesTags: ['ExpenseCategory'],
    }),
    expenses: b.query<Page<Expense> & { totals?: { amount: string; byCategory: { categoryId: string; name: string; nameHindi: string | null; count: number; amount: string }[] } }, Params>({
      query: (p) => `/expenses${qs(p)}`,
      transformResponse: (r: Ok<Expense[]>) => ({ ...unwrapPage<Expense>(r), totals: r.meta?.totals as never }),
      providesTags: ['Expense'],
    }),
    createExpense: b.mutation<Expense, Idem<Record<string, unknown>>>({
      query: ({ key, body }) => ({ url: '/expenses', method: 'POST', body, headers: { 'Idempotency-Key': key } }),
      transformResponse: unwrap<Expense>,
      invalidatesTags: ['Expense', 'Dashboard'],
    }),
    cancelExpense: b.mutation<CancelResult<Expense>, Idem<{ id: string; reason: string }>>({
      query: ({ key, body }) => ({ url: `/expenses/${body.id}/cancel`, method: 'POST', body: { reason: body.reason }, headers: { 'Idempotency-Key': key } }),
      transformResponse: unwrap<CancelResult<Expense>>,
      invalidatesTags: ['Expense', 'Dashboard', 'Approval'],
    }),
    report: b.query<ReportResult, { key: string; from?: string; to?: string }>({
      query: ({ key, from, to }) => `/reports/${key}${qs({ from, to })}`,
      transformResponse: unwrap<ReportResult>,
      providesTags: ['Report'],
    }),
    // ---------------------------------------------------------------- AI assistant
    aiUsage: b.query<AiUsage, void>({ query: () => '/ai/usage', transformResponse: unwrap<AiUsage>, providesTags: ['AiUsage'] }),
    aiConversations: b.query<AiConversationSummary[], void>({ query: () => '/ai/conversations', transformResponse: unwrap<AiConversationSummary[]>, providesTags: ['AiConversation'] }),
    aiConversation: b.query<AiConversation, string>({
      query: (id) => `/ai/conversations/${id}`,
      transformResponse: unwrap<AiConversation>,
      providesTags: (_r, _e, id) => [{ type: 'AiConversation', id }],
    }),
    aiAsk: b.mutation<AiAnswer, { conversationId?: string; text: string; inputMode: 'TEXT' | 'VOICE' }>({
      query: (body) => ({ url: '/ai/ask', method: 'POST', body }),
      transformResponse: unwrap<AiAnswer>,
      invalidatesTags: ['AiConversation', 'AiUsage'],
    }),
    aiExtract: b.mutation<AiDraft, { text?: string; imageBase64?: string; imageMediaType?: string; source: 'VOICE' | 'TEXT' | 'IMAGE' }>({
      query: (body) => ({ url: '/ai/extract', method: 'POST', body }),
      transformResponse: unwrap<AiDraft>,
      invalidatesTags: ['AiUsage'],
    }),
    aiConfirmDraft: b.mutation<unknown, { id: string; entityType: 'Lot' | 'Sale' | 'Payment' | 'Expense'; entityId: string }>({
      query: ({ id, ...body }) => ({ url: `/ai/drafts/${id}/confirm`, method: 'POST', body }),
    }),
    aiDiscardDraft: b.mutation<void, string>({ query: (id) => ({ url: `/ai/drafts/${id}/discard`, method: 'POST' }) }),
    aiReminder: b.mutation<{ text: string; amount: string; source: 'ai' | 'template' | 'none' }, string>({
      query: (buyerId) => ({ url: '/ai/reminder', method: 'POST', body: { buyerId } }),
      transformResponse: unwrap<{ text: string; amount: string; source: 'ai' | 'template' | 'none' }>,
      invalidatesTags: ['AiUsage'],
    }),

    // ---------------------------------------------------------------- notifications & WhatsApp
    notifications: b.query<{ items: AppNotification[]; unread: number }, void>({
      query: () => '/notifications',
      transformResponse: (r: Ok<AppNotification[]>) => ({ items: r.data, unread: Number(r.meta?.unread ?? 0) }),
      providesTags: ['Notification'],
    }),
    readNotification: b.mutation<void, string>({ query: (id) => ({ url: `/notifications/${id}/read`, method: 'POST' }), invalidatesTags: ['Notification'] }),
    readAllNotifications: b.mutation<void, void>({ query: () => ({ url: '/notifications/read-all', method: 'POST' }), invalidatesTags: ['Notification'] }),
    sendWhatsApp: b.mutation<{ status: string; provider: string }, Idem<{ kind: WhatsAppKind; entityId?: string; farmerId?: string; buyerId?: string }>>({
      query: ({ key, body }) => ({ url: '/notifications/whatsapp/send', method: 'POST', body, headers: { 'Idempotency-Key': key } }),
      transformResponse: unwrap<{ status: string; provider: string }>,
    }),
    decideApproval: b.mutation<unknown, { id: string; decision: 'approve' | 'reject'; note?: string }>({
      query: ({ id, decision, note }) => ({ url: `/approvals/${id}/${decision}`, method: 'POST', body: note ? { note } : {} }),
      invalidatesTags: ['Approval', 'Lot', 'Sale', 'Purchase', 'Patti', 'Farmer', 'Buyer', 'Dashboard', 'Payment', 'Expense', 'Ledger'],
    }),
  }),
});

export const {
  useMeQuery,
  useLoginMutation,
  useRegisterMutation,
  useLogoutMutation,
  useSwitchBusinessMutation,
  useChangePasswordMutation,
  useInvitePreviewQuery,
  useAcceptInviteMutation,
  useDashboardQuery,
  useFarmersQuery,
  useVillagesQuery,
  useFarmerQuery,
  useFarmerSummaryQuery,
  useCreateFarmerMutation,
  useUpdateFarmerMutation,
  useDeleteFarmerMutation,
  useBankAccountsQuery,
  useAddBankAccountMutation,
  useRevealBankAccountMutation,
  useRemoveBankAccountMutation,
  useBuyersQuery,
  useBuyerQuery,
  useBuyerSummaryQuery,
  useCreateBuyerMutation,
  useUpdateBuyerMutation,
  useDeleteBuyerMutation,
  useCommoditiesQuery,
  useCreateCommodityMutation,
  useUpdateCommodityMutation,
  useAddGradeMutation,
  useUpdateGradeMutation,
  useBusinessQuery,
  useUpdateBusinessMutation,
  useSettingsQuery,
  useUpdateSettingsMutation,
  useStaffQuery,
  useCreateInviteMutation,
  useRevokeInviteMutation,
  useUpdateMembershipMutation,
  useStaffActivityQuery,
  useLotsQuery,
  useLotQuery,
  useCreateLotMutation,
  useUpdateLotMutation,
  useConfirmLotMutation,
  useCancelLotMutation,
  useCalcLotMutation,
  useSalesQuery,
  useCreateSaleMutation,
  useCancelSaleMutation,
  useCalcSaleMutation,
  usePurchasesQuery,
  useCreatePurchaseMutation,
  useCancelPurchaseMutation,
  usePattisQuery,
  usePattiQuery,
  usePattiPreviewMutation,
  useCreatePattiMutation,
  useCancelPattiMutation,
  useRulesQuery,
  useCreateRuleMutation,
  useUpdateRuleMutation,
  useApprovalsQuery,
  useDecideApprovalMutation,
  usePaymentsQuery,
  useCreatePaymentMutation,
  useCancelPaymentMutation,
  useStatementQuery,
  useExpenseCategoriesQuery,
  useCreateExpenseCategoryMutation,
  useExpensesQuery,
  useCreateExpenseMutation,
  useCancelExpenseMutation,
  useReportQuery,
  useAiUsageQuery,
  useAiConversationsQuery,
  useAiConversationQuery,
  useAiAskMutation,
  useAiExtractMutation,
  useAiConfirmDraftMutation,
  useAiDiscardDraftMutation,
  useAiReminderMutation,
  useNotificationsQuery,
  useReadNotificationMutation,
  useReadAllNotificationsMutation,
  useSendWhatsAppMutation,
  usePlansQuery,
  useBillingQuery,
  useBillingPaymentsQuery,
  useCheckoutMutation,
  useMockCompleteMutation,
  useVerifyPaymentMutation,
  useChangePlanMutation,
  useClearPendingPlanMutation,
  useSetCancelAtPeriodEndMutation,
  useAdminOverviewQuery,
  useAdminBusinessesQuery,
  useAdminBusinessQuery,
  useAdminActionMutation,
  useAdminPaymentsQuery,
} = api;
