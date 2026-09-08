import { cookies } from "next/headers";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { resolveSessionContext } from "@/lib/auth/session";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const [session, cookieStore] = await Promise.all([resolveSessionContext(), cookies()]);
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar role={session?.role ?? "sales_rep"} />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <OrganizationSwitcher afterSelectOrganizationUrl="/dashboard" />
            <UserButton />
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
