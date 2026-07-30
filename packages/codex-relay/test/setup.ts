import { vi } from "vitest";

const stores = new Map<string, Map<string, string>>();

vi.mock("react-native-mmkv", () => ({
  createMMKV(options?: { id?: string }) {
    const id = options?.id ?? "default";
    let store = stores.get(id);
    if (!store) {
      store = new Map();
      stores.set(id, store);
    }

    return {
      getString(key: string) {
        return store.get(key);
      },
      remove(key: string) {
        store.delete(key);
      },
      set(key: string, value: string) {
        store.set(key, value);
      },
    };
  },
}));
