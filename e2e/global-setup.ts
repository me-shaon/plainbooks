import { request } from "@playwright/test";
import { E2E_OWNER, E2E_SETUP_TOKEN, E2E_STORAGE_STATE, e2eBaseUrl } from "./env";

/**
 * Creates the first Owner on the `main` server through the setup API. The response sets
 * the session cookie, which goes into the storage state that the smoke spec uses.
 */
export default async function globalSetup(): Promise<void> {
  const api = await request.newContext({ baseURL: e2eBaseUrl("main") });
  try {
    const res = await api.post("/api/setup/owner", {
      data: { token: E2E_SETUP_TOKEN, ...E2E_OWNER },
    });
    if (res.status() !== 201) {
      throw new Error(`Setup failed with ${res.status()}: ${await res.text()}`);
    }
    await api.storageState({ path: E2E_STORAGE_STATE });
  } finally {
    await api.dispose();
  }
}
