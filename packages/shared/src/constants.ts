/** Subscription plans. Prices in INR. Limits are initial assumptions (PRD A10); DB is authoritative at runtime. */
export const PLANS = [
  {
    code: 'STARTER',
    name: 'Starter',
    nameHindi: 'स्टार्टर',
    priceMonthly: '499.00',
    maxStaffUsers: 1,
    maxFarmers: 500,
    maxMonthlyAiQueries: 0,
    aiEnabled: false,
    whatsappEnabled: false,
    exportsEnabled: true,
    sortOrder: 1,
  },
  {
    code: 'PROFESSIONAL',
    name: 'Professional',
    nameHindi: 'प्रोफेशनल',
    priceMonthly: '799.00',
    maxStaffUsers: 5,
    maxFarmers: 3000,
    maxMonthlyAiQueries: 300,
    aiEnabled: true,
    whatsappEnabled: true,
    exportsEnabled: true,
    sortOrder: 2,
  },
  {
    code: 'BUSINESS',
    name: 'Business',
    nameHindi: 'बिज़नेस',
    priceMonthly: '1499.00',
    maxStaffUsers: null,
    maxFarmers: null,
    maxMonthlyAiQueries: 1500,
    aiEnabled: true,
    whatsappEnabled: true,
    exportsEnabled: true,
    sortOrder: 3,
  },
] as const;

export type PlanCode = (typeof PLANS)[number]['code'];
export const TRIAL_PLAN_CODE: PlanCode = 'PROFESSIONAL';
export const TRIAL_DAYS = 14;

/** Created for every new business. No commission rules are seeded — rates are never assumed. */
export const DEFAULT_COMMODITIES = [
  { name: 'Wheat', nameHindi: 'गेहूं' },
  { name: 'Paddy', nameHindi: 'धान' },
  { name: 'Rice', nameHindi: 'चावल' },
  { name: 'Mustard', nameHindi: 'सरसों' },
  { name: 'Maize', nameHindi: 'मक्का' },
  { name: 'Potato', nameHindi: 'आलू' },
  { name: 'Onion', nameHindi: 'प्याज' },
] as const;

export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: 'Labour', nameHindi: 'मजदूरी' },
  { name: 'Transportation', nameHindi: 'भाड़ा / परिवहन' },
  { name: 'Electricity', nameHindi: 'बिजली' },
  { name: 'Rent', nameHindi: 'किराया' },
  { name: 'Loading/Unloading', nameHindi: 'लदाई / उतराई' },
  { name: 'Office Expenses', nameHindi: 'कार्यालय खर्च' },
  { name: 'Miscellaneous', nameHindi: 'विविध' },
] as const;

export const AUTH = {
  MAX_FAILED_LOGINS: 5,
  LOCKOUT_MINUTES: 15,
  REFRESH_REUSE_GRACE_MS: 20_000,
  INVITE_TTL_DAYS: 7,
  CSRF_HEADER: 'x-requested-with',
  CSRF_HEADER_VALUE: 'mandimitra',
  ACCESS_COOKIE: 'mm_at',
  REFRESH_COOKIE: 'mm_rt',
} as const;
