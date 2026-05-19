"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import Link from "next/link";
import type { ReactNode } from "react";

const toggleClass = (active: boolean, disabled?: boolean) =>
  cn(
    "inline-flex size-9 items-center justify-center rounded-md transition-colors",
    disabled
      ? "cursor-not-allowed text-muted-foreground/50"
      : active
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:bg-muted hover:text-foreground",
  );

export function IconToggleLink(props: {
  href: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  if (props.disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={toggleClass(false, true)}
            aria-disabled
            aria-label={props.label}
          >
            {props.children}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">{props.label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={props.href}
          className={toggleClass(Boolean(props.active))}
          aria-label={props.label}
          aria-current={props.active ? "page" : undefined}
        >
          {props.children}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom">{props.label}</TooltipContent>
    </Tooltip>
  );
}

export function IconToggleGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset
      className={cn(
        "m-0 inline-flex min-w-0 items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5",
        className,
      )}
    >
      {children}
    </fieldset>
  );
}
