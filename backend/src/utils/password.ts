import { hash, verify } from '@node-rs/argon2';

// argon2id (library default) with OWASP baseline parameters.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(passwordHash, plain);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;
/** Burn equivalent CPU when the user doesn't exist, so response time doesn't reveal registered mobiles. */
export async function verifyAgainstDummy(plain: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalisation');
  await verifyPassword(await dummyHash, plain);
}
