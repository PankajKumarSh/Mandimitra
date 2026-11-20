/**
 * DEVELOPMENT-ONLY demo data. Goes through the real services (codes, ledger postings, audit) —
 * nothing is inserted behind the business logic's back. Refuses to run in production.
 *
 *   npm run seed:demo -w @mandimitra/backend
 */
import { createPrismaClient } from '@mandimitra/database';
import { ALL_PERMISSION_KEYS, createBuyerSchema, createFarmerSchema } from '@mandimitra/shared';
import { loadEnv } from '../src/config/env.ts';
import type { TenantContext } from '../src/middleware/tenant.ts';
import { TenantCache } from '../src/middleware/tenant.ts';
import { forTenant } from '../src/repositories/tenant.ts';
import { AuthService } from '../src/services/auth.service.ts';
import { BuyerService } from '../src/services/buyer.service.ts';
import { FarmerService } from '../src/services/farmer.service.ts';
import { FieldCipher } from '../src/utils/field-crypto.ts';
import { TokenSigner } from '../src/utils/jwt.ts';

const env = loadEnv();
if (env.isProd) {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}

const DEMO_MOBILE = '+919999900001';
const DEMO_PASSWORD = 'Demo@2026';
const prisma = createPrismaClient(env.DATABASE_URL, { max: 2 });
const ctx = { ip: '127.0.0.1', userAgent: 'seed-demo', requestId: 'seed-demo' };

const FARMERS: [string, string, string, string, string?][] = [
  // name, Hindi, father, village, opening balance
  ['Ram Kumar', 'राम कुमार', 'Shiv Lal', 'Gharaunda', '18500'],
  ['Suresh Yadav', 'सुरेश यादव', 'Hari Singh', 'Assandh'],
  ['Baljeet Singh', 'बलजीत सिंह', 'Gurdev Singh', 'Nilokheri', '-5000'],
  ['Mahender Pal', 'महेंद्र पाल', 'Ram Pal', 'Indri', '42300.50'],
  ['Rajbir Jaglan', 'राजबीर जगलान', 'Om Prakash', 'Taraori'],
  ['Satpal Malik', 'सतपाल मलिक', 'Dharam Singh', 'Nissing', '-12000'],
  ['Jagdish Chand', 'जगदीश चंद', 'Lekh Ram', 'Gharaunda', '7600'],
  ['Kuldeep Saini', 'कुलदीप सैनी', 'Mange Ram', 'Assandh'],
  ['Pawan Kumar', 'पवन कुमार', 'Rattan Lal', 'Indri', '2150'],
  ['Gurpreet Singh', 'गुरप्रीत सिंह', 'Joginder Singh', 'Nilokheri'],
  ['Naresh Kashyap', 'नरेश कश्यप', 'Bhim Sen', 'Taraori', '-3500'],
  ['Dinesh Rana', 'दिनेश राणा', 'Ishwar Singh', 'Nissing', '9900'],
  ['Anil Chauhan', 'अनिल चौहान', 'Sukhbir Singh', 'Gharaunda'],
  ['Vikram Dhull', 'विक्रम ढुल', 'Raj Singh', 'Assandh', '26750'],
  ['Harpal Singh', 'हरपाल सिंह', 'Karnail Singh', 'Indri'],
  ['Sunil Bhardwaj', 'सुनील भारद्वाज', 'Ved Prakash', 'Taraori', '-800'],
];

const BUYERS: [string, string, string, string?, string?][] = [
  // firm, owner, city, opening receivable, credit limit
  ['Bansal Rice Mills', 'Ashok Bansal', 'Karnal', '185000', '250000'],
  ['Goyal Trading Co.', 'Rakesh Goyal', 'Panipat', '62000', '50000'],
  ['Shree Balaji Agro', 'Manoj Gupta', 'Karnal'],
  ['Mittal Flour Mill', 'Sanjay Mittal', 'Kurukshetra', '94500.75', '150000'],
  ['Aggarwal Brothers', 'Vinod Aggarwal', 'Ambala'],
  ['Garg Oil Mill', 'Pradeep Garg', 'Kaithal', '38000'],
  ['Singla Traders', 'Rohit Singla', 'Karnal', '-4000'],
];

async function main() {
  if (await prisma.user.findUnique({ where: { mobile: DEMO_MOBILE } })) {
    console.log(`Demo account already exists. Log in with ${DEMO_MOBILE.slice(3)} / ${DEMO_PASSWORD}`);
    return;
  }
  const auth = new AuthService(prisma, env, new TokenSigner(env.JWT_ACCESS_SECRET, 900), new TenantCache(0));
  const { user, businessId } = await auth.register(
    {
      fullName: 'Demo Aadhati',
      mobile: DEMO_MOBILE,
      password: DEMO_PASSWORD,
      preferredLanguage: 'HI',
      business: { name: 'Shri Krishna Trading Co.', nameHindi: 'श्री कृष्णा ट्रेडिंग कंपनी', mandiName: 'Karnal Anaj Mandi', district: 'Karnal', state: 'Haryana' },
    },
    ctx,
  );

  const tenant: TenantContext = {
    businessId,
    membershipId: '',
    roleKey: 'OWNER',
    isOwner: true,
    permissions: new Set(ALL_PERMISSION_KEYS),
    subscription: null,
    db: forTenant(prisma, businessId),
  };
  const farmers = new FarmerService(prisma, new FieldCipher(env.FIELD_ENCRYPTION_KEY));
  const buyers = new BuyerService(prisma);

  for (const [name, nameHindi, fatherName, village, opening] of FARMERS) {
    const input = createFarmerSchema.parse({ name, nameHindi, fatherName, village, district: 'Karnal', state: 'Haryana', ...(opening ? { openingBalance: opening } : {}) });
    await farmers.create(tenant, user.id, input, ctx);
  }
  for (const [firmName, ownerName, city, opening, limit] of BUYERS) {
    const input = createBuyerSchema.parse({ firmName, ownerName, city, ...(opening ? { openingBalance: opening } : {}), ...(limit ? { creditLimit: limit } : {}) });
    await buyers.create(tenant, user.id, input, ctx);
  }

  console.log(`Demo business created: ${FARMERS.length} farmers, ${BUYERS.length} buyers.`);
  console.log(`Log in at http://localhost:3000/login with mobile ${DEMO_MOBILE.slice(3)} and password ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
