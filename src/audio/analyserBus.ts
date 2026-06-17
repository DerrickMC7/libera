// Shared handle to the live Web Audio AnalyserNode.
//
// The analyser is created inside useAudioPlayer (which only mounts in <AudioPlayer>),
// but other visualizers — e.g. the genre map's now-playing pulse — need to read its
// frequency data too. A module-level singleton lets them poll it from their own rAF
// without prop-threading through the tree or storing a non-serializable node in a
// store (which would trigger re-renders). Consumers read it per-frame; a null result
// just means audio isn't wired up yet.
let analyser: AnalyserNode | null = null;

export function setSharedAnalyser(a: AnalyserNode | null): void {
  analyser = a;
}

export function getSharedAnalyser(): AnalyserNode | null {
  return analyser;
}
