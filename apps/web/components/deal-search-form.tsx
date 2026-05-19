"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

type ProgressLine = {
  step: string;
  message: string;
  detail?: string;
  current?: number;
  total?: number;
};

export function DealSearchForm(props: {
  defaultQuery: string;
  source: string;
  view: "grid" | "list";
}) {
  const router = useRouter();
  const [query, setQuery] = useState(props.defaultQuery);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<ProgressLine[]>([]);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const q = query.trim();
      if (!q) {
        router.push("/search");
        return;
      }

      setRunning(true);
      setSteps([{ step: "start", message: "Starting search…" }]);

      try {
        const res = await fetch("/api/deal-search/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            q,
            source: props.source,
            view: props.view,
          }),
        });

        if (!res.ok || !res.body) {
          throw new Error(
            res.status === 401 ? "Sign in required" : "Search failed",
          );
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let redirectHref: string | null = null;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const parsed = JSON.parse(line) as ProgressLine;
            setSteps((prev) => {
              const last = prev[prev.length - 1];
              if (
                last?.step === parsed.step &&
                last?.message === parsed.message
              ) {
                return [...prev.slice(0, -1), parsed];
              }
              return [...prev, parsed];
            });
            if (parsed.step === "done" && parsed.detail?.startsWith("/")) {
              redirectHref = parsed.detail;
            }
          }
        }

        if (redirectHref) {
          router.push(redirectHref);
        }
      } catch (err) {
        setSteps((prev) => [
          ...prev,
          {
            step: "error",
            message: err instanceof Error ? err.message : "Search failed",
          },
        ]);
      } finally {
        setRunning(false);
      }
    },
    [query, props.source, props.view, router],
  );

  const progressPct =
    steps.length > 0
      ? Math.min(
          100,
          Math.round(
            (steps.filter((s) => s.step !== "start" && s.step !== "error")
              .length /
              6) *
              100,
          ),
        )
      : 0;

  const activeStep = steps[steps.length - 1];

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <div className="relative flex flex-1 flex-col gap-1.5">
          <label htmlFor="deal-search-q" className="sr-only">
            Search deals
          </label>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="deal-search-q"
            placeholder="Search deals — e.g. pool services Los Angeles"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            disabled={running}
          />
        </div>
        <Button type="submit" disabled={running}>
          {running ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Searching…
            </>
          ) : (
            "Search"
          )}
        </Button>
      </form>

      {running || steps.length > 0 ? (
        <output
          className="block rounded-lg border border-border bg-muted/30 px-4 py-3"
          aria-live="polite"
        >
          <div className="mb-2 flex items-center justify-between gap-2 text-sm font-medium">
            <span>{running ? "Working on your search" : "Last search"}</span>
            {running ? (
              <span className="text-muted-foreground tabular-nums">
                {progressPct}%
              </span>
            ) : null}
          </div>
          {running ? (
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${Math.max(8, progressPct)}%` }}
              />
            </div>
          ) : null}
          <ol className="space-y-2 text-sm">
            {steps.map((s, i) => (
              <li
                key={`${s.step}-${i}`}
                className={cn(
                  "flex flex-col gap-0.5",
                  i === steps.length - 1 && running
                    ? "text-foreground"
                    : "text-muted-foreground",
                )}
              >
                <span className="flex items-center gap-2">
                  {i === steps.length - 1 && running ? (
                    <Loader2 className="size-3.5 shrink-0 animate-spin" />
                  ) : (
                    <span className="size-3.5 shrink-0 text-center text-xs">
                      ✓
                    </span>
                  )}
                  {s.message}
                  {s.current != null && s.total != null ? (
                    <span className="tabular-nums text-muted-foreground">
                      ({s.current}/{s.total})
                    </span>
                  ) : null}
                </span>
                {s.detail ? (
                  <span className="pl-5 text-xs text-muted-foreground">
                    {s.detail}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          {activeStep?.step === "error" && !running ? (
            <p className="mt-2 text-xs text-destructive">
              Try again or adjust keywords.
            </p>
          ) : null}
        </output>
      ) : null}
    </div>
  );
}
