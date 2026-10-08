/** Deterministic text for a referral review: the rules' verdict, shown exactly (no model can reword the evidence). */
export function renderReferralReview(patientLabel: string, r: any): string {
  const out: string[] = [];
  if (r.recommendation === 'SPECIALIST' && r.specialty) {
    out.push(
      `Recommendation for ${patientLabel}: refer to ${r.specialty}${r.urgency ? ` (${String(r.urgency).toLowerCase()})` : ''}.`,
    );
  } else if (r.recommendation === 'NEEDS_DOCTOR_REVIEW') {
    out.push(
      `Recommendation for ${patientLabel}: needs doctor review before deciding on a specialist.`,
    );
  } else {
    out.push(
      `Recommendation for ${patientLabel}: no specialist referral is indicated by the current visit data.`,
    );
  }
  for (const line of r.rationale ?? []) out.push(`• ${line}`);
  if (r.evidence?.length) {
    out.push('Evidence from this patient:');
    for (const e of r.evidence)
      out.push(`  - ${e.field}: ${e.value} (${e.source})`);
  }
  if (r.verification && r.verification.verified === false)
    out.push(
      `Note: some evidence could not be verified against the record (${r.verification.reason ?? 'see details'}).`,
    );
  if (r.missingInfo?.length)
    out.push(`Missing information: ${r.missingInfo.join('; ')}.`);
  if (r.historicalOnlyCandidates?.length)
    out.push(
      `Past history only (not a reason to refer now): ${r.historicalOnlyCandidates.join(', ')}.`,
    );
  out.push('Decision support only: the doctor decides.');
  if (r.recommendation === 'SPECIALIST' && r.specialty)
    out.push(
      `To refer, say "refer ${patientLabel} to ${r.specialty}" and I will prepare a proposal for your approval. Nothing is created until you approve it.`,
    );
  return out.join('\n');
}
