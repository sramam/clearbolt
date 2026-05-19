"use client";

import { HeaderAuth } from "@/components/header-auth";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  Bookmark,
  FolderKanban,
  PanelLeft,
  Search,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "clearbolt.sidebarCollapsed";

const NAV_ITEMS: {
  href: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
}[] = [
  { href: "/search", label: "Search", icon: Search },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "#", label: "Saved (soon)", icon: Bookmark, disabled: true },
];

function SidebarNavItem(props: {
  href: string;
  label: string;
  icon: LucideIcon;
  collapsed: boolean;
  active: boolean;
  disabled?: boolean;
}) {
  const Icon = props.icon;
  const className = cn(
    "flex items-center rounded-md text-sm font-medium transition-colors",
    props.collapsed ? "size-9 justify-center" : "gap-2 px-3 py-2",
    props.disabled
      ? "cursor-not-allowed text-muted-foreground/60"
      : props.active
        ? "bg-accent text-foreground"
        : "text-foreground hover:bg-accent",
  );

  const inner = (
    <>
      <Icon className="size-5 shrink-0" aria-hidden />
      {!props.collapsed ? <span>{props.label}</span> : null}
    </>
  );

  if (props.disabled) {
    const node = (
      <span className={className} aria-disabled aria-label={props.label}>
        {inner}
      </span>
    );
    if (!props.collapsed) return node;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{node}</TooltipTrigger>
        <TooltipContent side="right">{props.label}</TooltipContent>
      </Tooltip>
    );
  }

  const link = (
    <Link
      href={props.href}
      className={className}
      aria-label={props.collapsed ? props.label : undefined}
      aria-current={props.active ? "page" : undefined}
    >
      {inner}
    </Link>
  );

  if (!props.collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{props.label}</TooltipContent>
    </Tooltip>
  );
}

export function AppShell({
  children,
  signedIn = false,
  userLabel,
  devBypass = false,
}: {
  children: ReactNode;
  signedIn?: boolean;
  userLabel?: string;
  devBypass?: boolean;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      if (typeof localStorage !== "undefined") {
        setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
      }
    } catch {
      /* ignore */
    }
  }, []);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex min-h-screen w-full">
        <aside
          className={cn(
            "flex shrink-0 flex-col border-r border-border bg-muted/30 transition-[width] duration-200 ease-out",
            collapsed ? "w-14" : "w-56",
          )}
        >
          <div
            className={cn(
              "flex flex-1 flex-col",
              collapsed ? "items-center px-1.5 py-3" : "p-3",
            )}
          >
            {!collapsed ? (
              <div className="px-1 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Workspace
              </div>
            ) : null}
            <nav
              className={cn(
                "flex flex-col",
                collapsed ? "items-center gap-1" : "gap-1",
              )}
            >
              {NAV_ITEMS.map((item) => (
                <SidebarNavItem
                  key={item.label}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  collapsed={collapsed}
                  disabled={item.disabled}
                  active={
                    !item.disabled &&
                    (pathname === item.href ||
                      pathname.startsWith(`${item.href}/`))
                  }
                />
              ))}
            </nav>
            {!collapsed ? (
              <>
                <Separator className="my-3" />
                <div className="px-1 text-xs text-muted-foreground">
                  More areas will live here as the product grows.
                </div>
              </>
            ) : null}
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={toggle}
                  aria-expanded={!collapsed}
                  aria-label={
                    collapsed ? "Expand sidebar" : "Collapse sidebar"
                  }
                >
                  <PanelLeft
                    className={cn(
                      "size-5 transition-transform",
                      collapsed && "scale-x-[-1]",
                    )}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {collapsed ? "Expand sidebar" : "Collapse sidebar"}
              </TooltipContent>
            </Tooltip>
            <Link
              href="/search"
              className="text-sm font-semibold tracking-tight"
            >
              Clearbolt
            </Link>
            <HeaderAuth
              signedIn={signedIn}
              userLabel={userLabel}
              devBypass={devBypass}
            />
          </header>
          <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}
