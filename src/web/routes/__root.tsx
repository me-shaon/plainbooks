import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  Link,
  type NavigateOptions,
  Outlet,
  redirect,
  type ToOptions,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { Compass } from "lucide-react";
import { RouterProvider } from "react-aria-components";
import { AppShell } from "../components/app-shell";
import { EmptyState } from "../components/ui/empty-state";
import { Toaster } from "../components/ui/toast";
import { useBrandKit, useWorkspaceSettings } from "../features/settings/queries";
import { api } from "../lib/api";
import { SIGN_IN_PATH } from "../lib/auth";
import { queryKeys } from "../lib/query-keys";
import { useMe } from "../lib/session";
import { PUBLIC_PATHS, setupStatusQuery } from "../lib/setup";

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
  // Until an Owner exists, every page is the setup screen. After setup, /setup goes to
  // the app. If the status call fails, the page loads and its own API calls show the error.
  // A page that needs a session and has none gets a 401, and api() opens sign-in.
  beforeLoad: async ({ context, location }) => {
    const status = await context.queryClient.ensureQueryData(setupStatusQuery).catch(() => null);
    if (!status) return;
    if (status.needsSetup && location.pathname !== "/setup") throw redirect({ to: "/setup" });
    if (!status.needsSetup && location.pathname === "/setup") throw redirect({ to: "/" });
  },
  component: RootLayout,
  notFoundComponent: NotFound,
});

function NotFound() {
  return (
    <EmptyState
      icon={Compass}
      title="This page does not exist"
      description="The link may be old, or the address has a typo."
      action={
        <Link to="/" className="text-sm font-medium text-accent underline">
          Go to the overview
        </Link>
      }
    />
  );
}

function RootLayout() {
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <RouterProvider
      navigate={(to, options) => router.navigate({ ...options, to })}
      useHref={(to) => router.buildLocation({ to }).href}
    >
      {PUBLIC_PATHS.includes(pathname) ? <Outlet /> : <AppLayout />}
      <Toaster />
    </RouterProvider>
  );
}

/** The signed-in app: the shell around the page. Public pages skip it and its API calls. */
function AppLayout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { me } = useMe();
  const brandKit = useBrandKit();
  const settings = useWorkspaceSettings();
  const agencyName = brandKit.data?.businessName || settings.data?.name || "";

  const signOut = async () => {
    try {
      await api("/auth/sign-out", { method: "POST", json: {} });
    } catch {
      return; // api() showed a toast.
    }
    // Leave the app first, so its queries do not refetch without a session.
    await navigate({ to: SIGN_IN_PATH });
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== queryKeys.setupStatus[0],
    });
  };
  return (
    <AppShell
      agencyName={agencyName}
      logoUrl={brandKit.data?.logoUrl ?? undefined}
      userName={me ? (me.name ?? me.email) : ""}
      userRole={me ? (me.role === "owner" ? "Owner" : "Member") : ""}
      onSignOut={() => void signOut()}
    >
      <Outlet />
    </AppShell>
  );
}
