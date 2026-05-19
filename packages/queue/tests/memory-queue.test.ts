import { describe, expect, it } from "vitest";
import { MemoryQueue } from "../src/index.js";

describe("MemoryQueue", () => {
  it("enqueue runs handler when consumer registered first", async () => {
    const q = new MemoryQueue();
    const seen: unknown[] = [];
    using _ = q.consume("echo", async (p: string) => {
      seen.push(p);
    });
    await q.enqueue("echo", "hi");
    expect(seen).toEqual(["hi"]);
  });

  it("backlog drains when consumer registers after enqueue", async () => {
    const q = new MemoryQueue();
    await q.enqueue("later", 1);
    const seen: number[] = [];
    using _ = q.consume("later", async (n: number) => {
      seen.push(n);
    });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(seen).toEqual([1]);
  });

  it("idempotency key suppresses duplicate handler runs", async () => {
    const q = new MemoryQueue();
    let n = 0;
    using _ = q.consume("j", async () => {
      n++;
    });
    await q.enqueue("j", {}, { idempotencyKey: "k" });
    await q.enqueue("j", {}, { idempotencyKey: "k" });
    expect(n).toBe(1);
  });
});
