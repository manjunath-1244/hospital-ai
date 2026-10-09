jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => {},
}));
import { ActionExecutorService } from './action-executor.service';

const user = { userId: 'u1', userName: 'Dr', role: 'DOCTOR' } as any;

function make(affected: number, current: any) {
  const row = {
    id: 'ACTAAAAAAAA',
    type: 'LAB_ORDER',
    tier: 'ASK',
    status: 'PENDING',
    proposedByUserId: 'u1',
    expiresAt: new Date(Date.now() + 60_000),
    payload: {},
  };
  const repo: any = {
    findOne: jest
      .fn()
      .mockResolvedValueOnce({ ...row })
      .mockResolvedValue(current),
    update: jest.fn().mockResolvedValue({ affected }),
    save: jest.fn(async (e) => e),
  };
  const lifecycle: any = {};
  const svc = new ActionExecutorService(
    repo,
    lifecycle,
    {} as any,
    {} as any,
    {} as any,
    { emitActionDecided: jest.fn(), emitActionExecuted: jest.fn() } as any,
    {} as any,
    { create: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { svc, repo };
}

describe('approval is atomic', () => {
  it('the loser of a simultaneous approval never runs the executor', async () => {
    const { svc, repo } = make(0, { status: 'EXECUTING' });
    await expect(svc.approveAndExecute('ACTAAAAAAAA', user)).rejects.toThrow(
      /already being handled/,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });
  it('a double click that lands after completion returns the finished result', async () => {
    const { svc } = make(0, { status: 'DONE', id: 'ACTAAAAAAAA' });
    const r = await svc.approveAndExecute('ACTAAAAAAAA', user);
    expect(r.status).toBe('DONE');
  });
  it('a decline cannot overwrite an action that was approved in the meantime', async () => {
    const { svc } = make(0, { status: 'EXECUTING' });
    await expect(svc.decline('ACTAAAAAAAA', user)).rejects.toThrow(
      /already decided/,
    );
  });
});

describe('consultation signing', () => {
  it('only the proposing clinician can approve a consultation', async () => {
    const row = {
      id: 'ACTCCCCCCCC',
      type: 'CONSULTATION',
      tier: 'ASK_HUMAN',
      status: 'PENDING',
      proposedByUserId: 'u1',
      expiresAt: new Date(Date.now() + 60_000),
      payload: {},
    };
    const repo: any = {
      findOne: jest.fn().mockResolvedValue(row),
      update: jest.fn(),
      save: jest.fn(),
    };
    const svc = new ActionExecutorService(
      repo,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    await expect(
      svc.approveAndExecute(
        'ACTCCCCCCCC',
        { userId: 'admin', userName: 'A', role: 'ADMIN' } as any,
        'override reason',
      ),
    ).rejects.toThrow(/proposed it/);
    expect(repo.update).not.toHaveBeenCalled();
  });
});
