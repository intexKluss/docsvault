// largest middle section (old lines * new lines) that gets an exact diff.
// above that the whole middle counts as replaced, which keeps memory bounded.
const MAX_DIFF_CELLS = 4_000_000;
const CONTEXT_LINES = 3;

export function diffLines(oldText, newText) {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++;
  }

  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  const ops = [];
  for (let i = 0; i < start; i++) ops.push({ type: ' ', line: oldLines[i] });

  const oldMiddle = oldLines.slice(start, oldEnd);
  const newMiddle = newLines.slice(start, newEnd);
  for (const op of diffMiddle(oldMiddle, newMiddle)) ops.push(op);

  for (let i = oldEnd; i < oldLines.length; i++) ops.push({ type: ' ', line: oldLines[i] });
  return ops;
}

// compact unified style output: hunk headers start with '@@', other lines
// start with ' ', '+' or '-'. stops after maxLines and reports it.
export function buildHunks(ops, maxLines) {
  const changed = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type !== ' ') changed.push(i);
  }

  const result = { lines: [], additions: 0, deletions: 0, truncated: false };
  for (const op of ops) {
    if (op.type === '+') result.additions++;
    if (op.type === '-') result.deletions++;
  }
  if (changed.length === 0) return result;

  let oldNumber = 1;
  let newNumber = 1;
  const oldNumbers = [];
  const newNumbers = [];
  for (const op of ops) {
    oldNumbers.push(oldNumber);
    newNumbers.push(newNumber);
    if (op.type !== '+') oldNumber++;
    if (op.type !== '-') newNumber++;
  }

  let index = 0;
  while (index < changed.length) {
    const hunkStart = Math.max(0, changed[index] - CONTEXT_LINES);
    let hunkEnd = Math.min(ops.length - 1, changed[index] + CONTEXT_LINES);
    index++;
    while (index < changed.length && changed[index] - CONTEXT_LINES <= hunkEnd + 1) {
      hunkEnd = Math.min(ops.length - 1, changed[index] + CONTEXT_LINES);
      index++;
    }

    if (result.lines.length + (hunkEnd - hunkStart + 2) > maxLines) {
      result.truncated = true;
      return result;
    }

    result.lines.push(`@@ -${oldNumbers[hunkStart]} +${newNumbers[hunkStart]} @@`);
    for (let i = hunkStart; i <= hunkEnd; i++) {
      result.lines.push(ops[i].type + ops[i].line);
    }
  }
  return result;
}

function splitLines(text) {
  if (text === '') return [];
  return text.split(/\r?\n/);
}

function diffMiddle(oldLines, newLines) {
  const ops = [];
  if (oldLines.length === 0 || newLines.length === 0 || oldLines.length * newLines.length > MAX_DIFF_CELLS) {
    for (const line of oldLines) ops.push({ type: '-', line });
    for (const line of newLines) ops.push({ type: '+', line });
    return ops;
  }

  // lcs[i][j] = length of the common subsequence of oldLines[i..] and newLines[j..]
  const width = newLines.length + 1;
  const lcs = new Uint32Array((oldLines.length + 1) * width);
  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = newLines.length - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        lcs[i * width + j] = lcs[(i + 1) * width + j + 1] + 1;
      } else {
        lcs[i * width + j] = Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
      }
    }
  }

  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: ' ', line: oldLines[i] });
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      ops.push({ type: '-', line: oldLines[i] });
      i++;
    } else {
      ops.push({ type: '+', line: newLines[j] });
      j++;
    }
  }
  while (i < oldLines.length) ops.push({ type: '-', line: oldLines[i++] });
  while (j < newLines.length) ops.push({ type: '+', line: newLines[j++] });
  return ops;
}
