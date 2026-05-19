/**
 * Vitest reporter: after failed scraper-related runs, suggest `pnpm fixtures:recover`.
 * @implements {import("vitest/reporters").Reporter}
 */
export default class FixtureRecoverHintReporter {
  onTestRunEnd(testModules, _unhandledErrors, reason) {
    if (reason !== "failed") return;
    const failedScraper = testModules.some((m) => {
      if (m.state() !== "failed") return false;
      const fp = m.task?.filepath;
      if (typeof fp !== "string") return false;
      const n = fp.replaceAll("\\", "/");
      return n.includes("packages/scraper");
    });
    if (!failedScraper) return;
    console.error(
      "\n[clearbolt] Scraper tests failed — fixture HTML may have drifted. After backing up anything you need, run:\n  pnpm fixtures:recover\n",
    );
  }
}
