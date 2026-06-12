import { describe, it, expect, beforeEach } from "vitest";
import { usePlayerStore } from "../store/playerStore";
import type { Track } from "../types/track";

function makeTrack(id: number, overrides: Partial<Track> = {}): Track {
  return {
    path: `/music/track${id}.mp3`,
    title: `Track ${id}`,
    artist: "Artist",
    album_artist: "Artist",
    album: "Album",
    genre: "",
    duration_secs: 180,
    track_number: id,
    track_total: null,
    disc_number: 1,
    disc_total: null,
    year: 2024,
    bitrate: null,
    sample_rate: null,
    channels: null,
    file_size: 1024 * 1024,
    mbid: null,
    replay_gain_track: null,
    replay_gain_album: null,
    artwork_path: null,
    ...overrides,
  };
}

const tracks = [makeTrack(1), makeTrack(2), makeTrack(3), makeTrack(4), makeTrack(5)];

beforeEach(() => {
  // Reset store state between tests
  usePlayerStore.setState({
    currentTrack: null,
    isPlaying: false,
    volume: 0.25,
    isMuted: false,
    queue: [],
    queueIndex: 0,
    shuffle: false,
    repeat: "off",
    shuffledQueue: [],
    manualQueuePaths: [],
  });
});

describe("setQueue", () => {
  it("sets the queue and current track", () => {
    usePlayerStore.getState().setQueue(tracks, 0);
    const s = usePlayerStore.getState();
    expect(s.queue).toEqual(tracks);
    expect(s.currentTrack).toEqual(tracks[0]);
    expect(s.queueIndex).toBe(0);
  });

  it("sets current track from given startIndex", () => {
    usePlayerStore.getState().setQueue(tracks, 2);
    expect(usePlayerStore.getState().currentTrack).toEqual(tracks[2]);
  });

  it("clears manual queue paths", () => {
    usePlayerStore.setState({ manualQueuePaths: ["/music/track1.mp3"] });
    usePlayerStore.getState().setQueue(tracks, 0);
    expect(usePlayerStore.getState().manualQueuePaths).toHaveLength(0);
  });
});

describe("nextTrack", () => {
  beforeEach(() => usePlayerStore.getState().setQueue(tracks, 0));

  it("advances to next track", () => {
    usePlayerStore.getState().nextTrack();
    expect(usePlayerStore.getState().currentTrack).toEqual(tracks[1]);
    expect(usePlayerStore.getState().queueIndex).toBe(1);
  });

  it("stops playback at end when repeat=off", () => {
    usePlayerStore.getState().setQueue(tracks, 4);
    usePlayerStore.setState({ isPlaying: true });
    usePlayerStore.getState().nextTrack();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it("loops to start when repeat=all", () => {
    usePlayerStore.getState().setQueue(tracks, 4);
    usePlayerStore.setState({ repeat: "all" });
    usePlayerStore.getState().nextTrack();
    expect(usePlayerStore.getState().queueIndex).toBe(0);
    expect(usePlayerStore.getState().currentTrack).toEqual(tracks[0]);
  });

  it("stays on same track when repeat=one", () => {
    usePlayerStore.getState().nextTrack();
    usePlayerStore.setState({ repeat: "one" });
    // Re-set queue to ensure queueIndex=0
    usePlayerStore.getState().setQueue(tracks, 0);
    usePlayerStore.setState({ repeat: "one" });
    usePlayerStore.getState().nextTrack();
    expect(usePlayerStore.getState().queueIndex).toBe(0);
    expect(usePlayerStore.getState().currentTrack?.path).toBe(tracks[0].path);
  });
});

describe("previousTrack", () => {
  beforeEach(() => usePlayerStore.getState().setQueue(tracks, 2));

  it("goes to previous track", () => {
    usePlayerStore.getState().previousTrack();
    expect(usePlayerStore.getState().queueIndex).toBe(1);
    expect(usePlayerStore.getState().currentTrack).toEqual(tracks[1]);
  });

  it("does nothing at start of queue", () => {
    usePlayerStore.getState().setQueue(tracks, 0);
    usePlayerStore.getState().previousTrack();
    expect(usePlayerStore.getState().queueIndex).toBe(0);
  });
});

describe("toggleRepeat", () => {
  it("cycles off → all → one → off", () => {
    const store = usePlayerStore.getState();
    expect(usePlayerStore.getState().repeat).toBe("off");
    store.toggleRepeat();
    expect(usePlayerStore.getState().repeat).toBe("all");
    store.toggleRepeat();
    expect(usePlayerStore.getState().repeat).toBe("one");
    store.toggleRepeat();
    expect(usePlayerStore.getState().repeat).toBe("off");
  });
});

describe("toggleShuffle", () => {
  it("enables shuffle and creates shuffledQueue", () => {
    usePlayerStore.getState().setQueue(tracks, 0);
    usePlayerStore.getState().toggleShuffle();
    const s = usePlayerStore.getState();
    expect(s.shuffle).toBe(true);
    expect(s.shuffledQueue).toHaveLength(tracks.length);
    // First item must stay in place (currently playing)
    expect(s.shuffledQueue[0]).toEqual(tracks[0]);
  });

  it("disables shuffle and restores original queue order", () => {
    usePlayerStore.getState().setQueue(tracks, 0);
    usePlayerStore.getState().toggleShuffle();
    usePlayerStore.getState().toggleShuffle();
    const s = usePlayerStore.getState();
    expect(s.shuffle).toBe(false);
    expect(s.shuffledQueue).toEqual(tracks);
  });
});

describe("addToQueue", () => {
  beforeEach(() => usePlayerStore.getState().setQueue(tracks, 0));

  it("appends a track after all current manual entries", () => {
    const extra = makeTrack(99);
    usePlayerStore.getState().addToQueue(extra);
    const s = usePlayerStore.getState();
    expect(s.manualQueuePaths).toContain(extra.path);
    // The track should appear somewhere after queueIndex
    const insertedIdx = s.queue.findIndex((t) => t.path === extra.path);
    expect(insertedIdx).toBeGreaterThan(0);
  });
});

describe("playNext", () => {
  beforeEach(() => usePlayerStore.getState().setQueue(tracks, 0));

  it("inserts a track right after current", () => {
    const extra = makeTrack(99);
    usePlayerStore.getState().playNext(extra);
    const s = usePlayerStore.getState();
    expect(s.queue[1].path).toBe(extra.path);
    expect(s.manualQueuePaths).toContain(extra.path);
  });

  it("removes the first system copy of the same track", () => {
    // Track 2 is already in the queue as a system copy
    usePlayerStore.getState().playNext(tracks[1]);
    const s = usePlayerStore.getState();
    const count = s.queue.filter((t) => t.path === tracks[1].path).length;
    // Still exactly one occurrence
    expect(count).toBe(1);
    // And it's now at position 1
    expect(s.queue[1].path).toBe(tracks[1].path);
  });
});

describe("toggleMute", () => {
  it("toggles muted state", () => {
    expect(usePlayerStore.getState().isMuted).toBe(false);
    usePlayerStore.getState().toggleMute();
    expect(usePlayerStore.getState().isMuted).toBe(true);
    usePlayerStore.getState().toggleMute();
    expect(usePlayerStore.getState().isMuted).toBe(false);
  });
});
