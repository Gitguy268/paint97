// Tiny external store: framework-free core, React binding via useSyncExternalStore.
import { useSyncExternalStore } from "react";

export type Store<T> = {
  get(): T;
  set(next: T | ((s: T) => T)): void;
  subscribe(fn: () => void): () => void;
};

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      const v = typeof next === "function" ? (next as (s: T) => T)(state) : next;
      if (Object.is(v, state)) return;
      state = v;
      subs.forEach((fn) => fn());
    },
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
  };
}

/** The selector must return a stable value (primitive or a slice of state). */
export const useStore = <T, S>(store: Store<T>, select: (s: T) => S): S =>
  useSyncExternalStore(store.subscribe, () => select(store.get()));
