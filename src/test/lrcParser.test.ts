import { describe, it, expect } from "vitest";
import { parseLrc } from "../utils/lrcParser";

describe("parseLrc", () => {
  it("parses a simple LRC file", () => {
    const lrc = `[00:01.00]Hello world\n[00:05.50]Second line`;
    const lines = parseLrc(lrc);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ time: 1.0, text: "Hello world" });
    expect(lines[1]).toEqual({ time: 5.5, text: "Second line" });
  });

  it("sorts lines by time", () => {
    const lrc = `[00:10.00]Third\n[00:02.00]First\n[00:05.00]Second`;
    const lines = parseLrc(lrc);
    expect(lines[0].text).toBe("First");
    expect(lines[1].text).toBe("Second");
    expect(lines[2].text).toBe("Third");
  });

  it("skips lines without text", () => {
    const lrc = `[00:01.00]\n[00:02.00]  \n[00:03.00]Real line`;
    const lines = parseLrc(lrc);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("Real line");
  });

  it("handles centisecond fractions", () => {
    const lrc = `[01:23.45]Centiseconds`;
    const lines = parseLrc(lrc);
    expect(lines[0].time).toBeCloseTo(60 + 23 + 0.45, 2);
  });

  it("handles millisecond fractions (3 digits)", () => {
    const lrc = `[00:01.500]Half second`;
    const lines = parseLrc(lrc);
    expect(lines[0].time).toBeCloseTo(1.5, 3);
  });

  it("handles colon as fractional separator", () => {
    // [mm:ss:frac] — "50" is padEnd'd to "500" → 500ms → 0.5s
    const lrc = `[00:01:50]Colon separator`;
    const lines = parseLrc(lrc);
    expect(lines[0].time).toBeCloseTo(1.5, 3);
  });

  it("ignores metadata tags like [ar:Artist]", () => {
    const lrc = `[ar:Test Artist]\n[ti:Test Song]\n[00:01.00]Lyric`;
    const lines = parseLrc(lrc);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("Lyric");
  });

  it("returns empty array for empty input", () => {
    expect(parseLrc("")).toHaveLength(0);
  });

  it("handles multi-minute timestamps", () => {
    const lrc = `[10:05.20]Long song`;
    const lines = parseLrc(lrc);
    expect(lines[0].time).toBeCloseTo(10 * 60 + 5.2, 2);
  });

  it("trims whitespace from text", () => {
    const lrc = `[00:01.00]   padded text   `;
    const lines = parseLrc(lrc);
    expect(lines[0].text).toBe("padded text");
  });
});
