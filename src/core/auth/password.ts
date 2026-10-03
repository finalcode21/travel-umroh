import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = bcrypt.genSaltSync(SALT_ROUNDS);
  const hash = bcrypt.hashSync(password, salt);
  return { hash, salt };
}

/** bcrypt embeds the salt inside the hash string, so only the hash is needed. */
export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}
