/**
 * Resend provisioning helpers (fetch API — no extra npm deps).
 * Bootstrap: RESEND_BOOTSTRAP_API_KEY or RESEND_API_KEY (full_access) in env.
 */

/** @param {'dev'|'staging'|'prod'} tag */
export function resendApiKeyName(tag) {
  return `clearbolt-${tag}`;
}

/**
 * @param {'dev'|'staging'|'prod'} tag
 * @param {NodeJS.ProcessEnv} [env]
 */
export function defaultAuthEmailFrom(tag, env = process.env) {
  const override = env.AUTH_EMAIL_FROM?.trim() || env.RESEND_AUTH_FROM?.trim();
  if (override) return override;
  if (tag === "dev") return "Clearbolt <onboarding@resend.dev>";
  const domain = env.RESEND_FROM_DOMAIN?.trim();
  if (domain) return `Clearbolt <noreply@${domain}>`;
  return null;
}

/**
 * @param {string} path
 * @param {{ method?: string, bootstrapKey: string, body?: object }} opts
 */
export async function resendApi(path, { method = "GET", bootstrapKey, body }) {
  const res = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${bootstrapKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  /** @type {unknown} */
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    const msg =
      json &&
      typeof json === "object" &&
      json !== null &&
      "message" in json &&
      typeof json.message === "string"
        ? json.message
        : text.slice(0, 400);
    throw new Error(`Resend ${method} ${path}: ${res.status} ${msg}`);
  }
  return json;
}

/**
 * @param {'dev'|'staging'|'prod'} tag
 * @param {{ dryRun: boolean, bootstrapKey?: string, existingSendingKey?: string }} opts
 */
export async function provisionResendApiKey(tag, opts) {
  const name = resendApiKeyName(tag);
  const from = defaultAuthEmailFrom(tag);

  if (opts.dryRun) {
    return {
      name,
      apiKey: "re_…",
      from,
      created: false,
      skipped: false,
    };
  }

  const bootstrap = opts.bootstrapKey?.trim();
  if (!bootstrap) {
    return {
      name,
      apiKey: opts.existingSendingKey?.trim() || null,
      from,
      created: false,
      skipped: true,
    };
  }

  const list = /** @type {{ data?: { name?: string }[] }} */ (
    await resendApi("/api-keys", { bootstrapKey: bootstrap })
  );
  const exists = list.data?.some((k) => k.name === name);

  if (exists) {
    const kept = opts.existingSendingKey?.trim() || null;
    return {
      name,
      apiKey: kept,
      from,
      created: false,
      skipped: false,
      exists: true,
    };
  }

  const created = /** @type {{ token?: string }} */ (
    await resendApi("/api-keys", {
      method: "POST",
      bootstrapKey: bootstrap,
      body: { name, permission: "sending_access" },
    })
  );
  const token = created.token?.trim();
  if (!token) {
    throw new Error("Resend api-keys create did not return a token");
  }
  return {
    name,
    apiKey: token,
    from,
    created: true,
    skipped: false,
    exists: false,
  };
}
