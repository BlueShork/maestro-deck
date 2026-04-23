import { create } from "zustand";

export type ToastVariant = "default" | "success" | "error";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  /** Controlled open state so Radix can run the exit animation. */
  open: boolean;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id" | "open">) => string;
  /** Trigger the exit animation; the toast is removed from the list when Radix
   *  signals it has finished closing via `setClosed`. */
  dismiss: (id: string) => void;
  setClosed: (id: string) => void;
}

// Time the slide-out animation needs to complete before the new toast slides
// in. Has to match Tailwind's `animate-out fade-out-0` default (~150ms).
const SWAP_DELAY_MS = 180;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = crypto.randomUUID();
    const existing = get().toasts.filter((x) => x.open);
    if (existing.length > 0) {
      // Start exit animation on the old one, then drop the new one in.
      set((s) => ({
        toasts: s.toasts.map((x) => (x.open ? { ...x, open: false } : x)),
      }));
      setTimeout(() => {
        set((s) => ({
          toasts: [
            ...s.toasts.filter((x) => x.open),
            { ...t, id, open: true },
          ],
        }));
      }, SWAP_DELAY_MS);
    } else {
      set((s) => ({ toasts: [...s.toasts, { ...t, id, open: true }] }));
    }
    return id;
  },
  dismiss: (id) =>
    set((s) => ({
      toasts: s.toasts.map((x) => (x.id === id ? { ...x, open: false } : x)),
    })),
  setClosed: (id) =>
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = {
  info: (title: string, description?: string) =>
    useToastStore.getState().push({ title, description, variant: "default" }),
  success: (title: string, description?: string) =>
    useToastStore.getState().push({ title, description, variant: "success" }),
  error: (title: string, description?: string) =>
    useToastStore.getState().push({ title, description, variant: "error" }),
};
