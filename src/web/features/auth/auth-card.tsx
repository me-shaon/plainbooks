import type { ReactNode } from "react";
import logoUrl from "../../../../brand/logos/plainbooks-color.svg";

/** The one-column frame of the public auth pages. It fits a 360 px screen. */
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-start justify-center bg-sidebar px-4 py-10 sm:items-center">
      <div className="w-full max-w-md rounded-card border border-border bg-background p-5 sm:p-8">
        {/* 180 px is the smallest size for the horizontal logo (brand/README.md). The SVG
            has a 40/1805 transparent margin, so -ml-1 lines the artwork up with the text. */}
        <img src={logoUrl} alt="PlainBooks" width={180} height={45} className="-ml-1 block" />
        <h1 className="mt-4 mb-0 text-xl font-semibold text-ink">{title}</h1>
        {description ? (
          <div className="mt-2 text-sm text-muted-foreground">{description}</div>
        ) : null}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

/** The form-level error. `role="alert"` makes screen readers announce it. */
export function FormAlert({ message }: { message: string | null }) {
  return (
    <div role="alert" className="empty:hidden">
      {message ? (
        <p className="m-0 rounded-button bg-danger-tint px-3 py-2 text-sm text-danger-tint-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}
