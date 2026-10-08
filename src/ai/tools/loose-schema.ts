import { z } from 'zod';

/**
 * Small/local models often send numbers as strings ("26", "91%", "39.2C"), booleans as "true", a single string where
 * a list is expected, or enum values in the wrong case. These helpers accept those unambiguous forms instead of
 * failing the whole tool call, while still validating ranges and allowed values strictly.
 */
const toNumber = (v: unknown) => {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return v;
  const m = v.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : v;
};

interface Bounds {
  min?: number;
  max?: number;
}
const bounded = (n: z.ZodNumber, b: Bounds) => {
  if (b.min !== undefined) n = n.min(b.min);
  if (b.max !== undefined) n = n.max(b.max);
  return n;
};
export const looseNumber = (b: Bounds = {}) =>
  z.preprocess(toNumber, bounded(z.number(), b));
export const looseInt = (b: Bounds = {}) =>
  z.preprocess(toNumber, bounded(z.number().int(), b));
export const looseBool = (defaultValue = false) =>
  z.preprocess(
    (v) =>
      v === null || v === undefined || v === ''
        ? defaultValue
        : typeof v === 'string'
          ? /^(true|yes|y|1)$/i.test(v.trim())
            ? true
            : /^(false|no|n|0)$/i.test(v.trim())
              ? false
              : v
          : v,
    z.boolean(),
  );

/** "Amoxicillin 500mg; Ibuprofen 400mg" or a single drug string becomes a list. */
export const looseStringList = (max = 30) =>
  z.preprocess(
    (v) =>
      typeof v === 'string'
        ? v
            .split(/[;\n]|,(?!\d)/)
            .map((s) => s.trim())
            .filter(Boolean)
        : v,
    z.array(z.string()).max(max),
  );

/** Case-insensitive enum with optional synonyms ("confused" -> CONFUSION). */
export const looseEnum = <T extends readonly [string, ...string[]]>(
  values: T,
  synonyms: Record<string, T[number]> = {},
) =>
  z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    const key = v.trim().toLowerCase();
    return synonyms[key] ?? values.find((x) => x.toLowerCase() === key) ?? v;
  }, z.enum(values));
