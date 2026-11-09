import { invoke } from "@tauri-apps/api/core";

/** The five keychain operations (`secrets_*` commands in src-tauri). */
export interface SecretBackend {
  /** Rejects with a message when the keychain is locked, denied or unavailable. */
  available(): Promise<void>;
  /** JSON object mapping variable id to secret value, or null when nothing is stored. */
  readEnv(envId: string): Promise<string | null>;
  writeEnv(envId: string, json: string): Promise<void>;
  deleteEnv(envId: string): Promise<void>;
  listEnvs(): Promise<string[]>;
}

export const nativeBackend: SecretBackend = {
  available: () => invoke<void>("secrets_available"),
  readEnv: (envId) => invoke<string | null>("secrets_read_env", { envId }),
  writeEnv: (envId, json) => invoke<void>("secrets_write_env", { envId, json }),
  deleteEnv: (envId) => invoke<void>("secrets_delete_env", { envId }),
  listEnvs: () => invoke<string[]>("secrets_list_envs"),
};

export interface FakeBackend extends SecretBackend {
  /** envId -> stored JSON. */
  data: Map<string, string>;
  failReads: boolean;
  failWrites: boolean;
  /** Rejects `available()` with this message when set. */
  unavailable: string | null;
  /** Successful write and delete calls, in order. */
  writes: { op: "write" | "delete"; envId: string; json?: string }[];
}

/** An in-memory backend for tests. The failure flags can be flipped at any time. */
export function createFakeBackend(opts: { failReads?: boolean; failWrites?: boolean } = {}): FakeBackend {
  const b: FakeBackend = {
    data: new Map(),
    failReads: opts.failReads ?? false,
    failWrites: opts.failWrites ?? false,
    unavailable: null,
    writes: [],
    async available() {
      if (b.unavailable !== null) throw b.unavailable;
    },
    async readEnv(envId) {
      if (b.failReads) throw "read failed";
      return b.data.get(envId) ?? null;
    },
    async writeEnv(envId, json) {
      if (b.failWrites) throw "write failed";
      b.data.set(envId, json);
      b.writes.push({ op: "write", envId, json });
    },
    async deleteEnv(envId) {
      if (b.failWrites) throw "delete failed";
      b.data.delete(envId);
      b.writes.push({ op: "delete", envId });
    },
    async listEnvs() {
      if (b.failReads) throw "list failed";
      return [...b.data.keys()];
    },
  };
  return b;
}
