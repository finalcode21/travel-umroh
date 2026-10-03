import { ulid } from "ulid";

export function secureRandomToken(bytes = 32): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateSessionToken(): string {
  return secureRandomToken(48);
}

/** Random token suffixed with a ULID so resets are time-orderable and unique. */
export function generatePasswordResetToken(): string {
  return `${secureRandomToken(64)}${ulid()}`;
}