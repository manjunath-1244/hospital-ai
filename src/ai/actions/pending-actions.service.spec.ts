jest.mock('@nestjs/typeorm', () => ({ InjectRepository: () => () => {} }));
import { PendingActionsService } from './pending-actions.service';

const user = { userId: 'u1', userName: 'Dr', role: 'DOCTOR' } as any;
const act = (id: string, over: any = {}) => ({
  id,
  summary: `Referral ${id}`,
  tier: 'ASK',
  status: 'PENDING',
  createdAt: new Date(),
  ...over,
});

function make(pending: any[], exec: any = {}) {
  const repo: any = { find: jest.fn().mockResolvedValue(pending) };
  const executor: any = {
    approveAndExecute: jest.fn(async (id: string) => ({
      id,
      summary: `Referral ${id}`,
      status: 'DONE',
      verification: { checks: ['stored'] },
    })),
    decline: jest.fn(async () => undefined),
    ...exec,
  };
  return { svc: new PendingActionsService(repo, executor), executor };
}

describe('replies to pending proposals', () => {
  it('"yes" with nothing pending does nothing and says so', async () => {
    const { svc, executor } = make([]);
    const r = await svc.reply('CONFIRM', 'yes, go ahead', user, 't1');
    expect(r.text).toMatch(/Nothing is waiting/);
    expect(executor.approveAndExecute).not.toHaveBeenCalled();
  });
  it('"yes" with one pending proposal approves exactly that one and reports the real result', async () => {
    const { svc, executor } = make([act('ACTAAAAAAAA')]);
    const r = await svc.reply('CONFIRM', 'yes', user, 't1');
    expect(executor.approveAndExecute).toHaveBeenCalledWith(
      'ACTAAAAAAAA',
      user,
    );
    expect(r.text).toMatch(/^Done:/);
  });
  it('with several pending it asks which and executes nothing', async () => {
    const { svc, executor } = make([act('ACTAAAAAAAA'), act('ACTBBBBBBBB')]);
    const r = await svc.reply('CONFIRM', 'do it', user, 't1');
    expect(r.text).toMatch(/2 proposals are waiting/);
    expect(executor.approveAndExecute).not.toHaveBeenCalled();
  });
  it('an id in the message picks one of several', async () => {
    const { svc, executor } = make([act('ACTAAAAAAAA'), act('ACTBBBBBBBB')]);
    await svc.reply('CONFIRM', 'confirm ACTBBBBBBBB', user, 't1');
    expect(executor.approveAndExecute).toHaveBeenCalledWith(
      'ACTBBBBBBBB',
      user,
    );
  });
  it('an id that is not pending in this conversation is not executed', async () => {
    const { svc, executor } = make([act('ACTAAAAAAAA'), act('ACTBBBBBBBB')]);
    const r = await svc.reply('CONFIRM', 'confirm ACTZZZZZZZZ', user, 't1');
    expect(executor.approveAndExecute).not.toHaveBeenCalled();
    expect(r.text).toMatch(/Which one/);
  });
  it('a proposal that needs a written note is not approved by a "yes"', async () => {
    const { svc, executor } = make([act('ACTAAAAAAAA', { tier: 'ASK_HUMAN' })]);
    const r = await svc.reply('CONFIRM', 'yes', user, 't1');
    expect(executor.approveAndExecute).not.toHaveBeenCalled();
    expect(r.text).toMatch(/written reason/);
  });
  it('"no" declines the pending proposal and nothing else', async () => {
    const { svc, executor } = make([act('ACTAAAAAAAA')]);
    const r = await svc.reply('DECLINE', "don't do it", user, 't1');
    expect(executor.decline).toHaveBeenCalledWith(
      'ACTAAAAAAAA',
      user,
      expect.any(String),
    );
    expect(executor.approveAndExecute).not.toHaveBeenCalled();
    expect(r.text).toMatch(/Declined/);
  });
  it('a refused approval is reported honestly', async () => {
    const { svc } = make([act('ACTAAAAAAAA')], {
      approveAndExecute: jest
        .fn()
        .mockRejectedValue(new Error('Role NURSE is not authorized')),
    });
    const r = await svc.reply('CONFIRM', 'yes', user, 't1');
    expect(r.text).toMatch(/could not be done: Role NURSE/);
  });
  it('"ok" and "sure" are acknowledgements and never approve', async () => {
    const { svc, executor } = make([act('ACTAAAAAAAA')]);
    for (const m of ['ok', 'sure', 'correct']) {
      const r = await svc.reply('CONFIRM', m, user, 't1');
      expect(r.text).toMatch(/acknowledgement, not an approval/);
    }
    expect(executor.approveAndExecute).not.toHaveBeenCalled();
  });
  it('a proposal older than the window needs its id, not a bare "yes"', async () => {
    const old = act('ACTAAAAAAAA', {
      createdAt: new Date(Date.now() - 30 * 60_000),
    });
    const { svc, executor } = make([old]);
    const r = await svc.reply('CONFIRM', 'yes', user, 't1');
    expect(r.text).toMatch(/older than/);
    expect(executor.approveAndExecute).not.toHaveBeenCalled();
    await svc.reply('CONFIRM', 'confirm ACTAAAAAAAA', user, 't1');
    expect(executor.approveAndExecute).toHaveBeenCalledTimes(1);
  });
  it('a bare "no" can still decline an older proposal', async () => {
    const old = act('ACTAAAAAAAA', {
      createdAt: new Date(Date.now() - 30 * 60_000),
    });
    const { svc, executor } = make([old]);
    await svc.reply('DECLINE', 'no', user, 't1');
    expect(executor.decline).toHaveBeenCalled();
  });
});
