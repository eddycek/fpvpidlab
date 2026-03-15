/**
 * License key generation.
 *
 * Format: PIDLAB-XXXX-XXXX-XXXX
 * Alphabet: A-Z + 2-9, excluding ambiguous chars (0/O, 1/I/L)
 * 31 chars → 31^12 ≈ 7.9 × 10^17 entropy
 */

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Generate a random license key in PIDLAB-XXXX-XXXX-XXXX format.
 */
export function generateLicenseKey(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);

  let chars = '';
  for (let i = 0; i < 12; i++) {
    chars += ALPHABET[bytes[i] % ALPHABET.length];
  }

  return `PIDLAB-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

/** Regex for validating key format */
export const KEY_FORMAT_REGEX = /^PIDLAB-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;

/**
 * Validate that a string matches the PIDLAB-XXXX-XXXX-XXXX format.
 */
export function isValidKeyFormat(key: string): boolean {
  return KEY_FORMAT_REGEX.test(key);
}
