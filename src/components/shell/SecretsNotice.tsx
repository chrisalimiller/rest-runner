import { useEffect } from "react";
import { scrubOncePerLaunch, scrubPersistedStores } from "../../lib/redactStorage";
import { getMigrationResult, subscribeMigration } from "../../lib/secretsMigration";
import { migrationNotice, SECRETS_NOTICE_SEEN_KEY } from "../../lib/secretsUi";
import { status } from "../../lib/secretStore";
import { load, save } from "../../lib/storage";
import { useToast } from "./Toast";

let handled = false;

/** Shows the one-time "moved to your keychain" toast (or the failure one) and cleans up old plain copies. Renders nothing. */
export function SecretsNotice() {
  const toast = useToast();
  useEffect(() => {
    // Old plain copies of secrets can outlive a migration, so clean once per launch whenever the keychain is in use.
    scrubOncePerLaunch();
    const run = () => {
      const result = getMigrationResult();
      if (!result || handled) return;
      // No keychain in browser mode: nothing was moved, so never say it was.
      if (status() === "browser-fallback") {
        handled = true;
        return;
      }
      const notice = migrationNotice(result, load<boolean>(SECRETS_NOTICE_SEEN_KEY, false) === true);
      handled = true;
      if (!notice) return;
      if (notice.message) toast.show({ message: notice.message });
      if (notice.markSeen) save(SECRETS_NOTICE_SEEN_KEY, true);
      if (notice.scrub) void scrubPersistedStores().catch(() => {});
    };
    run();
    return subscribeMigration(run);
  }, [toast]);
  return null;
}
