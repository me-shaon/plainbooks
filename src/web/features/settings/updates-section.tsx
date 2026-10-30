import { ExternalLink } from "lucide-react";
import { Section } from "../../components/ui/section";
import { Switch } from "../../components/ui/switch";
import { useSetUpdateCheck, useUpdateStatus } from "./queries";

const UPDATING_GUIDE = "https://github.com/me-shaon/plainbooks/blob/main/docs/updating.md";

function formatCheckedAt(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function ExternalAnchor({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 underline underline-offset-2"
    >
      {children}
      <ExternalLink className="size-3" aria-hidden="true" />
    </a>
  );
}

/** The running version, the newest release, and the daily check switch. Owner only. */
export function UpdatesSection() {
  const status = useUpdateStatus(true);
  const setCheck = useSetUpdateCheck();
  if (!status.data) return null;
  const data = status.data;

  let summary: string;
  if (!data.enabled) summary = "The update check is off.";
  else if (data.checkedAt === null) summary = "The first check runs within a day.";
  else if (data.updateAvailable) summary = `Version ${data.latestVersion} is available.`;
  else summary = "This is the newest version.";

  return (
    <Section title="Updates" description={`This app runs version ${data.currentVersion}.`}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 text-sm text-ink">
          <p className="m-0" role="status">
            {summary}
            {data.enabled && data.checkedAt !== null
              ? ` Last check: ${formatCheckedAt(data.checkedAt)}.`
              : null}
          </p>
          {data.updateAvailable && data.releaseUrl ? (
            <p className="m-0 flex flex-wrap gap-x-4 gap-y-1">
              <ExternalAnchor href={data.releaseUrl}>What changed</ExternalAnchor>
              <ExternalAnchor href={UPDATING_GUIDE}>How to update</ExternalAnchor>
            </p>
          ) : null}
        </div>
        <Switch
          isSelected={data.enabled}
          isDisabled={setCheck.isPending}
          onChange={(enabled) => setCheck.mutate({ enabled })}
          description="Once a day, the app asks GitHub for the newest release. It sends no workspace data."
        >
          Check for new versions
        </Switch>
      </div>
    </Section>
  );
}
