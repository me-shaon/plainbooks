import { Plus, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { Form } from "react-aria-components";
import type { UserRole } from "../../../shared/domain";
import { USER_ROLES } from "../../../shared/domain";
import { type TeamMember, teamMemberInput } from "../../../shared/schemas/settings";
import { Button } from "../../components/ui/button";
import { AlertDialog, Dialog, Modal } from "../../components/ui/dialog";
import { EmptyState } from "../../components/ui/empty-state";
import { ListBoxItem } from "../../components/ui/list-box";
import { Section } from "../../components/ui/section";
import { Select } from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { Cell, Column, Row, Table, TableBody, TableHeader } from "../../components/ui/table";
import { TextField } from "../../components/ui/text-field";
import { toast } from "../../components/ui/toast";
import { issuesByPath, toastError } from "../../lib/api";
import { type FieldErrors, fieldError, validate } from "../../lib/form";
import { useMe } from "../../lib/session";
import { useAddMember, useRemoveMember, useSetMemberRole, useTeam } from "./queries";

const ROLE_LABELS: Record<UserRole, string> = { owner: "Owner", member: "Member" };

export function TeamPage() {
  const { me, isOwner, isPending } = useMe();
  const team = useTeam(isOwner);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const setRole = useSetMemberRole();
  const remove = useRemoveMember();

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

  const removeButton = (member: TeamMember) =>
    member.id === me?.id ? null : (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${member.email}`}
        onPress={() => setRemoving(member)}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </Button>
    );

  const items = team.data ?? [];
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
                    <Cell>{roleSelect(member)}</Cell>
                    <Cell align="end">{removeButton(member)}</Cell>
                  </Row>
                )}
              </TableBody>
            </Table>
          </div>
          <ul className="m-0 flex list-none flex-col divide-y divide-row-border p-0 md:hidden">
            {items.map((member) => (
              <li key={member.id} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">
                    {member.email}
                    {member.id === me?.id ? " (you)" : ""}
                  </span>
                  {member.name ? (
                    <span className="text-[13px] text-muted-foreground">{member.name}</span>
                  ) : null}
                </div>
                <div className="flex items-center justify-between gap-2">
                  {roleSelect(member)}
                  {removeButton(member)}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <AddMemberDialog key={adding ? "open" : "closed"} isOpen={adding} onOpenChange={setAdding} />
      <AlertDialog
        isOpen={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.email ?? "this member"}?`}
        actionLabel="Remove"
        variant="danger"
        onAction={() => {
          if (!removing) return;
          remove.mutate(removing.id, {
            onSuccess: () => toast({ title: "Member removed", tone: "success" }),
          });
        }}
      >
        They lose access to the app. Their sessions end at once.
      </AlertDialog>
    </Section>
  );
}

function AddMemberDialog({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
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
      await add.mutateAsync(values);
      toast({ title: "Member added", tone: "success" });
      close();
    } catch (err) {
      const fieldErrors = issuesByPath(err);
      if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
      else toastError(err, "Could not add the member");
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="sm">
      <Dialog title="Add member" description="This adds the email to the team.">
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
              isRequired
              autoFocus
              value={values.email}
              onChange={(email) => setValues({ ...values, email })}
              {...fieldError(errors, "email")}
            />
            <TextField
              label="Name"
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
