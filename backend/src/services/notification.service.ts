import type { TenantContext } from '../middleware/tenant.ts';
import { Errors } from '../utils/errors.ts';

/** In-app notifications for the current user in the current business. */
export class NotificationService {
  async list(t: TenantContext, userId: string, unreadOnly: boolean) {
    const [items, unread] = await Promise.all([
      t.db.notification.findMany({ where: { userId, ...(unreadOnly ? { readAt: null } : {}) }, orderBy: { createdAt: 'desc' }, take: 50 }),
      t.db.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, unread };
  }

  async markRead(t: TenantContext, userId: string, id: string) {
    const r = await t.db.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
    if (r.count === 0 && !(await t.db.notification.count({ where: { id, userId } }))) throw Errors.notFound();
  }

  async markAllRead(t: TenantContext, userId: string) {
    const r = await t.db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { updated: r.count };
  }
}
