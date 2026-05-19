import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function promptLine(
  question: string,
  defaultValue?: string,
): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const suffix =
      defaultValue !== undefined && defaultValue !== ""
        ? ` [${defaultValue}]`
        : "";
    const raw = (await rl.question(`${question}${suffix}: `)).trim();
    if (!raw && defaultValue !== undefined) return defaultValue;
    return raw;
  } finally {
    rl.close();
  }
}

export async function promptChoice<T extends string>(
  title: string,
  choices: ReadonlyArray<{ value: T; label: string; hint?: string }>,
  defaultValue?: T,
): Promise<T> {
  console.log(`\n${title}`);
  for (let i = 0; i < choices.length; i++) {
    const c = choices[i]!;
    const mark = c.value === defaultValue ? "*" : " ";
    const hint = c.hint ? ` — ${c.hint}` : "";
    console.log(`  ${mark} ${i + 1}. ${c.label}${hint}`);
  }
  const defaultIndex =
    defaultValue !== undefined
      ? choices.findIndex((c) => c.value === defaultValue)
      : -1;
  const defaultNum = defaultIndex >= 0 ? String(defaultIndex + 1) : undefined;

  for (;;) {
    const raw = await promptLine("Choose number", defaultNum);
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n) || n < 1 || n > choices.length) {
      console.log(`Enter 1–${choices.length}`);
      continue;
    }
    return choices[n - 1]!.value;
  }
}

export async function promptYesNo(
  question: string,
  defaultYes = false,
): Promise<boolean> {
  const def = defaultYes ? "Y/n" : "y/N";
  const raw = (await promptLine(`${question} (${def})`, defaultYes ? "y" : "n"))
    .trim()
    .toLowerCase();
  if (!raw) return defaultYes;
  return raw === "y" || raw === "yes";
}

export function stdinIsInteractive(): boolean {
  return Boolean(input.isTTY && output.isTTY);
}
