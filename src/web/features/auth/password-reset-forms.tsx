import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Form } from "react-aria-components";
import { newPassword as newPasswordSchema } from "../../../shared/schemas/setup";
import { Button, buttonStyles } from "../../components/ui/button";
import { TextField } from "../../components/ui/text-field";
import { ApiError, api } from "../../lib/api";
import { FORGOT_PASSWORD_PATH, passwordErrorMessage, SIGN_IN_PATH } from "../../lib/auth";
import { type FieldErrors, fieldError } from "../../lib/form";
import { setupStatusQuery } from "../../lib/setup";
import { AuthCard, FormAlert } from "./auth-card";
import { FIX_FIELDS, PASSWORDS_DIFFER } from "./setup-form";

const linkStyle = "font-medium text-accent underline underline-offset-2";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Asks for a reset link. The page shows the same message whether or not the email belongs
 * to a member, so it does not tell who is a member.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const request = useMutation({
    mutationFn: (value: string) =>
      api("/auth/request-password-reset", {
        method: "POST",
        json: { email: value },
        toastOnError: false,
      }),
  });

  const submit = async () => {
    const value = email.trim().toLowerCase();
    const fieldErrors: FieldErrors = {};
    if (!EMAIL_PATTERN.test(value)) fieldErrors.email = "Enter a valid email address";
    setErrors(fieldErrors);
    if (fieldErrors.email) {
      setFormError(FIX_FIELDS);
      return;
    }
    setFormError(null);
    try {
      await request.mutateAsync(value);
      setSent(true);
    } catch (err) {
      setFormError(passwordErrorMessage(err));
    }
  };

  if (sent) {
    return (
      <AuthCard title="Check your email">
        <div role="status" className="flex flex-col gap-4">
          <p className="m-0 text-sm text-ink">
            If this email belongs to a member, a reset link is on its way. The link works for 60
            minutes.
          </p>
          <Link to={SIGN_IN_PATH} className={linkStyle}>
            Back to sign in
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email. We send a link to set a new password."
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
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          isRequired
          autoFocus
          value={email}
          onChange={setEmail}
          {...fieldError(errors, "email")}
        />
        <Button type="submit" isPending={request.isPending} className="mt-1 w-full">
          Send reset link
        </Button>
      </Form>
      <div className="mt-6 text-sm">
        <Link to={SIGN_IN_PATH} className={linkStyle}>
          Back to sign in
        </Link>
      </div>
    </AuthCard>
  );
}

/** The state for a used, expired, or missing reset token. */
function InvalidResetLink() {
  const status = useQuery(setupStatusQuery);
  return (
    <AuthCard title="This link does not work">
      <div role="alert" className="flex flex-col gap-4">
        <p className="m-0 text-sm text-ink">
          The reset link was used or has expired. Ask for a new link.
        </p>
        {status.data?.emailConfigured ? (
          <Link to={FORGOT_PASSWORD_PATH} className={buttonStyles({ className: "w-full" })}>
            Ask for a new link
          </Link>
        ) : (
          <Link to={SIGN_IN_PATH} className={linkStyle}>
            Back to sign in
          </Link>
        )}
      </div>
    </AuthCard>
  );
}

/** Sets a new password with the token from the reset email. */
export function ResetPasswordPage({ token, error }: { token?: string; error?: string }) {
  const [values, setValues] = useState({ password: "", confirm: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [state, setState] = useState<"form" | "invalid" | "done">(
    token && !error ? "form" : "invalid",
  );

  const reset = useMutation({
    mutationFn: (newPassword: string) =>
      api("/auth/reset-password", {
        method: "POST",
        json: { token, newPassword },
        toastOnError: false,
      }),
  });

  const set = (field: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const submit = async () => {
    const fieldErrors: FieldErrors = {};
    const parsed = newPasswordSchema.safeParse(values.password);
    if (!parsed.success) fieldErrors.password = parsed.error.issues[0]?.message ?? FIX_FIELDS;
    else if (values.confirm !== values.password) fieldErrors.confirm = PASSWORDS_DIFFER;
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) {
      setFormError(FIX_FIELDS);
      return;
    }
    setFormError(null);
    try {
      await reset.mutateAsync(values.password);
      setState("done");
    } catch (err) {
      if (err instanceof ApiError && err.code === "INVALID_TOKEN") {
        setState("invalid");
        return;
      }
      if (err instanceof ApiError && err.code?.startsWith("PASSWORD_TOO_")) {
        setErrors({ password: "Use 12 to 128 characters" });
        setFormError(FIX_FIELDS);
        return;
      }
      setFormError(passwordErrorMessage(err));
    }
  };

  if (state === "invalid") return <InvalidResetLink />;

  if (state === "done") {
    return (
      <AuthCard title="Password changed">
        <div role="status" className="flex flex-col gap-4">
          <p className="m-0 text-sm text-ink">
            Sign in with the new password. Your other sessions are signed out.
          </p>
          <Link to={SIGN_IN_PATH} className={buttonStyles({ className: "w-full" })}>
            Go to sign in
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Set a new password">
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
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          description="Use 12 to 128 characters."
          isRequired
          autoFocus
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
        <Button type="submit" isPending={reset.isPending} className="mt-1 w-full">
          Set new password
        </Button>
      </Form>
    </AuthCard>
  );
}
