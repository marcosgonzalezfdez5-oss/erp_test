"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";

const sections = [
  { href: "/accounts", label: "Accounts" },
  { href: "/leads", label: "Leads" },
  { href: "/opportunities", label: "Opportunities" },
  { href: "/products", label: "Products" },
  { href: "/import", label: "Import" },
  { href: "/settings/pipeline", label: "Pipeline settings" },
  { href: "/settings/custom-fields", label: "Custom fields" },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <header className="border-b border-black/10 dark:border-white/20">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-6 overflow-x-auto px-4 py-3">
        <Link href="/dashboard" className="shrink-0 text-sm font-semibold">
          erp_test
        </Link>

        <nav aria-label="Main" className="flex shrink-0 items-center gap-5 text-sm">
          {sections.map((section) => {
            const active = pathname === section.href || pathname?.startsWith(`${section.href}/`);
            return (
              <Link
                key={section.href}
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "underline decoration-2 underline-offset-4"
                    : "text-zinc-500 hover:text-foreground"
                }
              >
                {section.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <OrganizationSwitcher afterSelectOrganizationUrl="/dashboard" />
          <UserButton />
        </div>
      </div>
    </header>
  );
}
