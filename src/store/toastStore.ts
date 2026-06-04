import { create } from "zustand";

interface ToastState {
  message: string;
  visible: boolean;
  show: (message: string) => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export const useToastStore = create<ToastState>((set) => ({
  message: "",
  visible: false,
  show: (message) => {
    if (timer) { clearTimeout(timer); timer = null; }
    set({ message, visible: true });
    timer = setTimeout(() => set({ visible: false }), 2200);
  },
}));
