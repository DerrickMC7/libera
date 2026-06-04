import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { useArtistImageStore } from "../store/artistImageStore";
import { useToastStore } from "../store/toastStore";

const IS_DEMO = !("__TAURI_INTERNALS__" in window);

export function useArtistImageDownload() {
  const {
    isDownloading, isPaused, completed, total, currentArtist,
    startDownload, setProgress, finishDownload, setPaused,
  } = useArtistImageStore();
  const queryClient = useQueryClient();
  const { show: showToast } = useToastStore();

  useEffect(() => {
    if (IS_DEMO) return;
    const unlistens: Array<() => void> = [];

    listen<{ total: number }>("artist-images://started", (e) => {
      startDownload(e.payload.total);
    }).then((u) => unlistens.push(u));

    listen<{ completed: number; total: number; current: string }>(
      "artist-images://progress",
      (e) => setProgress(e.payload.completed, e.payload.total, e.payload.current)
    ).then((u) => unlistens.push(u));

    listen<{ artist: string }>("artist-images://cached", (e) => {
      queryClient.invalidateQueries({ queryKey: ["artist-image", e.payload.artist] });
      queryClient.invalidateQueries({ queryKey: ["artist-banner", e.payload.artist] });
    }).then((u) => unlistens.push(u));

    listen("artist-images://done", () => {
      finishDownload();
      queryClient.invalidateQueries({ queryKey: ["artist-image"] });
      queryClient.invalidateQueries({ queryKey: ["artist-banner"] });
    }).then((u) => unlistens.push(u));

    listen("artist-images://cancelled", () => {
      finishDownload();
      queryClient.invalidateQueries({ queryKey: ["artist-image"] });
      queryClient.invalidateQueries({ queryKey: ["artist-banner"] });
    }).then((u) => unlistens.push(u));

    return () => unlistens.forEach((u) => u());
  }, []);

  async function download() {
    if (IS_DEMO || isDownloading) return;
    startDownload(0);
    try {
      await invoke("fetch_artist_images");
    } catch (e) {
      console.error("fetch_artist_images failed:", e);
      finishDownload();
      showToast("Artist image download failed — check your connection");
    }
  }

  async function pause() {
    if (!isDownloading || isPaused) return;
    await invoke("pause_artist_image_download").catch(console.error);
    setPaused(true);
  }

  async function resume() {
    if (!isDownloading || !isPaused) return;
    await invoke("resume_artist_image_download").catch(console.error);
    setPaused(false);
  }

  async function cancel() {
    if (!isDownloading) return;
    await invoke("cancel_artist_image_download").catch(console.error);
    // finishDownload is called via the cancelled event listener
  }

  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return { isDownloading, isPaused, completed, total, percent, currentArtist, download, pause, resume, cancel };
}
