import { useEffect } from "react";
import { scrubPersistedStores } from "../../lib/redactStorage";
import { getMigrationResult, subscribeMigration } from "../../lib/secretsMigration";
import { migrationNotice, SECRETS_NOTICE_SEEN_KEY } from "../../lib/secretsUi";
import { load, save } from "../../lib/storage";
import { useToast } from "./Toast";

let handled = false;

/** Shows the one-time "moved to your keychain" toast (or the failure one) and cleans up old plain copies. Renders nothing. */
export function SecretsNotice() {
  const toast = useToast();
  useEffect(() => {
    const run = () => {
      const result = getMigrationResult();
      if (!result || handled) return;
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
