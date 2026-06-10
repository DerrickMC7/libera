import { usePhotoStore } from "../store/photoStore";

let isDragSelecting = false;
let dragAddMode = true;
let dragStartPath: string | null = null;
let lastDragPath: string | null = null;
let didDrag = false;
let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let suppressNextClick = false;
let pointerDownPos: { x: number; y: number } | null = null;
// Desktop only: mouse held outside selection mode, waiting for threshold to start drag.
let pendingMouseDrag = false;

/** Safety-net read by card click handlers. */
export function didDragOccur(): boolean {
  return didDrag;
}

export function onCardPointerDown(e: PointerEvent, path: string) {
  if (e.pointerType === "mouse" && e.button !== 0) return;

  pointerDownPos = { x: e.clientX, y: e.clientY };
  didDrag = false;
  suppressNextClick = false;
  pendingMouseDrag = false;

  const store = usePhotoStore.getState();
  dragAddMode = !store.selectedPaths.has(path);
  dragStartPath = path;
  lastDragPath = path;

  if (store.selectionMode) {
    isDragSelecting = true;

    if (!e.shiftKey) {
      // Toggle immediately → instant visual feedback.
      // Suppress the click that follows so it doesn't double-toggle.
      store.toggleSelect(path);
      suppressNextClick = true;
    }
    // Shift+click: let the click handler call onShiftSelect — don't pre-toggle.
  } else if (e.pointerType === "mouse") {
    // Desktop: arm pending drag; promote to full drag-select when pointer moves > threshold.
    pendingMouseDrag = true;
  } else {
    // Touch/pen: long press enters selection mode.
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      suppressNextClick = true;
      isDragSelecting = true;
      dragAddMode = true;
      didDrag = false;
      usePhotoStore.getState().startSelection(path);
    }, 500);
  }
}

export function onDocumentPointerMove(e: PointerEvent) {
  // Cancel long press if finger moved too far before the threshold.
  if (longPressTimer && pointerDownPos) {
    if (Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y) > 8) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  // Desktop hold-drag: promote to drag-select once threshold crossed.
  if (pendingMouseDrag && pointerDownPos) {
    if (Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y) > 8) {
      pendingMouseDrag = false;
      isDragSelecting = true;
      const s = usePhotoStore.getState();
      if (!s.selectionMode) {
        // startSelection selects the starting card for us.
        s.startSelection(dragStartPath!);
      }
    }
  }

  if (!isDragSelecting) return;
  e.preventDefault(); // block scroll while drag-selecting

  const el = document.elementFromPoint(e.clientX, e.clientY);
  const card = el?.closest("[data-photo-path]") as HTMLElement | null;
  const path = card?.dataset.photoPath;
  if (!path || path === lastDragPath) return;

  // First move to a different card: commit the starting card if not already handled.
  if (!didDrag && dragStartPath) {
    didDrag = true;
    const s = usePhotoStore.getState();
    // Pre-toggle in onCardPointerDown already handled it; only act if it wasn't.
    if (dragAddMode && !s.selectedPaths.has(dragStartPath)) {
      s.toggleSelect(dragStartPath);
    } else if (!dragAddMode && s.selectedPaths.has(dragStartPath)) {
      s.toggleSelect(dragStartPath);
    }
  }

  lastDragPath = path;
  const s = usePhotoStore.getState();
  if (dragAddMode && !s.selectedPaths.has(path)) {
    s.toggleSelect(path);
  } else if (!dragAddMode && s.selectedPaths.has(path)) {
    s.toggleSelect(path);
  }
}

export function onDocumentPointerUp() {
  // Suppress the touch click that fires after a real drag.
  if (didDrag) suppressNextClick = true;

  isDragSelecting = false;
  pendingMouseDrag = false;
  dragStartPath = null;
  lastDragPath = null;
  pointerDownPos = null;
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

/** Capture-phase handler — runs BEFORE any card onClick.
 *  Must NOT reset didDrag here; it is reset at the next onCardPointerDown. */
export function onDocumentClickCapture(e: MouseEvent) {
  if (suppressNextClick || didDrag) {
    suppressNextClick = false;
    e.stopPropagation();
    e.preventDefault();
  }
}
