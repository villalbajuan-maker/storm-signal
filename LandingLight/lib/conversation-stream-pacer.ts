export type ReadableStreamChunk = {
  chunk: string;
  rest: string;
  pauseMs: number;
};

const MIN_READABLE_CHARACTERS = 52;
const TARGET_MAX_CHARACTERS = 168;

function boundaryAt(buffer: string) {
  const candidates: Array<{ end: number; pauseMs: number }> = [];
  const paragraph = /\n{2,}/g;
  const sentence = /[.!?]["')\]]*(?:\s+|$)/g;
  const clause = /[;:](?:\s+|$)/g;

  for (const [pattern, pauseMs] of [[paragraph, 420], [sentence, 310], [clause, 230]] as const) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(buffer))) {
      const end = match.index + match[0].length;
      if (end >= MIN_READABLE_CHARACTERS) candidates.push({ end, pauseMs });
      if (end >= TARGET_MAX_CHARACTERS) break;
    }
  }

  const beforeTarget = candidates.filter((candidate) => candidate.end <= TARGET_MAX_CHARACTERS);
  if (beforeTarget.length) return beforeTarget.sort((a, b) => a.end - b.end)[0];
  if (candidates.length) return candidates.sort((a, b) => a.end - b.end)[0];
  if (buffer.length < TARGET_MAX_CHARACTERS) return null;

  const whitespace = buffer.lastIndexOf(" ", TARGET_MAX_CHARACTERS);
  return { end: whitespace >= MIN_READABLE_CHARACTERS ? whitespace + 1 : TARGET_MAX_CHARACTERS, pauseMs: 180 };
}

export function takeReadableStreamChunk(buffer: string, force = false): ReadableStreamChunk | null {
  if (!buffer) return null;
  const boundary = boundaryAt(buffer);
  if (!boundary) {
    if (!force) return null;
    return { chunk: buffer, rest: "", pauseMs: 0 };
  }
  return {
    chunk: buffer.slice(0, boundary.end),
    rest: buffer.slice(boundary.end),
    pauseMs: force && boundary.end === buffer.length ? 0 : boundary.pauseMs,
  };
}
