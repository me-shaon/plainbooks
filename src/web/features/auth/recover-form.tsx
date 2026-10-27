import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Form } from "react-aria-components";
import { type RecoverOwnerInput, recoverOwnerInput } from "../../../shared/schemas/setup";
import { Button, buttonStyles } from "../../components/ui/button";
import { TextField } from "../../components/ui/text-field";
import { api, issuesByPath } from "../../lib/api";
import { FIX_FIELDS, PASSWORDS_DIFFER, SIGN_IN_PATH } from "../../lib/auth";
import { type FieldErrors, fieldError, validate } from "../../lib/form";
import { setupErrorMessage } from "../../lib/setup";
import { AuthCard, FormAlert } from "./auth-card";

/**
 * Owner recovery: a new, unused setup token sets a new password for an Owner email and
 * signs that Owner out everywhere.
 */
export function RecoverPage() {
  const [values, setValues] = useState({ token: "", email: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const recover = useMutation({
    mutationFn: (input: RecoverOwnerInput) =>
      api<{ ok: true }>("/setup/recover", { method: "POST", json: input, toastOnError: false }),
  });

  const set = (field: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const submit = async () => {
    const { confirm, ...input } = values;
    const result = validate(recoverOwnerInput, input);
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
      await recover.mutateAsync(input);
      setDone(true);
    } catch (err) {
      setErrors(issuesByPath(err));
      setFormError(setupErrorMessage(err) ?? FIX_FIELDS);
    }
  };

  if (done) {
    return (
      <AuthCard title="Password changed">
        <div role="status" className="flex flex-col gap-4">
          <p className="m-0 text-sm text-ink">
            Sign in with the new password. All other sessions of this Owner are signed out.
          </p>
          <Link to={SIGN_IN_PATH} className={buttonStyles({ className: "w-full" })}>
            Go to sign in
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Recover an Owner"
      description="Set a new SETUP_TOKEN secret that was never used, then enter it here with the Owner email."
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
          label="Owner email"
          name="email"
          type="email"
          autoComplete="email"
          isRequired
          value={values.email}
          onChange={set("email")}
          {...fieldError(errors, "email")}
        />
        <TextField
          label="New password"
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
          label="Confirm new password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          isRequired
          value={values.confirm}
          onChange={set("confirm")}
          {...fieldError(errors, "confirm")}
        />
        <Button type="submit" isPending={recover.isPending} className="mt-1 w-full">
          Set new password
        </Button>
      </Form>
    </AuthCard>
  );
}
