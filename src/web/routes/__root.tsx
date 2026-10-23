import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  type NavigateOptions,
  Outlet,
  type ToOptions,
  useRouter,
} from "@tanstack/react-router";
import { RouterProvider } from "react-aria-components";
import { AppShell } from "../components/app-shell";
import { Toaster } from "../components/ui/toast";
import { useBrandKit, useWorkspaceSettings } from "../features/settings/queries";
import { useMe } from "../lib/session";

export interface RouterContext {
  queryClient: QueryClient;
}

// React Aria links and table rows with `href` navigate through TanStack Router.
declare module "react-aria-components" {
  interface RouterConfig {
    href: ToOptions["to"];
    routerOptions: Omit<NavigateOptions, keyof ToOptions>;
  }
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  const router = useRouter();
  const { me } = useMe();
  const brandKit = useBrandKit();
  const settings = useWorkspaceSettings();
  const agencyName = brandKit.data?.businessName || settings.data?.name || "";
  return (
    <RouterProvider
      navigate={(to, options) => router.navigate({ ...options, to })}
      useHref={(to) => router.buildLocation({ to }).href}
    >
      <AppShell
        agencyName={agencyName}
        logoUrl={brandKit.data?.logoUrl ?? undefined}
        userName={me ? (me.name ?? me.email) : ""}
        userRole={me ? (me.role === "owner" ? "Owner" : "Member") : ""}
      >
        <Outlet />
      </AppShell>
      <Toaster />
    </RouterProvider>
  );
}
