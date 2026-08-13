import { vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testStateDir = mkdtempSync(join(tmpdir(), "codex-relay-test-state-"));
process.env.CODEX_RELAY_SESSION_SOURCE_PATH = join(testStateDir, "session-source");
process.env.CODEX_RELAY_DESKTOP_STATE_PATH = join(testStateDir, "desktop-state.json");

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
