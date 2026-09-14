export interface Anchor {
  index: number;
  line: number;
}

export interface ScrollWindow {
  start: number;
  end: number;
  viewTop: number;
}

export function visibleWindow(
  heights: readonly (number | undefined)[],
  anchor: Anchor | null,
  regionHeight: number,
): ScrollWindow {
  const count = heights.length;
  if (count === 0) return { start: 0, end: -1, viewTop: 0 };
  if (anchor === null) {
    let start = count - 1;
    let rows = heights[start] ?? 0;
    while (start > 0 && rows < regionHeight) {
      start--;
      rows += heights[start] ?? 0;
    }
    return { start, end: count - 1, viewTop: 0 };
  }
  const index = Math.min(Math.max(0, anchor.index), count - 1);
  const line = Math.max(0, anchor.line);
  const start = index > 0 ? index - 1 : index;
  let end = index;
  let rows = Math.max(0, (heights[index] ?? 0) - line);
  while (end < count - 1 && rows < regionHeight) {
    end++;
    rows += heights[end] ?? 0;
  }
  return { start, end, viewTop: (start < index ? heights[index - 1] ?? 0 : 0) + line };
}

export function anchorAt(heights: readonly (number | undefined)[], start: number, row: number): Anchor {
  let index = Math.min(Math.max(0, start), Math.max(0, heights.length - 1));
  let left = Math.max(0, row);
  while (index < heights.length - 1) {
    const height = heights[index] ?? 0;
    if (left < height) break;
    left -= height;
    index++;
  }
  return { index, line: Math.max(0, left) };
}

export function scrollUp(heights: readonly (number | undefined)[], from: Anchor, lines: number): Anchor {
  let index = from.index;
  let line = from.line;
  let left = lines;
  while (left > 0) {
    if (line > 0) {
      const step = Math.min(line, left);
      line -= step;
      left -= step;
      continue;
    }
    if (index === 0) break;
    const height = heights[index - 1];
    if (height === undefined) break;
    index--;
    if (height === 0) continue;
    line = height - 1;
    left--;
  }
  return { index, line };
}

export function scrollDown(
  heights: readonly (number | undefined)[],
  from: Anchor,
  lines: number,
  regionHeight: number,
): Anchor | null {
  let index = from.index;
  let line = from.line;
  let left = lines;
  let clamped = false;
  while (left > 0 && index < heights.length) {
    const height = heights[index];
    if (height === undefined) {
      clamped = true;
      break;
    }
    if (line + left < height) {
      line += left;
      left = 0;
      break;
    }
    left -= height - line;
    index++;
    line = 0;
  }
  if (index >= heights.length) return null;
  if (clamped) return { index, line };
  let rows = 0;
  for (let i = index; i < heights.length && rows < regionHeight; i++) {
    rows += Math.max(0, (heights[i] ?? 0) - (i === index ? line : 0));
  }
  return rows < regionHeight ? null : { index, line };
}
