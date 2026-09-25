// src/ui/cowriter/diff.ts
// Word-level diff for the Tweak card: what the change removes and adds. Longest common subsequence over words and gaps.
export type DiffPart = { op: 'eq' | 'del' | 'ins'; text: string };

export function wordDiff(a: string, b: string): DiffPart[] {
  const A = a.split(/(\s+)/).filter((x) => x !== '');
  const B = b.split(/(\s+)/).filter((x) => x !== '');
  const L = Array.from({ length: A.length + 1 }, () => new Array<number>(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i]![j] = A[i] === B[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const out: DiffPart[] = [];
  const push = (op: DiffPart['op'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) push('eq', A[i++]!), j++;
    else if (L[i + 1]![j]! >= L[i]![j + 1]!) push('del', A[i++]!);
    else push('ins', B[j++]!);
  }
  while (i < A.length) push('del', A[i++]!);
  while (j < B.length) push('ins', B[j++]!);
  return out;
}
