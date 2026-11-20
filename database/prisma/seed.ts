/**
 * Base seed — safe to run repeatedly in every environment (idempotent upserts).
 * Seeds: permission catalogue, system roles + matrix, subscription plans.
 * Demo data is NOT seeded here (separate guarded script, Phase 3).
 */
import 'dotenv/config';
import { ALL_PERMISSION_KEYS, PERMISSIONS, PLANS, SYSTEM_ROLES, SYSTEM_ROLE_KEYS, TRIAL_DAYS } from '@mandimitra/shared';
import { createPrismaClient } from '../src/index.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const prisma = createPrismaClient(url, { max: 2 });

async function main() {
  // Permissions
  for (const key of ALL_PERMISSION_KEYS) {
    const p = PERMISSIONS[key];
    await prisma.permission.upsert({
      where: { key },
      create: { key, module: p.module, description: p.description },
      update: { module: p.module, description: p.description },
    });
  }
  const permRows = await prisma.permission.findMany({ select: { id: true, key: true } });
  const permId = new Map(permRows.map((r) => [r.key, r.id]));

  // System roles (businessId = null). findFirst because NULLs are distinct in the compound unique.
  for (const key of SYSTEM_ROLE_KEYS) {
    const def = SYSTEM_ROLES[key];
    let role = await prisma.role.findFirst({ where: { businessId: null, key } });
    role = role
      ? await prisma.role.update({ where: { id: role.id }, data: { name: def.name, nameHindi: def.nameHindi } })
      : await prisma.role.create({ data: { key, name: def.name, nameHindi: def.nameHindi, isSystem: true } });

    // Re-sync matrix exactly (removes permissions dropped from the catalogue).
    const wanted = def.permissions.map((k) => permId.get(k)!).filter(Boolean);
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { notIn: wanted } } }),
      prisma.rolePermission.createMany({
        data: wanted.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      }),
    ]);
  }

  // Plans
  for (const plan of PLANS) {
    const data = {
      name: plan.name,
      nameHindi: plan.nameHindi,
      priceMonthly: plan.priceMonthly,
      trialDays: TRIAL_DAYS,
      maxStaffUsers: plan.maxStaffUsers,
      maxFarmers: plan.maxFarmers,
      maxMonthlyAiQueries: plan.maxMonthlyAiQueries,
      aiEnabled: plan.aiEnabled,
      whatsappEnabled: plan.whatsappEnabled,
      exportsEnabled: plan.exportsEnabled,
      sortOrder: plan.sortOrder,
    };
    await prisma.subscriptionPlan.upsert({ where: { code: plan.code }, create: { code: plan.code, ...data }, update: data });
  }

  const counts = {
    permissions: await prisma.permission.count(),
    systemRoles: await prisma.role.count({ where: { businessId: null } }),
    plans: await prisma.subscriptionPlan.count(),
  };
  console.log('Seed complete:', counts);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
