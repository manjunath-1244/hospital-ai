export interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * Keeps the newest messages that fit `budgetTokens` (always at least the last `minKeep`),
 * returning the rest as `older` (candidates for summarisation). Chronological order is preserved.
 */
export function selectWindow<T extends Msg>(
  messages: T[],
  budgetTokens: number,
  minKeep = 2,
): { older: T[]; recent: T[] } {
  let used = 0;
  let start = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = estimateTokens(messages[i].content) + 4;
    const kept = messages.length - i;
    if (used + cost > budgetTokens && kept > minKeep) break;
    used += cost;
    start = i;
  }
  return { older: messages.slice(0, start), recent: messages.slice(start) };
}
