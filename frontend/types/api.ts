/** Money / weight fields are decimal strings from the API. Never parse them for arithmetic. */
export type Money = string;

export interface ApiErrorBody {
  success: false;
  error: { code: string; message: string; details?: unknown };
  requestId?: string;
}

export interface Paged<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

export interface PublicUser {
  id: string;
  fullName: string;
  mobile: string;
  email: string | null;
  preferredLanguage: 'HI' | 'EN';
  isPlatformAdmin: boolean;
}

export interface MembershipSummary {
  id: string;
  businessId: string;
  role: { key: string; name: string; nameHindi: string | null };
  business: { name: string; nameHindi: string | null; mandiName: string | null };
}

export interface Me {
  user: PublicUser;
  memberships: MembershipSummary[];
  activeBusiness: null | {
    businessId: string;
    name: string;
    nameHindi: string | null;
    isOwner: boolean;
    role: { key: string; name: string; nameHindi: string | null };
    permissions: string[];
    subscription: null | {
      status: string;
      planCode: string;
      trialEndsAt: string | null;
      currentPeriodEnd: string | null;
      features: Record<string, unknown>;
    };
  };
}

export type Consent = 'UNKNOWN' | 'OPTED_IN' | 'OPTED_OUT';
export type Unit = 'KG' | 'QUINTAL' | 'TON' | 'BAG';

export interface FarmerListItem {
  id: string;
  code: string;
  name: string;
  nameHindi: string | null;
  fatherName: string | null;
  mobile: string | null;
  village: string | null;
  district: string | null;
  currentBalance: Money;
  isActive: boolean;
  createdAt: string;
}

export interface Farmer extends FarmerListItem {
  tehsil: string | null;
  state: string | null;
  address: string | null;
  notes: string | null;
  openingBalance: Money;
  whatsappConsent: Consent;
  registeredAt: string;
  bankAccounts?: BankAccount[];
}

export interface FarmerSummary {
  currentBalance: Money;
  openingBalance: Money;
  lotCount: number;
  lastArrivalDate: string | null;
  unbilledPurchases: { count: number; amount: Money };
  finalizedPattiCount: number;
}

export interface BankAccount {
  id: string;
  farmerId: string;
  accountHolderName: string;
  accountNumberLast4: string;
  accountNumberMasked: string;
  ifsc: string | null;
  bankName: string | null;
  upiId: string | null;
  isPrimary: boolean;
}

export interface BuyerListItem {
  id: string;
  code: string;
  firmName: string;
  ownerName: string | null;
  mobile: string | null;
  city: string | null;
  gstin: string | null;
  currentBalance: Money;
  creditLimit: Money | null;
  overCreditLimit: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface Buyer extends BuyerListItem {
  address: string | null;
  notes: string | null;
  openingBalance: Money;
  whatsappConsent: Consent;
}

export interface BuyerSummary {
  currentBalance: Money;
  openingBalance: Money;
  creditLimit: Money | null;
  overCreditLimit: boolean;
  sales: { count: number; amount: Money };
  lastSaleDate: string | null;
}

export interface Grade {
  id: string;
  name: string;
  isActive: boolean;
}

export interface Commodity {
  id: string;
  name: string;
  nameHindi: string | null;
  defaultUnit: Unit;
  rateUnit: Unit;
  bagWeightKg: Money | null;
  isActive: boolean;
  sortOrder: number;
  grades: Grade[];
}

export interface Business {
  id: string;
  name: string;
  nameHindi: string | null;
  mandiName: string | null;
  licenseNumber: string | null;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
}

export interface BusinessSettings {
  tradingMode: 'COMMISSION_AGENT' | 'TRADER' | 'MIXED';
  defaultRateUnit: Unit;
  fiscalYearStartMonth: number;
  netRounding: 'NONE' | 'NEAREST_RUPEE';
  pattiLanguage: 'HI' | 'EN' | 'BILINGUAL';
  pattiFooterNote: string | null;
  requireApprovalForCancel: boolean;
  allowNegativeFarmerBalance: boolean;
  autoAdjustAdvanceInPatti: boolean;
}

export type RangeKey = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

export interface Dashboard {
  range: { key: RangeKey; from: string; to: string };
  counts: { farmers: number; buyers: number };
  arrivals: { lots: number; netWeightKg: Money; bags: number };
  purchases: { count: number; grossAmount: Money; weightKg: Money };
  grossSales: { count: number; amount: Money; weightKg: Money };
  commissionIncome: Money;
  expenses: { count: number; amount: Money };
  payables: { farmers: number; amount: Money };
  advancesOutstanding: { farmers: number; amount: Money };
  receivables: { buyers: number; amount: Money };
  alerts: {
    buyersOverCreditLimit: { id: string; code: string; firmName: string; currentBalance: Money; creditLimit: Money }[];
    topReceivables: { id: string; code: string; firmName: string; currentBalance: Money }[];
    pendingApprovals: number;
    trialDaysLeft: number | null;
  };
  recent: {
    type: 'SALE' | 'PURCHASE' | 'PAYMENT_IN' | 'PAYMENT_OUT' | 'EXPENSE';
    id: string;
    number: string;
    date: string;
    amount: Money;
    party: string;
    status: string;
  }[];
  monthly: { month: string; grossSales: Money; purchases: Money; commission: Money; expenses: Money }[];
}

export interface StaffList {
  members: {
    membershipId: string;
    status: 'ACTIVE' | 'INVITED' | 'DEACTIVATED';
    joinedAt: string | null;
    isOwner: boolean;
    user: { id: string; fullName: string; mobile: string; lastLoginAt: string | null; status: string };
    role: { key: string; name: string; nameHindi: string | null };
  }[];
  invites: { id: string; mobile: string; fullName: string | null; role: { key: string; name: string }; expiresAt: string }[];
}

export interface ActivityRow {
  id: string;
  activityType: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

// ------------------------------------------------------------------ Phase 4: operations

export type LotStatus = 'DRAFT' | 'CONFIRMED' | 'PARTIALLY_SOLD' | 'SOLD' | 'CANCELLED';
type Ref = { id: string; name: string; nameHindi: string | null };

export interface Lot {
  id: string;
  lotNumber: string;
  farmerId: string;
  commodityId: string;
  arrivalDate: string;
  vehicleNumber: string | null;
  bags: number;
  grossWeightKg: Money;
  tareWeightKg: Money;
  netWeightKg: Money;
  soldWeightKg: Money;
  purchasedWeightKg: Money;
  availableToSellKg: Money;
  unsoldKg: Money;
  purchasedUnsoldKg: Money;
  moisturePercent: Money | null;
  remarks: string | null;
  status: LotStatus;
  version: number;
  cancelReason: string | null;
  farmer: Ref & { code: string; village: string | null };
  commodity: Ref & { rateUnit: Unit; defaultUnit: Unit; bagWeightKg: Money | null };
  grade: { id: string; name: string } | null;
}

export interface SaleCharge {
  id: string;
  label: string;
  chargeType: string;
  calcMethod: string;
  rateValue: Money;
  amount: Money;
}

export interface Sale {
  id: string;
  saleNumber: string;
  saleDate: string;
  weightKg: Money;
  bags: number;
  rate: Money;
  rateUnit: Unit;
  grossAmount: Money;
  chargesTotal: Money;
  totalAmount: Money;
  status: 'ACTIVE' | 'CANCELLED';
  cancelReason: string | null;
  buyer: { id: string; code: string; firmName: string };
  lot: { id: string; lotNumber: string; farmerId: string; farmer: Ref & { code: string } };
  commodity: Ref;
  charges: SaleCharge[];
  purchase: { id: string; purchaseNumber: string; pattiId: string | null; status: string } | null;
}

export interface LotDetail extends Lot {
  sales: (Omit<Sale, 'lot' | 'commodity' | 'purchase'> & { charges: SaleCharge[] })[];
  purchases: { id: string; purchaseNumber: string; purchaseDate: string; weightKg: Money; rate: Money; rateUnit: Unit; grossAmount: Money; status: string; saleId: string | null; pattiId: string | null }[];
}

export interface Purchase {
  id: string;
  purchaseNumber: string;
  purchaseDate: string;
  weightKg: Money;
  bags: number;
  rate: Money;
  rateUnit: Unit;
  grossAmount: Money;
  status: 'ACTIVE' | 'CANCELLED';
  saleId: string | null;
  pattiId: string | null;
  farmer: Ref & { code: string };
  lot: { id: string; lotNumber: string };
  commodity: Ref;
  patti: { id: string; pattiNumber: string; status: string } | null;
}

export interface SalePreview {
  weightKg: Money;
  grossAmount: Money;
  charges: { label: string; amount: Money; chargeType: string }[];
  chargesTotal: Money;
  totalAmount: Money;
}

export interface Deduction {
  id?: string;
  label: string;
  labelHindi: string | null;
  chargeType: string;
  calcMethod: string;
  rateValue: Money;
  baseValue: Money;
  amount: Money;
  isManual: boolean;
}

export interface PattiLine {
  id: string;
  purchaseNumber: string;
  purchaseDate: string;
  weightKg: Money;
  bags: number;
  rate: Money;
  rateUnit: Unit;
  grossAmount: Money;
  lot: { lotNumber: string };
  commodity: { name: string; nameHindi: string | null };
}

export interface PattiTotals {
  totalWeightKg: Money;
  totalBags: number;
  grossAmount: Money;
  totalDeductions: Money;
  netAmount: Money;
  advanceAdjusted: Money;
  roundOff: Money;
  netPayable: Money;
}

export interface PattiPreview extends PattiTotals {
  farmer: { id: string; code: string; name: string; nameHindi: string | null; currentBalance: Money };
  outstandingAdvance: Money;
  lines: PattiLine[];
  deductions: Deduction[];
  ledgerCredit: Money;
}

export interface Patti extends PattiTotals {
  id: string;
  pattiNumber: string;
  pattiDate: string;
  status: 'FINALIZED' | 'CANCELLED';
  cancelReason: string | null;
  notes: string | null;
  farmer: { id: string; code: string; name: string; nameHindi: string | null; mobile: string | null; whatsappConsent: Consent; village?: string | null };
  deductions: Deduction[];
  purchases: PattiLine[];
  finalizedBy?: { fullName: string } | null;
}

export interface CommissionRule {
  id: string;
  name: string;
  nameHindi: string | null;
  chargeType: 'COMMISSION' | 'LABOUR' | 'WEIGHING' | 'TRANSPORT' | 'MARKET_FEE' | 'LOADING_UNLOADING' | 'OTHER';
  calcMethod: 'PERCENTAGE' | 'FIXED' | 'PER_QUINTAL' | 'PER_KG' | 'PER_BAG';
  value: Money;
  appliesTo: 'FARMER' | 'BUYER';
  commodityId: string | null;
  commodity: Ref | null;
  priority: number;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface ApprovalRequest {
  id: string;
  entityType: 'Lot' | 'Sale' | 'Purchase' | 'Patti';
  entityId: string;
  action: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  requestedBy: { id: string; fullName: string };
  decidedBy: { id: string; fullName: string } | null;
}

export type CancelResult<T> = { status: 'CANCELLED'; record: T } | { status: 'PENDING_APPROVAL'; approvalRequest: ApprovalRequest };

// ------------------------------------------------------------------ Phase 5: money

export type PaymentMode = 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE';

export interface Payment {
  id: string;
  receiptNumber: string;
  partySide: 'FARMER' | 'BUYER';
  direction: 'INCOMING' | 'OUTGOING';
  purpose: 'ADVANCE' | 'SETTLEMENT' | 'COLLECTION';
  mode: PaymentMode;
  referenceNumber: string | null;
  amount: Money;
  paymentDate: string;
  remarks: string | null;
  status: 'ACTIVE' | 'CANCELLED';
  cancelReason: string | null;
  farmer: { id: string; code: string; name: string; nameHindi: string | null; village: string | null; mobile: string | null } | null;
  buyer: { id: string; code: string; firmName: string; city: string | null; mobile: string | null } | null;
  createdBy: { fullName: string };
}

export interface ExpenseCategory {
  id: string;
  name: string;
  nameHindi: string | null;
  isSystem: boolean;
  isActive: boolean;
}

export interface Expense {
  id: string;
  expenseNumber: string;
  expenseDate: string;
  amount: Money;
  mode: PaymentMode;
  payee: string | null;
  referenceNumber: string | null;
  remarks: string | null;
  status: 'ACTIVE' | 'CANCELLED';
  cancelReason: string | null;
  category: { id: string; name: string; nameHindi: string | null };
  createdBy: { fullName: string };
}

export interface StatementEntry {
  id: string;
  date: string;
  type: string;
  ref: string | null;
  narration: string;
  debit: Money;
  credit: Money;
  balance: Money;
}

export interface Statement {
  side: 'farmer' | 'buyer';
  party: { id: string; code: string; name?: string; nameHindi?: string | null; firmName?: string; village?: string | null; city?: string | null; mobile: string | null };
  from: string | null;
  to: string | null;
  openingBalance: Money;
  entries: StatementEntry[];
  totals: { debit: Money; credit: Money };
  closingBalance: Money;
  currentBalance: Money;
}

export type ColumnType = 'text' | 'money' | 'weight' | 'int' | 'date';
export interface ReportResult {
  key: string;
  title: { hi: string; en: string };
  from: string | null;
  to: string | null;
  columns: { key: string; header: { hi: string; en: string }; type: ColumnType }[];
  rows: Record<string, string | number | null>[];
  totals?: Record<string, string | number | null>;
  breakdown?: { title: { hi: string; en: string }; rows: { label: string; value: string }[] };
  notes?: { hi: string; en: string }[];
}

// ------------------------------------------------------------------ Phase 6: AI, WhatsApp, notifications

export interface AiAnswer {
  conversationId: string;
  answer: string;
  tools: string[];
  stopReason: string | null;
}

export interface AiConversationSummary {
  id: string;
  title: string | null;
  updatedAt: string;
}

export interface AiConversation {
  id: string;
  title: string | null;
  messages: { id: string; role: 'USER' | 'ASSISTANT' | 'TOOL'; inputMode: 'TEXT' | 'VOICE' | 'IMAGE'; content: string; createdAt: string; tools: string[] }[];
}

export interface AiUsage {
  configured: boolean;
  enabled: boolean;
  limit: number;
  used: number;
}

type Opt = { id: string; label: string };
export interface AiDraft {
  id: string;
  status: 'PENDING' | 'CONFIRMED' | 'DISCARDED' | 'EXPIRED';
  type: 'LOT' | 'SALE' | 'PAYMENT' | 'EXPENSE' | 'FARMER';
  kind: 'LOT' | 'SALE' | 'PAYMENT' | 'EXPENSE' | 'UNKNOWN';
  confidence: 'high' | 'medium' | 'low';
  fields: {
    farmerId: string | null;
    buyerId: string | null;
    commodityId: string | null;
    lotId: string | null;
    categoryId: string | null;
    quantity: string;
    quantityUnit: Unit;
    bags: string;
    rate: string;
    rateUnit: Unit | '';
    amount: string;
    paymentSide: 'FARMER' | 'BUYER' | '';
    paymentPurpose: 'ADVANCE' | 'SETTLEMENT' | 'COLLECTION' | '';
    paymentMode: PaymentMode;
    reference: string;
    date: string;
    vehicleNumber: string;
    notes: string;
  };
  names: { farmer: string; buyer: string; commodity: string; category: string };
  candidates: { farmers: Opt[]; buyers: Opt[]; lots: Opt[]; commodity: Opt | null; category: Opt | null };
  warnings: string[];
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export type WhatsAppKind = 'PATTI' | 'STATEMENT' | 'RECEIPT' | 'REMINDER';
