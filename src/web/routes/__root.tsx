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
  return (
    <RouterProvider
      navigate={(to, options) => router.navigate({ ...options, to })}
      useHref={(to) => router.buildLocation({ to }).href}
    >
      {/* Placeholders until workspace settings and sign-in exist (later units). */}
      <AppShell agencyName="[Agency name]" userName="[Your name]" userRole="Owner">
        <Outlet />
      </AppShell>
      <Toaster />
    </RouterProvider>
  );
}
