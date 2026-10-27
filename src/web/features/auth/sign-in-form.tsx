import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Form } from "react-aria-components";
import { Button } from "../../components/ui/button";
import { TextField } from "../../components/ui/text-field";
import { api } from "../../lib/api";
import {
  FIX_FIELDS,
  FORGOT_PASSWORD_PATH,
  googleErrorMessage,
  passwordErrorMessage,
  SIGN_IN_PATH,
  safeNext,
  signInErrorMessage,
} from "../../lib/auth";
import { type FieldErrors, fieldError } from "../../lib/form";
import { queryKeys } from "../../lib/query-keys";
import { RECOVER_PATH, setupStatusQuery } from "../../lib/setup";
import { AuthCard, FormAlert } from "./auth-card";

const linkStyle = "font-medium text-accent underline underline-offset-2";

export interface SignInPageProps {
  /** The page to open after sign-in. Only a same-origin relative path is used. */
  next?: string;
  /** The error code of a refused Google sign-in. */
  error?: string;
}

/** Email and password sign-in, plus "Continue with Google" when Google is set up. */
export function SignInPage({ next, error }: SignInPageProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useQuery(setupStatusQuery);
  const [values, setValues] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(
    error ? googleErrorMessage(error) : null,
  );
  const target = safeNext(next);

  const signIn = useMutation({
    mutationFn: (input: typeof values) =>
      api("/auth/sign-in/email", { method: "POST", json: input, toastOnError: false }),
  });

  const google = useMutation({
    mutationFn: () =>
      api<{ url?: string }>("/auth/sign-in/social", {
        method: "POST",
        json: {
          provider: "google",
          callbackURL: `${window.location.origin}${target}`,
          // A refused login comes back here with `?error=<code>`.
          errorCallbackURL: `${window.location.origin}${SIGN_IN_PATH}?${new URLSearchParams({ next: target })}`,
          disableRedirect: true,
        },
        toastOnError: false,
      }),
  });

  const set = (field: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const submit = async () => {
    const fieldErrors: FieldErrors = {};
    if (!values.email.trim()) fieldErrors.email = "Enter your email";
    if (!values.password) fieldErrors.password = "Enter your password";
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) {
      setFormError(FIX_FIELDS);
      return;
    }
    setFormError(null);
    try {
      await signIn.mutateAsync({ email: values.email.trim(), password: values.password });
    } catch (err) {
      setFormError(signInErrorMessage(err));
      return;
    }
    // Drop data from an earlier session. The setup status needs no session, so it stays.
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== queryKeys.setupStatus[0],
    });
    router.history.push(target);
  };

  const continueWithGoogle = async () => {
    setFormError(null);
    try {
      const { url } = await google.mutateAsync();
      if (!url) throw new Error("No Google URL");
      // A full page load, so no form posts to Google and the CSP form-action stays 'self'.
      window.location.assign(url);
    } catch (err) {
      setFormError(passwordErrorMessage(err));
    }
  };

  return (
    <AuthCard title="Sign in">
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
          value={values.email}
          onChange={set("email")}
          {...fieldError(errors, "email")}
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          isRequired
          value={values.password}
          onChange={set("password")}
          {...fieldError(errors, "password")}
        />
        <Button type="submit" isPending={signIn.isPending} className="mt-1 w-full">
          Sign in
        </Button>
      </Form>
      {status.data?.googleEnabled ? (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
            or
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
          </div>
          <Button
            variant="secondary"
            className="w-full"
            isPending={google.isPending}
            onPress={() => void continueWithGoogle()}
          >
            Continue with Google
          </Button>
        </div>
      ) : null}
      <div className="mt-6 flex flex-col gap-2 text-sm text-muted-foreground">
        {status.data?.emailConfigured ? (
          <Link to={FORGOT_PASSWORD_PATH} className={linkStyle}>
            Forgot your password?
          </Link>
        ) : null}
        <Link to={RECOVER_PATH} className={linkStyle}>
          Locked out?
        </Link>
      </div>
    </AuthCard>
  );
}
