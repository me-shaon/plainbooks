import { useQuery } from "@tanstack/react-query";
import { setupStatusQuery } from "../../lib/setup";

const APP_URL_HELP =
  "https://github.com/me-shaon/plainbooks/blob/main/docs/setup.md#app_url-does-not-match-the-address";

/**
 * Shows when APP_URL is not this page's origin. The app then refuses every change from the
 * browser, so setup and sign-in cannot work until the Owner fixes APP_URL.
 */
export function AppUrlWarning() {
  const status = useQuery(setupStatusQuery);
  const mismatch = status.data?.appUrlMismatch;
  if (!mismatch) return null;
  return (
    <div
      role="alert"
      className="m-0 flex flex-col gap-1 rounded-button bg-danger-tint px-3 py-2.5 text-[13px] text-danger-tint-foreground"
    >
      <p className="m-0">
        <code>APP_URL</code> is{" "}
        <strong className="break-all">{mismatch.configured || "not set"}</strong>, but this page is
        at <strong className="break-all">{mismatch.actual}</strong>. The app refuses changes until
        they match.
      </p>
      <p className="m-0">
        Set the <code>APP_URL</code> variable in <code>wrangler.jsonc</code> of your repository to{" "}
        <strong className="break-all">{mismatch.actual}</strong>, then deploy again.{" "}
        <a
          href={APP_URL_HELP}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          Read the steps
        </a>
      </p>
    </div>
  );
}
