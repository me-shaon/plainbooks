import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Form } from "react-aria-components";
import type { InviteLinkInfo } from "../../../shared/schemas/settings";
import { newPassword as newPasswordSchema } from "../../../shared/schemas/setup";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { TextField } from "../../components/ui/text-field";
import { ApiError, api } from "../../lib/api";
import { FIX_FIELDS, PASSWORDS_DIFFER, passwordErrorMessage, SIGN_IN_PATH } from "../../lib/auth";
import { type FieldErrors, fieldError } from "../../lib/form";
import { queryKeys } from "../../lib/query-keys";
import { setupStatusQuery } from "../../lib/setup";
import { AuthCard, FormAlert } from "./auth-card";

const linkStyle = "font-medium text-accent underline underline-offset-2";

/** The answer for an unknown, used, or expired link. */
const isInvalidLink = (err: unknown) =>
  err instanceof ApiError && (err.status === 410 || err.status === 404);

/** The state for a used, expired, or unknown invite or reset link. */
function InvalidInviteLink() {
  return (
    <AuthCard title="This link does not work">
      <div role="alert" className="flex flex-col gap-4">
        <p className="m-0 text-sm text-ink">
          The link was used or has expired. Ask your Owner for a new link.
        </p>
        <Link to={SIGN_IN_PATH} className={linkStyle}>
          Go to sign in
        </Link>
      </div>
    </AuthCard>
  );
}

/**
 * The page that an invite or Owner reset link opens. Loading the page does not use the
 * link. Only the form's POST does. An invite asks for a name and a password, or offers
 * Google when it is set up. A reset asks only for a new password.
 */
export function InvitePage({ token }: { token: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useQuery(setupStatusQuery);
  const info = useQuery({
    queryKey: ["invite-link", token],
    queryFn: () =>
      api<InviteLinkInfo>("/invites/lookup", {
        method: "POST",
        json: { token },
        toastOnError: false,
      }),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [values, setValues] = useState<{ name: string | null; password: string; confirm: string }>({
    name: null,
    password: "",
    confirm: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [used, setUsed] = useState(false);

  const accept = useMutation({
    mutationFn: (input: { name: string | null; password: string }) =>
      api("/invites/accept", {
        method: "POST",
        json: { token, ...input },
        toastOnError: false,
      }),
  });

  const google = useMutation({
    mutationFn: () =>
      api<{ url?: string }>("/auth/sign-in/social", {
        method: "POST",
        json: {
          provider: "google",
          callbackURL: `${window.location.origin}/`,
          // A refused login lands on sign-in with `?error=<code>`.
          errorCallbackURL: `${window.location.origin}${SIGN_IN_PATH}`,
          disableRedirect: true,
        },
        toastOnError: false,
      }),
  });

  if (info.isPending) {
    return (
      <AuthCard title="Join the team">
        <Skeleton className="h-40 w-full" />
      </AuthCard>
    );
  }
  if (used || isInvalidLink(info.error)) return <InvalidInviteLink />;
  if (info.isError || !info.data) {
    return (
      <AuthCard title="Join the team">
        <FormAlert message={passwordErrorMessage(info.error)} />
      </AuthCard>
    );
  }

  const link = info.data;
  const isInvite = link.kind === "invite";
  const name = values.name ?? link.name ?? "";
  const set = (field: "name" | "password" | "confirm") => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const submit = async () => {
    const fieldErrors: FieldErrors = {};
    if (isInvite && !name.trim()) fieldErrors.name = "Enter your name";
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
      await accept.mutateAsync({
        name: isInvite ? name.trim() : null,
        password: values.password,
      });
    } catch (err) {
      if (isInvalidLink(err)) {
        setUsed(true);
        return;
      }
      setFormError(passwordErrorMessage(err));
      return;
    }
    // Drop data from an earlier session. The setup status needs no session, so it stays.
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== queryKeys.setupStatus[0],
    });
    router.history.push("/");
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
    <AuthCard
      title={isInvite ? "Join the team" : "Set a new password"}
      description={
        isInvite ? (
          <>
            Set up the sign-in for <span className="font-medium text-ink">{link.email}</span>.
          </>
        ) : (
          <>
            Your Owner reset the sign-in for{" "}
            <span className="font-medium text-ink">{link.email}</span>.
          </>
        )
      }
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
        {/* Password managers read the email from this field. */}
        <input
          type="email"
          name="email"
          autoComplete="username"
          value={link.email}
          readOnly
          hidden
        />
        {isInvite ? (
          <TextField
            label="Your name"
            name="name"
            autoComplete="name"
            isRequired
            autoFocus
            value={name}
            onChange={set("name")}
            {...fieldError(errors, "name")}
          />
        ) : null}
        <TextField
          label={isInvite ? "Password" : "New password"}
          name="password"
          type="password"
          autoComplete="new-password"
          description="Use 12 to 128 characters."
          isRequired
          autoFocus={!isInvite}
          value={values.password}
          onChange={set("password")}
          {...fieldError(errors, "password")}
        />
        <TextField
          label={isInvite ? "Confirm password" : "Confirm new password"}
          name="confirm"
          type="password"
          autoComplete="new-password"
          isRequired
          value={values.confirm}
          onChange={set("confirm")}
          {...fieldError(errors, "confirm")}
        />
        <Button type="submit" isPending={accept.isPending} className="mt-1 w-full">
          {isInvite ? "Join" : "Set new password"}
        </Button>
      </Form>
      {isInvite && status.data?.googleEnabled ? (
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
          <p className="m-0 text-xs text-muted-foreground">
            Use the Google account for {link.email}.
          </p>
        </div>
      ) : null}
    </AuthCard>
  );
}
