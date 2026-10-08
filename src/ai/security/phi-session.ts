/*
 * Per-request PHI masking. Kept free of framework/DB imports so it is trivially unit-testable.
 */
const DROP_KEYS = new Set(['phone', 'dob', 'telecom', 'passwordHash']);

/**
 * Per-request PHI shield. Known patient names (loaded from the database), phones, e-mails and SSNs are replaced
 * by stable placeholders before any text or tool output reaches the cloud LLM, and restored in the answer.
 * Direct identifiers that the model never needs (phone, DOB) are dropped from tool output entirely.
 *
 * Limitation: masking is dictionary + pattern based. A brand-new name typed free-text for the first time
 * (e.g. while registering a patient) cannot be recognised. Use a BAA-covered or self-hosted model for strict HIPAA.
 */
export class PhiSession {
  private readonly forward = new Map<string, string>(); // original(lowercase) -> placeholder
  private readonly reverse = new Map<string, string>(); // placeholder -> original
  private counters: Record<string, number> = {};
  private readonly names: RegExp | null;

  constructor(knownNames: string[]) {
    const unique = [
      ...new Set(knownNames.map((n) => n.trim()).filter((n) => n.length >= 3)),
    ].sort((a, b) => b.length - a.length);
    this.names = unique.length
      ? new RegExp(`\\b(?:${unique.map(escapeRegex).join('|')})\\b`, 'gi')
      : null;
  }

  get active(): boolean {
    return this.reverse.size > 0;
  }

  private placeholder(kind: string, original: string): string {
    const key = `${kind}:${original.toLowerCase()}`;
    const existing = this.forward.get(key);
    if (existing) return existing;
    const n = (this.counters[kind] = (this.counters[kind] ?? 0) + 1);
    const ph = `[${kind}_${n}]`;
    this.forward.set(key, ph);
    this.reverse.set(ph, original);
    return ph;
  }

  mask(text: string): string {
    let out = text;
    if (this.names)
      out = out.replace(this.names, (m) => this.placeholder('PATIENT', m));
    out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, (m) =>
      this.placeholder('SSN', m),
    );
    out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, (m) =>
      this.placeholder('EMAIL', m),
    );
    out = out.replace(
      /(?<![\w-])\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?![\w-])/g,
      (m) => this.placeholder('PHONE', m),
    );
    return out;
  }

  restore(text: string): string {
    let out = text;
    for (const [ph, original] of this.reverse)
      out = out.split(ph).join(original);
    return out;
  }

  /** Deep-masks every string and drops identifier fields (phone, dob, ...). */
  maskDeep<T>(value: T): T {
    return this.walk(value, (s) => this.mask(s), true) as T;
  }

  /** Reverses placeholders in tool *inputs* chosen by the model so tools operate on real values. */
  unmaskDeep<T>(value: T): T {
    return this.walk(value, (s) => this.restore(s), false) as T;
  }

  private walk(
    v: unknown,
    f: (s: string) => string,
    dropKeys: boolean,
  ): unknown {
    if (typeof v === 'string') return f(v);
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map((x) => this.walk(x, f, dropKeys));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (dropKeys && DROP_KEYS.has(k)) continue;
        out[k] = this.walk(val, f, dropKeys);
      }
      return out;
    }
    return v;
  }
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
