import { missingActionDetails } from './action-slots';

describe('missing details of a change request', () => {
  it.each([
    ['Book an appointment', false, /Which patient is the appointment for/],
    ['refer him to cardiology', false, /Which patient is the referral for/],
    ['order a CBC', false, /Which patient is the lab order for/],
    ['schedule a follow-up', false, /Which patient is the follow-up plan for/],
    [
      'write a prescription',
      false,
      /Which patient is the consultation note for/,
    ],
  ])('%s with nobody named asks which patient', (msg, known, re) => {
    expect(missingActionDetails(msg, known)).toMatch(re);
  });
  it('does not ask when the patient is known', () => {
    expect(
      missingActionDetails('Book an appointment for P1001', true),
    ).toBeNull();
  });
  it('a task or notification needs no patient', () => {
    expect(
      missingActionDetails('remind the nurse to restock gloves', false),
    ).toBeNull();
  });
  it('asks for exactly the registration details that are missing', () => {
    const q = missingActionDetails('register a new patient John Smith', false)!;
    expect(q).toMatch(/gender/);
    expect(q).toMatch(/phone number/);
    expect(q).toMatch(/blood type/);
    expect(q).not.toMatch(/name/);
  });
  it('a complete registration request is not interrupted', () => {
    expect(
      missingActionDetails(
        'register a new patient John Smith, 40, male, phone 5551234567, blood type O+',
        false,
      ),
    ).toBeNull();
  });
});
