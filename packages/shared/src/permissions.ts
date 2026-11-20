/**
 * Permission catalogue + system role matrix.
 * Single source of truth: seeded into the DB, enforced by backend middleware,
 * read by the frontend only to hide controls.
 */

export const PERMISSIONS = {
  'business:read': { module: 'business', description: 'View business profile and settings' },
  'business:manage': { module: 'business', description: 'Edit business profile' },
  'settings:manage': { module: 'business', description: 'Edit settings, commission rules, commodities' },

  'staff:read': { module: 'staff', description: 'View staff and login history' },
  'staff:manage': { module: 'staff', description: 'Invite, change role, deactivate staff' },
  'audit:read': { module: 'staff', description: 'View audit log' },

  'farmer:read': { module: 'farmer', description: 'View farmers' },
  'farmer:create': { module: 'farmer', description: 'Add farmers' },
  'farmer:update': { module: 'farmer', description: 'Edit farmers' },
  'farmer:delete': { module: 'farmer', description: 'Delete (archive) farmers' },
  'farmer:bank': { module: 'farmer', description: 'View/edit farmer bank details' },

  'buyer:read': { module: 'buyer', description: 'View buyers' },
  'buyer:create': { module: 'buyer', description: 'Add buyers' },
  'buyer:update': { module: 'buyer', description: 'Edit buyers' },
  'buyer:delete': { module: 'buyer', description: 'Delete (archive) buyers' },

  'commodity:read': { module: 'commodity', description: 'View commodities' },
  'commodity:manage': { module: 'commodity', description: 'Add/edit commodities and grades' },

  'lot:read': { module: 'lot', description: 'View lots' },
  'lot:create': { module: 'lot', description: 'Create and confirm lots' },
  'lot:update': { module: 'lot', description: 'Edit draft lots' },
  'lot:cancel': { module: 'lot', description: 'Cancel lots directly' },

  'purchase:read': { module: 'purchase', description: 'View purchases' },
  'purchase:create': { module: 'purchase', description: 'Record purchases' },
  'purchase:cancel': { module: 'purchase', description: 'Cancel purchases directly' },

  'sale:read': { module: 'sale', description: 'View sales' },
  'sale:create': { module: 'sale', description: 'Record sales' },
  'sale:cancel': { module: 'sale', description: 'Cancel sales directly' },

  'patti:read': { module: 'patti', description: 'View patti' },
  'patti:create': { module: 'patti', description: 'Create and finalize patti' },
  'patti:cancel': { module: 'patti', description: 'Cancel finalized patti directly' },

  'ledger:read': { module: 'ledger', description: 'View farmer and buyer ledgers' },
  'ledger:adjust': { module: 'ledger', description: 'Post manual ledger adjustments' },

  'payment:read': { module: 'payment', description: 'View payments' },
  'payment:create': { module: 'payment', description: 'Record payments' },
  'payment:cancel': { module: 'payment', description: 'Cancel payments directly' },

  'expense:read': { module: 'expense', description: 'View expenses' },
  'expense:create': { module: 'expense', description: 'Record expenses' },
  'expense:cancel': { module: 'expense', description: 'Cancel expenses directly' },

  'report:read': { module: 'report', description: 'View reports and dashboard' },
  'report:export': { module: 'report', description: 'Export reports (PDF/Excel)' },

  'approval:request': { module: 'approval', description: 'Request cancellations/corrections' },
  'approval:decide': { module: 'approval', description: 'Approve or reject requests' },

  'ai:query': { module: 'ai', description: 'Ask the AI assistant' },
  'ai:draft': { module: 'ai', description: 'Create AI transaction drafts' },

  'whatsapp:send': { module: 'whatsapp', description: 'Send WhatsApp messages' },

  'subscription:read': { module: 'subscription', description: 'View subscription' },
  'subscription:manage': { module: 'subscription', description: 'Change plan and pay' },
} as const satisfies Record<string, { module: string; description: string }>;

export type PermissionKey = keyof typeof PERMISSIONS;
export const ALL_PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export const SYSTEM_ROLE_KEYS = ['OWNER', 'MUNIM', 'VIEWER'] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

const READ_ONLY: PermissionKey[] = [
  'business:read',
  'farmer:read',
  'buyer:read',
  'commodity:read',
  'lot:read',
  'purchase:read',
  'sale:read',
  'patti:read',
  'ledger:read',
  'payment:read',
  'expense:read',
  'report:read',
  'ai:query',
];

const MUNIM: PermissionKey[] = [
  ...READ_ONLY,
  'farmer:create',
  'farmer:update',
  'buyer:create',
  'buyer:update',
  'lot:create',
  'lot:update',
  'purchase:create',
  'sale:create',
  'patti:create',
  'payment:create',
  'expense:create',
  'report:export',
  'approval:request',
  'ai:draft',
  'whatsapp:send',
  'subscription:read',
];

export const SYSTEM_ROLES: Record<
  SystemRoleKey,
  { name: string; nameHindi: string; permissions: readonly PermissionKey[] }
> = {
  OWNER: { name: 'Owner', nameHindi: 'मालिक', permissions: ALL_PERMISSION_KEYS },
  MUNIM: { name: 'Munim / Accountant', nameHindi: 'मुनीम', permissions: MUNIM },
  VIEWER: { name: 'Read-only Staff', nameHindi: 'केवल देखने वाला', permissions: READ_ONLY },
};

/** Roles an owner may assign through invites / role changes. OWNER is never assignable. */
export const ASSIGNABLE_ROLE_KEYS = ['MUNIM', 'VIEWER'] as const;
