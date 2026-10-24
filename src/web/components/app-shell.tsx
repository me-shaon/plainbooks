import { Link, type LinkProps } from "@tanstack/react-router";
import {
  ChartColumn,
  FileText,
  House,
  LayoutDashboard,
  type LucideIcon,
  Menu,
  MessageSquare,
  Palette,
  RotateCw,
  Settings,
  Users,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { Button } from "./ui/button";
import { cn } from "./ui/utils";

interface NavItem {
  to: LinkProps["to"];
  label: string;
  icon: LucideIcon;
}

const mainNav: NavItem[] = [
  { to: "/", label: "Overview", icon: House },
  { to: "/invoices", label: "Invoices", icon: FileText },
  { to: "/quotes", label: "Quotes", icon: MessageSquare },
  { to: "/recurring", label: "Recurring", icon: RotateCw },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/reports", label: "Reports", icon: ChartColumn },
];

const workspaceNav: NavItem[] = [
  { to: "/brand-kit", label: "Brand kit", icon: Palette },
  { to: "/templates", label: "Templates", icon: LayoutDashboard },
  { to: "/settings", label: "Settings", icon: Settings },
];

export interface AppShellProps {
  agencyName: string;
  /** A logo image. Without it, the logo square shows the agency initials. */
  logoUrl?: string;
  userName: string;
  userRole: string;
  children: ReactNode;
}

/** Up to two initials from a name, for example "Ahmed Shamim" gives "AS". */
export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim()
    .split(/\s+/);
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

/**
 * The app frame: the paper sidebar on wide screens, and a top bar with a drawer below 768 px.
 */
export function AppShell({ agencyName, logoUrl, userName, userRole, children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sidebarProps = { agencyName, logoUrl, userName, userRole };

  return (
    <div className="flex min-h-dvh bg-background text-ink">
      <a
        href="#main"
        className="sr-only z-[70] rounded-button bg-ink px-3 py-2 text-ink-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 overflow-y-auto border-r border-sidebar-border bg-sidebar md:flex">
        <SidebarNav {...sidebarProps} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-sidebar-border bg-sidebar px-2 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open navigation"
            onPress={() => setDrawerOpen(true)}
          >
            <Menu className="size-5" aria-hidden="true" />
          </Button>
          <Brand agencyName={agencyName} logoUrl={logoUrl} />
        </div>

        <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none">
          <div className="mx-auto flex max-w-[1208px] flex-col gap-7 px-4 pt-6 pb-10 sm:px-6 md:px-10 md:pt-8 md:pb-12">
            {children}
          </div>
        </main>
      </div>

      <ModalOverlay
        isOpen={drawerOpen}
        onOpenChange={setDrawerOpen}
        isDismissable
        className="motion-fade fixed inset-0 z-50 bg-[rgb(23_26_24/0.32)] md:hidden"
      >
        <Modal className="motion-drawer fixed inset-y-0 left-0 flex w-[280px] max-w-[85vw] bg-sidebar shadow-popover outline-none">
          <Dialog aria-label="Navigation" className="relative flex h-full w-full outline-none">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close navigation"
              className="absolute top-3 right-2"
              onPress={() => setDrawerOpen(false)}
            >
              <X className="size-5" aria-hidden="true" />
            </Button>
            <SidebarNav {...sidebarProps} touch onNavigate={() => setDrawerOpen(false)} />
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  );
}

function Brand({ agencyName, logoUrl }: { agencyName: string; logoUrl?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 px-2">
      {logoUrl ? (
        <img src={logoUrl} alt="" className="size-[26px] shrink-0 rounded-small object-contain" />
      ) : (
        <div
          aria-hidden="true"
          className="flex size-[26px] shrink-0 items-center justify-center rounded-small bg-accent text-xs font-semibold text-accent-foreground"
        >
          {initials(agencyName)}
        </div>
      )}
      <span className="truncate text-[15px] font-semibold text-sidebar-foreground">
        {agencyName}
      </span>
    </div>
  );
}

interface SidebarNavProps extends Omit<AppShellProps, "children"> {
  /** Taller rows for touch screens (the drawer). */
  touch?: boolean;
  onNavigate?: () => void;
}

function SidebarNav({
  agencyName,
  logoUrl,
  userName,
  userRole,
  touch,
  onNavigate,
}: SidebarNavProps) {
  const renderLink = (item: NavItem) => (
    <Link
      key={item.label}
      to={item.to}
      activeOptions={{ exact: item.to === "/" }}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2.5 rounded-small px-2.5 text-sidebar-muted outline-none",
        "transition-[background-color,color] duration-(--duration-press)",
        "hover:bg-[rgb(23_26_24/0.04)] hover:text-sidebar-foreground",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
        "aria-[current=page]:bg-sidebar-active aria-[current=page]:font-medium aria-[current=page]:text-sidebar-foreground aria-[current=page]:shadow-raised",
        touch ? "min-h-11" : "min-h-9",
      )}
    >
      <item.icon className="size-4 shrink-0" strokeWidth={1.7} aria-hidden="true" />
      {item.label}
    </Link>
  );

  return (
    <nav aria-label="Main" className="flex w-full flex-col gap-6 px-3 py-5">
      <Brand agencyName={agencyName} logoUrl={logoUrl} />
      <div className="flex flex-col gap-0.5">{mainNav.map(renderLink)}</div>
      <div className="flex flex-col gap-0.5">
        <span className="px-2.5 pb-1.5 text-xs text-sidebar-muted">Workspace</span>
        {workspaceNav.map(renderLink)}
      </div>
      <div className="mt-auto flex items-center gap-2.5 border-t border-sidebar-border px-2.5 pt-3">
        <div
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-tint text-xs font-semibold text-tint-foreground"
        >
          {initials(userName)}
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-sidebar-foreground">{userName}</span>
          <span className="text-xs text-sidebar-muted">{userRole}</span>
        </div>
      </div>
    </nav>
  );
}
