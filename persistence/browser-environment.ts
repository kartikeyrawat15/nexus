export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface StorageChange { key: string | null; newValue: string | null }
export interface BrowserEnvironment {
  storage: StorageAdapter | null;
  subscribe(listener: (event: StorageChange) => void): () => void;
}

/** Called at initialization only; module evaluation never touches browser APIs. */
export function browserEnvironment(): BrowserEnvironment {
  if (typeof window === "undefined") return { storage: null, subscribe: () => () => undefined };
  const storage = window.localStorage; // Access itself may throw (privacy/security restrictions).
  return {
    storage,
    subscribe(listener) {
      const handler = (event: StorageEvent) => {
        if (event.storageArea === storage) listener({ key: event.key, newValue: event.newValue });
      };
      window.addEventListener("storage", handler);
      return () => window.removeEventListener("storage", handler);
    },
  };
}
