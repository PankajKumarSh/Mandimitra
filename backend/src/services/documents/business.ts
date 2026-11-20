import type { PrismaClient } from '@mandimitra/database';
import type { DocBusiness } from './templates.ts';

export async function businessForDocs(prisma: PrismaClient, businessId: string): Promise<DocBusiness> {
  const b = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { name: true, nameHindi: true, mandiName: true, licenseNumber: true, gstin: true, addressLine: true, city: true, district: true, state: true, phone: true },
  });
  return b;
}

/** "2026-11-01 – 2026-11-20" → "01/11/2026 – 20/11/2026" */
export function rangeLabel(from: string | null | undefined, to: string | null | undefined, lang: 'hi' | 'en') {
  const f = (s: string) => s.split('-').reverse().join('/');
  if (from && to) return from === to ? f(from) : `${f(from)} – ${f(to)}`;
  if (from) return `${lang === 'hi' ? 'से' : 'from'} ${f(from)}`;
  if (to) return `${lang === 'hi' ? 'तक' : 'until'} ${f(to)}`;
  return lang === 'hi' ? 'सभी तारीखें' : 'All dates';
}
