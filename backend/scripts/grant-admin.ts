/**
 * Grants or revokes platform Super Admin.  There is deliberately no API for this.
 *   npm run admin:grant -w @mandimitra/backend -- 9812345678
 *   npm run admin:grant -w @mandimitra/backend -- 9812345678 --revoke
 */
import { createPrismaClient } from '@mandimitra/database';
import { mobileSchema } from '@mandimitra/shared';

const [raw, flag] = process.argv.slice(2);
const parsed = mobileSchema.safeParse(raw ?? '');
if (!parsed.success) {
  console.error('Usage: admin:grant <10-digit mobile> [--revoke]');
  process.exit(1);
}
const prisma = createPrismaClient(process.env.DATABASE_URL!, { max: 1 });
const user = await prisma.user.findUnique({ where: { mobile: parsed.data } });
if (!user) {
  console.error(`No user with mobile ${parsed.data}. Register first, then grant.`);
  process.exit(1);
}
const isPlatformAdmin = flag !== '--revoke';
await prisma.user.update({ where: { id: user.id }, data: { isPlatformAdmin } });
console.log(`${user.fullName} (${parsed.data}) is ${isPlatformAdmin ? 'now' : 'no longer'} a platform admin.`);
await prisma.$disconnect();
