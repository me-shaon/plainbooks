import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Form } from "react-aria-components";
import {
  type SetupOwnerInput,
  type SetupStatus,
  setupOwnerInput,
} from "../../../shared/schemas/setup";
import { Button } from "../../components/ui/button";
import { TextField } from "../../components/ui/text-field";
import { api, issuesByPath } from "../../lib/api";
import { type FieldErrors, fieldError, validate } from "../../lib/form";
import { queryKeys } from "../../lib/query-keys";
import type { Me } from "../../lib/session";
import { setupErrorMessage } from "../../lib/setup";
import { AuthCard, FormAlert } from "./auth-card";

export const PASSWORDS_DIFFER = "The passwords do not match";
export const FIX_FIELDS = "Fix the marked fields, then try again.";

/** The first-run screen: claims a fresh deploy with the setup token and creates the Owner. */
export function SetupPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [values, setValues] = useState({
    token: "",
    name: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (input: SetupOwnerInput) =>
      api<{ user: Me }>("/setup/owner", { method: "POST", json: input, toastOnError: false }),
  });

  const set = (field: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const submit = async () => {
    const { confirm, ...input } = values;
    const result = validate(setupOwnerInput, input);
    const fieldErrors: FieldErrors = result.errors ? { ...result.errors } : {};
    if (!fieldErrors.password && confirm !== values.password)
      fieldErrors.confirm = PASSWORDS_DIFFER;
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) {
      setFormError(FIX_FIELDS);
      return;
    }
    setFormError(null);
    try {
      const { user } = await create.mutateAsync(input);
      queryClient.setQueryData(queryKeys.me, user);
      queryClient.setQueryData<SetupStatus | undefined>(queryKeys.setupStatus, (status) =>
        status ? { ...status, needsSetup: false } : status,
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.setupStatus });
      await navigate({ to: "/" });
    } catch (err) {
      const issues = issuesByPath(err);
      setErrors(issues);
      setFormError(setupErrorMessage(err) ?? FIX_FIELDS);
    }
  };

  return (
    <AuthCard
      title="Set up PlainBooks"
      description="Create the first Owner. Use the SETUP_TOKEN secret that you set when you deployed."
    >
      <Form
        validationBehavior="aria"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <FormAlert message={formError} />
        <TextField
          label="Setup token"
          name="token"
          type="password"
          autoComplete="off"
          isRequired
          autoFocus
          value={values.token}
          onChange={set("token")}
          {...fieldError(errors, "token")}
        />
        <TextField
          label="Your name"
          name="name"
          autoComplete="name"
          isRequired
          value={values.name}
          onChange={set("name")}
          {...fieldError(errors, "name")}
        />
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          isRequired
          value={values.email}
          onChange={set("email")}
          {...fieldError(errors, "email")}
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          description="Use 12 to 128 characters."
          isRequired
          value={values.password}
          onChange={set("password")}
          {...fieldError(errors, "password")}
        />
        <TextField
          label="Confirm password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          isRequired
          value={values.confirm}
          onChange={set("confirm")}
          {...fieldError(errors, "confirm")}
        />
        <Button type="submit" isPending={create.isPending} className="mt-1 w-full">
          Create Owner
        </Button>
      </Form>
    </AuthCard>
  );
}
