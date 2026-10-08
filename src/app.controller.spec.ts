import { AppController } from './app.controller';

describe('AppController', () => {
  it('reports ok when the database answers', async () => {
    const ds = { query: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    await expect(new AppController(ds as any).health()).resolves.toEqual({
      status: 'ok',
    });
  });

  it('rejects when the database is down', async () => {
    const ds = { query: jest.fn().mockRejectedValue(new Error('down')) };
    await expect(new AppController(ds as any).health()).rejects.toThrow('down');
  });
});
