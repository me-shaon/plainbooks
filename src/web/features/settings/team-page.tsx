import { Copy, Ellipsis, Plus, Users } from "lucide-react";
import { useState } from "react";
import { Form } from "react-aria-components";
import type { UserRole } from "../../../shared/domain";
import { USER_ROLES } from "../../../shared/domain";
import {
  type MemberLink,
  type MemberState,
  type TeamMember,
  teamMemberInput,
} from "../../../shared/schemas/settings";
import { Button } from "../../components/ui/button";
import { AlertDialog, Dialog, Modal } from "../../components/ui/dialog";
import { EmptyState } from "../../components/ui/empty-state";
import { ListBoxItem } from "../../components/ui/list-box";
import { Menu, MenuItem, MenuTrigger } from "../../components/ui/menu";
import { Section } from "../../components/ui/section";
import { Select } from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { Cell, Column, Row, Table, TableBody, TableHeader } from "../../components/ui/table";
import { TextField } from "../../components/ui/text-field";
import { toast } from "../../components/ui/toast";
import { cn } from "../../components/ui/utils";
import { issuesByPath, toastError } from "../../lib/api";
import { type FieldErrors, fieldError, validate } from "../../lib/form";
import { useMe } from "../../lib/session";
import {
  useAddMember,
  useRemoveMember,
  useResendInvite,
  useResetSignIn,
  useSetMemberRole,
  useTeam,
} from "./queries";

const ROLE_LABELS: Record<UserRole, string> = { owner: "Owner", member: "Member" };

const STATE_STYLES: Record<MemberState, string> = {
  active: "bg-pill-paid text-pill-paid-foreground",
  invited: "bg-pill-sent text-pill-sent-foreground",
  expired: "bg-pill-expired text-pill-expired-foreground",
  reset_pending: "bg-pill-partially-paid text-pill-partially-paid-foreground",
};

/** "Oct 27, 2026, 3:04 PM" in the viewer's time zone. */
export function formatLinkExpiry(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** The state label, with the link expiry when a link is open. */
export function stateLabel(member: TeamMember, now = Date.now()): string {
  const expires = member.linkExpiresAt;
  switch (member.state) {
    case "invited":
      return expires ? `Invited, expires ${formatLinkExpiry(expires)}` : "Invited";
    case "expired":
      return "Invite expired";
    case "reset_pending":
      return expires && expires <= now ? "Reset link expired" : "Reset pending";
    default:
      return "Active";
  }
}

function StateBadge({ member }: { member: TeamMember }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-[9px] py-[3px] text-xs leading-[1.4] font-medium",
        STATE_STYLES[member.state],
      )}
    >
      {stateLabel(member)}
    </span>
  );
}

type Pending =
  | { action: "remove"; member: TeamMember }
  | { action: "reset"; member: TeamMember }
  | null;

export function TeamPage() {
  const { me, isOwner, isPending } = useMe();
  const team = useTeam(isOwner);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [shownLink, setShownLink] = useState<MemberLink | null>(null);
  const setRole = useSetMemberRole();
  const remove = useRemoveMember();
  const resend = useResendInvite();
  const reset = useResetSignIn();

  if (isPending) return <Skeleton className="h-48 w-full" />;
  if (!isOwner) {
    return (
      <EmptyState
        icon={Users}
        title="Only an Owner can manage the team"
        description="Ask an Owner to add people or change roles."
      />
    );
  }

  const roleSelect = (member: TeamMember) => (
    <Select
      aria-label={`Role for ${member.email}`}
      className="w-36"
      value={member.role}
      onChange={(key) => {
        if (!key || key === member.role) return;
        setRole.mutate(
          { id: member.id, role: key as UserRole },
          { onSuccess: () => toast({ title: "Role changed", tone: "success" }) },
        );
      }}
    >
      {USER_ROLES.map((role) => (
        <ListBoxItem key={role} id={role}>
          {ROLE_LABELS[role]}
        </ListBoxItem>
      ))}
    </Select>
  );

  const actions = (member: TeamMember) => {
    if (member.id === me?.id) return null;
    const joined = member.state === "active" || member.state === "reset_pending";
    return (
      <MenuTrigger>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${member.email}`}>
          <Ellipsis className="size-4" aria-hidden="true" />
        </Button>
        <Menu>
          {joined ? (
            <MenuItem onAction={() => setPending({ action: "reset", member })}>
              {member.state === "reset_pending" ? "New reset link" : "Reset sign-in"}
            </MenuItem>
          ) : (
            <MenuItem
              onAction={() =>
                resend.mutate(member.id, { onSuccess: (result) => setShownLink(result) })
              }
            >
              Resend invite
            </MenuItem>
          )}
          <MenuItem variant="danger" onAction={() => setPending({ action: "remove", member })}>
            {joined ? "Remove" : "Remove invite"}
          </MenuItem>
        </Menu>
      </MenuTrigger>
    );
  };

  const items = team.data ?? [];
  const target = pending?.member;
  const targetInvited = target?.state === "invited" || target?.state === "expired";
  return (
    <Section
      title="Team"
      description="Owners manage the brand kit, tax rates, templates, and the team. Members do the rest."
      flush
      actions={
        <Button size="sm" onPress={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden="true" />
          Add member
        </Button>
      }
    >
      {team.isPending ? (
        <div className="p-5">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <>
          <div className="hidden md:block">
            <Table aria-label="Team" className="min-w-0">
              <TableHeader>
                <Column isRowHeader>Email</Column>
                <Column>Name</Column>
                <Column>Status</Column>
                <Column>Role</Column>
                <Column width={64}>
                  <span className="sr-only">Actions</span>
                </Column>
              </TableHeader>
              <TableBody items={items}>
                {(member) => (
                  <Row id={member.id}>
                    <Cell>
                      <span className="font-medium">{member.email}</span>
                      {member.id === me?.id ? (
                        <span className="ml-2 text-xs text-muted-foreground">You</span>
                      ) : null}
                    </Cell>
                    <Cell>
                      <span className="text-muted-foreground">{member.name ?? ""}</span>
                    </Cell>
                    <Cell>
                      <StateBadge member={member} />
                    </Cell>
                    <Cell>{roleSelect(member)}</Cell>
                    <Cell align="end">{actions(member)}</Cell>
                  </Row>
                )}
              </TableBody>
            </Table>
          </div>
          <ul className="m-0 flex list-none flex-col divide-y divide-row-border p-0 md:hidden">
            {items.map((member) => (
              <li key={member.id} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex min-w-0 flex-col items-start gap-1">
                  <span className="max-w-full truncate font-medium">
                    {member.email}
                    {member.id === me?.id ? " (you)" : ""}
                  </span>
                  {member.name ? (
                    <span className="text-[13px] text-muted-foreground">{member.name}</span>
                  ) : null}
                  <StateBadge member={member} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  {roleSelect(member)}
                  {actions(member)}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <AddMemberDialog
        key={adding ? "open" : "closed"}
        isOpen={adding}
        onOpenChange={setAdding}
        onAdded={setShownLink}
      />
      <LinkDialog link={shownLink} onClose={() => setShownLink(null)} />
      <AlertDialog
        isOpen={pending?.action === "remove"}
        onOpenChange={(open) => !open && setPending(null)}
        title={
          targetInvited ? `Remove the invite for ${target?.email}?` : `Remove ${target?.email}?`
        }
        actionLabel={targetInvited ? "Remove invite" : "Remove"}
        variant="danger"
        onAction={() => {
          if (!target) return;
          remove.mutate(target.id, {
            onSuccess: () =>
              toast({
                title: targetInvited ? "Invite removed" : "Member removed",
                tone: "success",
              }),
          });
        }}
      >
        {targetInvited
          ? "The invite link stops working."
          : "They lose access to the app. Their sessions end at once."}
      </AlertDialog>
      <AlertDialog
        isOpen={pending?.action === "reset"}
        onOpenChange={(open) => !open && setPending(null)}
        title={`Reset the sign-in for ${target?.email}?`}
        actionLabel="Reset sign-in"
        variant="danger"
        onAction={() => {
          if (!target) return;
          reset.mutate(target.id, { onSuccess: (result) => setShownLink(result) });
        }}
      >
        Their sessions end at once and their password stops working. You get a link that lets them
        set a new password. The link works for 24 hours.
      </AlertDialog>
    </Section>
  );
}

/**
 * Shows a new invite or reset link once, with a copy button. The server keeps only the
 * link's hash, so the Owner issues a fresh link to see one again.
 */
export function LinkDialog({ link, onClose }: { link: MemberLink | null; onClose: () => void }) {
  const isInvite = link?.kind === "invite";
  const email = link?.member.email ?? "";

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.link);
      toast({ title: "Link copied", tone: "success" });
    } catch {
      toast({ title: "Copy the link from the field" });
    }
  };

  let delivery = `Send this link to ${email}.`;
  if (isInvite && link?.emailSent)
    delivery = `We emailed this link to ${email}. You can also send it yourself.`;
  else if (isInvite)
    delivery = `No email went out, because email is not set up or the send failed. Send this link to ${email}.`;

  return (
    <Modal isOpen={link !== null} onOpenChange={(open) => !open && onClose()} size="sm">
      <Dialog
        title={isInvite ? "Invite link" : "Sign-in reset link"}
        description={delivery}
        footer={(close) => <Button onPress={close}>Done</Button>}
      >
        {link ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-end gap-2">
              <TextField
                label="Link"
                className="min-w-0 flex-1"
                value={link.link}
                isReadOnly
                onFocus={(event) => (event.target as HTMLInputElement).select()}
              />
              <Button variant="secondary" onPress={() => void copy()}>
                <Copy className="size-4" aria-hidden="true" />
                Copy
              </Button>
            </div>
            <p className="m-0 text-sm text-muted-foreground">
              The link works once and expires {formatLinkExpiry(link.expiresAt)}. It shows only now.
              You can issue a fresh link from the team list at any time.
            </p>
          </div>
        ) : null}
      </Dialog>
    </Modal>
  );
}

function AddMemberDialog({
  isOpen,
  onOpenChange,
  onAdded,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (link: MemberLink) => void;
}) {
  const [values, setValues] = useState({ email: "", name: "", role: "member" as UserRole });
  const [errors, setErrors] = useState<FieldErrors>({});
  const add = useAddMember();

  const submit = async (close: () => void) => {
    const result = validate(teamMemberInput, values);
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    try {
      const added = await add.mutateAsync(values);
      close();
      onAdded(added);
    } catch (err) {
      const fieldErrors = issuesByPath(err);
      if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
      else toastError(err, "Could not add the member");
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="sm">
      <Dialog
        title="Add member"
        description="This creates an invite link. It works once, for 7 days."
      >
        {(close) => (
          <Form
            validationBehavior="aria"
            className="flex flex-col gap-4 pb-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(close);
            }}
          >
            <TextField
              label="Email"
              type="email"
              autoComplete="off"
              isRequired
              autoFocus
              value={values.email}
              onChange={(email) => setValues({ ...values, email })}
              {...fieldError(errors, "email")}
            />
            <TextField
              label="Name"
              description="Optional. They can change it when they join."
              autoComplete="off"
              value={values.name}
              onChange={(name) => setValues({ ...values, name })}
              {...fieldError(errors, "name")}
            />
            <Select
              label="Role"
              value={values.role}
              onChange={(key) => key && setValues({ ...values, role: key as UserRole })}
            >
              {USER_ROLES.map((role) => (
                <ListBoxItem key={role} id={role}>
                  {ROLE_LABELS[role]}
                </ListBoxItem>
              ))}
            </Select>
            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <Button variant="secondary" onPress={close}>
                Cancel
              </Button>
              <Button type="submit" isPending={add.isPending}>
                Add member
              </Button>
            </div>
          </Form>
        )}
      </Dialog>
    </Modal>
  );
}
