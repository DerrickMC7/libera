export interface LrcLine {
  time: number;
  text: string;
}

export function parseLrc(lrc: string): LrcLine[] {
  const lines: LrcLine[] = [];
  for (const raw of lrc.split("\n")) {
    const match = raw.match(/^\[(\d{1,2}):(\d{2})[.:](\d{1,3})\](.*)/);
    if (!match) continue;
    const mins = parseInt(match[1]);
    const secs = parseInt(match[2]);
    const frac = parseInt(match[3].padEnd(3, "0"));
    const text = match[4].trim();
    if (!text) continue;
    lines.push({ time: mins * 60 + secs + frac / 1000, text });
  }
  return lines.sort((a, b) => a.time - b.time);
}
