/**
 * Missing details of a change request, found by rules before any model runs ("Book an appointment" with nobody named
 * must produce a question at once, not a minutes-long model attempt). Only details that are certainly absent are asked
 * for; doctor, time, test and similar are collected by the propose tools, which know the real options.
 */
type Kind = { label: string; needsPatient: boolean };

const KINDS: Array<[RegExp, Kind]> = [
  [/\bfollow[- ]?up\b/i, { label: 'follow-up plan', needsPatient: true }],
  [
    /\b(?:appointment|appt)\b|\b(?:book|schedule|reschedule)\b/i,
    { label: 'appointment', needsPatient: true },
  ],
  [/\brefer(?:ral)?\b/i, { label: 'referral', needsPatient: true }],
  [
    /\b(?:lab|test|blood work|cbc|ecg|x-?ray|scan|mri|ct)\b/i,
    { label: 'lab order', needsPatient: true },
  ],
  [
    /\b(?:prescri\w+|consultation|diagnos\w+)\b/i,
    { label: 'consultation note', needsPatient: true },
  ],
  [
    /\b(?:discharge|close the visit|complete the visit)\b/i,
    { label: 'visit change', needsPatient: true },
  ],
];

const REGISTRATION = /\b(?:register|admit|enrol(?:l)?)\b|\bnew patient\b/i;

export function missingActionDetails(
  message: string,
  patientKnown: boolean,
): string | null {
  const text = message.trim();
  if (REGISTRATION.test(text)) {
    const missing: string[] = [];
    if (!/\b(?:male|female|man|woman|boy|girl|other)\b/i.test(text))
      missing.push('gender');
    if (
      !/\b\d{1,3}\s*(?:y(?:ears?)?|yo|y\/o|year)?\b|\bdob\b|\bborn\b|\d{4}-\d{2}-\d{2}/i.test(
        text.replace(/\d{7,}/g, ''),
      )
    )
      missing.push('age or date of birth');
    if (!/\d{7,}/.test(text.replace(/[\s-]/g, '')))
      missing.push('phone number');
    if (
      !/\b(?:A|B|AB|O)\s?[+-]|\b(?:A|B|AB|O)\s+(?:positive|negative)\b/i.test(
        text,
      )
    )
      missing.push('blood type');
    if (
      !/\b(?:patient|register|admit|enrol\w*)\s+(?:a\s+|the\s+)?(?:new\s+)?(?:patient\s+)?(?:named\s+|called\s+)?[A-Z][a-z]+/.test(
        text,
      )
    )
      missing.push("the patient's name");
    return missing.length
      ? `To register a new patient I still need: ${missing.join(', ')}. Please send them and I will prepare the registration for your approval.`
      : null;
  }
  if (patientKnown) return null;
  const kind = KINDS.find(([re]) => re.test(text))?.[1];
  if (kind?.needsPatient)
    return `Which patient is the ${kind.label} for? Tell me the patient's name or ID (for example "P1001").`;
  return null;
}
