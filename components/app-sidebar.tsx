"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Contact,
  GitBranch,
  Users,
  Package,
  FileText,
  FileUp,
  Inbox,
  ListTree,
  SlidersHorizontal,
  Wand2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { MembershipRole } from "@/lib/db/schema/membership";
import { trpc } from "@/lib/trpc/client";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Omit for items every role can use. */
  allowedRoles?: MembershipRole[];
};

const primaryNav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Contact },
  { href: "/opportunities", label: "Opportunities", icon: GitBranch },
  { href: "/quotes", label: "Quotes", icon: FileText },
  { href: "/accounts", label: "Accounts", icon: Users },
  { href: "/products", label: "Products", icon: Package },
  { href: "/suggestions", label: "Suggestions", icon: Inbox },
  { href: "/import", label: "Import", icon: FileUp },
];

const settingsNav: NavItem[] = [
  {
    href: "/setup",
    label: "Guided setup",
    icon: Wand2,
    allowedRoles: ["admin", "sales_manager"],
  },
  {
    href: "/settings/pipeline",
    label: "Pipeline",
    icon: ListTree,
    allowedRoles: ["admin", "sales_manager"],
  },
  {
    href: "/settings/custom-fields",
    label: "Custom fields",
    icon: SlidersHorizontal,
    allowedRoles: ["admin", "sales_manager"],
  },
  {
    href: "/settings/automation",
    label: "Automation",
    icon: Zap,
    allowedRoles: ["admin", "sales_manager"],
  },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <SidebarMenuButton asChild isActive={active}>
      <Link href={item.href}>
        <Icon />
        <span>{item.label}</span>
      </Link>
    </SidebarMenuButton>
  );
}

function DisabledNavItem({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <SidebarMenuButton disabled aria-disabled="true">
          <Icon />
          <span>{item.label}</span>
        </SidebarMenuButton>
      </TooltipTrigger>
      <TooltipContent side="right">Requires manager or admin access</TooltipContent>
    </Tooltip>
  );
}

export function AppSidebar({ role }: { role: MembershipRole }) {
  const pathname = usePathname();

  function isActive(href: string) {
    return pathname === href || pathname?.startsWith(`${href}/`);
  }

  const pendingCount = trpc.suggestion.pendingCount.useQuery(undefined, {
    // A gentle refresh so a newly-created batch surfaces without a reload.
    refetchInterval: 60_000,
  });

  function renderItem(item: NavItem) {
    const disabled = item.allowedRoles ? !item.allowedRoles.includes(role) : false;
    if (disabled) return <DisabledNavItem item={item} />;

    const badge =
      item.href === "/suggestions" && (pendingCount.data ?? 0) > 0 ? (
        <SidebarMenuBadge>{pendingCount.data}</SidebarMenuBadge>
      ) : null;

    return (
      <>
        <NavLink item={item} active={isActive(item.href)} />
        {badge}
      </>
    );
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 font-heading text-sm font-semibold tracking-tight text-sidebar-foreground"
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">
            E
          </span>
          <span className="group-data-[collapsible=icon]:hidden">erp_test</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {primaryNav.map((item) => (
                <SidebarMenuItem key={item.href}>{renderItem(item)}</SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Settings</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsNav.map((item) => (
                <SidebarMenuItem key={item.href}>{renderItem(item)}</SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
