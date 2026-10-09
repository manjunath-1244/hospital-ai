import { handlerKey } from './handler-key';
import { parseQuery } from './l1-parser';

const key = (q: string) =>
  handlerKey(parseQuery(q, { specialties: ['Cardiology', 'Neurology'] }));

describe('which handler answers a plan', () => {
  it.each([
    ['how many cardiologists are available today', 'count.specialists'],
    ['who are the specialists', 'list.specialists'],
    ['how many doctors do we have', 'count.staff'],
    ['how many beds are free', 'count.unsupported'],
    ['how many patients are waiting', 'count.overview'],
    ['who is waiting', 'list.waiting'],
    ['list all patients', 'list.patients'],
    ['which patients have chest pain', 'search.records'],
    ['give details about P1001', 'lookup.chart'],
    ['what is the discharge policy', 'policy.rag'],
    ['is a specialist required for P1002', 'review.referral'],
    ['refer P1002 to cardiology', 'action.agent'],
    ['yes, go ahead', 'pending.confirm'],
    ['thanks', 'smalltalk'],
    ['how many', 'clarify'],
  ])('%s -> %s', (q, expected) => expect(key(q)).toBe(expected));
});
