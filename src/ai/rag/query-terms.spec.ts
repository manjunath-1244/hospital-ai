import { meaningfulTerms, preferredDocTypes, toOrTsQuery } from './query-terms';
import {
  asDocType,
  embeddingText,
  firstHeading,
  parseFrontMatter,
} from './doc-meta';

describe('keyword query', () => {
  it('keeps the meaningful words and drops question filler', () => {
    expect(
      meaningfulTerms('urgent consultation request who handles it'),
    ).toEqual(['urgent', 'consultation', 'request', 'handles']);
  });
  it('matches ANY meaningful word, never requiring filler words', () => {
    expect(toOrTsQuery('Who handles an urgent consultation request?')).toBe(
      'handles | urgent | consultation | request',
    );
    expect(toOrTsQuery('what is it?')).toBe('');
  });
  it('produces only safe characters for the database', () => {
    expect(toOrTsQuery("drop table x; --'&|!()")).toBe('drop | table');
  });
});

describe('document type preference follows the SHAPE of the question', () => {
  it('ownership/process questions prefer policies and SOPs', () => {
    expect(
      preferredDocTypes('who handles an urgent consultation request'),
    ).toEqual(['policy', 'sop']);
    expect(
      preferredDocTypes('what is the process for escalating a critical lab'),
    ).toEqual(['policy', 'sop']);
  });
  it('criteria questions prefer guidelines', () => {
    expect(
      preferredDocTypes('what are the referral criteria for chest pain'),
    ).toEqual(['guideline']);
    expect(preferredDocTypes('when to refer to neurology')).toEqual([
      'guideline',
    ]);
  });
  it('mixed or neutral questions state no preference', () => {
    expect(preferredDocTypes('visiting hours')).toEqual([]);
    expect(preferredDocTypes('who decides the criteria for referral')).toEqual(
      [],
    );
  });
});

describe('document metadata', () => {
  it('reads and strips front matter', () => {
    const { meta, body } = parseFrontMatter(
      '---\ndocType: guideline\ntitle: Cardiology SOP\n---\n# Body\ntext',
    );
    expect(meta).toEqual({ docType: 'guideline', title: 'Cardiology SOP' });
    expect(body.startsWith('# Body')).toBe(true);
  });
  it('works without front matter and rejects unknown types', () => {
    expect(parseFrontMatter('# Plain').meta).toEqual({});
    expect(asDocType('SOP')).toBe('sop');
    expect(asDocType('nonsense')).toBe('policy');
  });
  it('uses the first heading as the title and embeds title, type and section with the content', () => {
    expect(
      firstHeading('# 📅 Hospital Appointment Policy\n## 1. Booking', 'f.md'),
    ).toBe('Hospital Appointment Policy');
    expect(
      embeddingText(
        { docType: 'policy', title: 'Appointments' },
        '1. Booking',
        '- urgent goes to triage',
      ),
    ).toBe('Appointments (policy) - 1. Booking\n- urgent goes to triage');
  });
});
