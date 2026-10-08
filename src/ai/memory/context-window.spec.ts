import { selectWindow } from './context-window';

const m = (n: number, len = 40) =>
  Array.from({ length: n }, (_, i) => ({
    role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
    content: `${i}`.padEnd(len, 'x'),
  }));

describe('selectWindow', () => {
  it('keeps everything when it fits', () => {
    const r = selectWindow(m(4), 1000);
    expect(r.older).toHaveLength(0);
    expect(r.recent).toHaveLength(4);
  });
  it('moves the oldest messages out when over budget, preserving order', () => {
    const msgs = m(10, 100); // ~29 tokens each
    const r = selectWindow(msgs, 100);
    expect(r.recent.length).toBeLessThan(10);
    expect(r.older.length + r.recent.length).toBe(10);
    expect(r.recent[r.recent.length - 1]).toBe(msgs[9]);
    expect(r.older[0]).toBe(msgs[0]);
  });
  it('never drops the last minKeep messages even if they alone exceed the budget', () => {
    expect(selectWindow(m(5, 4000), 10).recent).toHaveLength(2);
  });
});
