// SaaS subscription billing and the platform admin console.
type Money = string;

export type SubStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED' | 'SUSPENDED';

export interface Plan {
  id: string;
  code: 'STARTER' | 'PROFESSIONAL' | 'BUSINESS';
  name: string;
  nameHindi: string | null;
  priceMonthly: Money;
  currency: string;
  maxStaffUsers: number | null;
  maxFarmers: number | null;
  maxMonthlyAiQueries: number;
  aiEnabled: boolean;
  whatsappEnabled: boolean;
  exportsEnabled: boolean;
  sortOrder: number;
}

export interface BillingOverview {
  status: SubStatus;
  plan: Plan;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pendingPlan: { code: string; name: string; nameHindi: string | null; priceMonthly: Money } | null;
  usage: { staff: number; farmers: number; aiQueriesThisMonth: number };
  provider: 'razorpay' | 'mock';
  warnings?: { resource: string; count: number; limit: number }[];
}

export interface CheckoutOrder {
  billingPaymentId: string;
  provider: 'razorpay' | 'mock';
  keyId: string;
  orderId: string;
  amount: Money;
  amountPaise: number;
  currency: string;
  kind: 'NEW' | 'RENEWAL' | 'UPGRADE';
  plan: { code: string; name: string; nameHindi: string | null };
  business: string;
  prefill: { name: string; contact: string; email?: string };
}

export interface BillingPaymentRow {
  id: string;
  amount: Money;
  currency: string;
  status: 'CREATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
  gatewayOrderId: string;
  gatewayPaymentId: string | null;
  verifiedAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  failureReason: string | null;
  createdAt: string;
  plan: { code: string; name: string; nameHindi: string | null };
}

export interface AdminOverview {
  businesses: Record<string, number>;
  subscriptions: Record<string, number>;
  activePaidByPlan: Record<string, number>;
  mrr: Money;
  revenueLast30Days: Money;
  paymentsLast30Days: number;
  failedPaymentsLast30Days: number;
  signupsLast30Days: number;
  trialsEndingIn7Days: number;
  generatedAt: string;
}

export type BusinessStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

export interface AdminBusinessRow {
  id: string;
  name: string;
  nameHindi: string | null;
  city: string | null;
  state: string | null;
  status: BusinessStatus;
  createdAt: string;
  owner: { fullName: string; mobile: string };
  subscription: null | { status: SubStatus; effectiveStatus: SubStatus; trialEndsAt: string | null; currentPeriodEnd: string | null; plan: { code: string } };
  _count: { memberships: number; farmers: number };
}

export interface AdminBusinessDetail {
  id: string;
  name: string;
  nameHindi: string | null;
  mandiName: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  status: BusinessStatus;
  suspendedAt: string | null;
  suspendReason: string | null;
  createdAt: string;
  owner: { id: string; fullName: string; mobile: string; email: string | null; lastLoginAt: string | null };
  subscription: null | {
    status: SubStatus;
    effectiveStatus: SubStatus;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    plan: { code: string; name: string; priceMonthly: Money };
    pendingPlan: { code: string } | null;
  };
  _count: { memberships: number; farmers: number; buyers: number; lots: number; pattis: number };
  events: { id: string; eventType: string; fromStatus: string | null; toStatus: string | null; fromPlanCode: string | null; toPlanCode: string | null; metadata: Record<string, unknown> | null; createdAt: string }[];
  payments: (Omit<BillingPaymentRow, 'plan'> & { plan: { code: string } })[];
  lastActivity: { createdAt: string; activityType: string } | null;
}

export interface AdminPaymentRow {
  id: string;
  amount: Money;
  status: BillingPaymentRow['status'];
  gatewayOrderId: string;
  gatewayPaymentId: string | null;
  verifiedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  plan: { code: string };
  business: { id: string; name: string };
}
