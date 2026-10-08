import { randomBytes } from 'crypto';

// 32 symbols, no 0/O/1/I/L: unbiased (256 % 32 === 0) and unambiguous when read aloud.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789_';

/** Collision-resistant, human-friendly id, e.g. `P7K2M9XQ`. */
export function newId(prefix: string, length = 8): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % 32].replace('_', 'Z');
  return `${prefix}${out}`;
}
