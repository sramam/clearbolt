import { getClearboltAuth } from "@clearbolt/auth/server";
import { toNextJsHandler } from "better-auth/next-js";

const auth = getClearboltAuth();

const handlers = auth
  ? toNextJsHandler(auth)
  : {
      GET: () =>
        new Response(
          JSON.stringify({
            error: "Auth not configured (DATABASE_URL + BETTER_AUTH_SECRET)",
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      POST: () =>
        new Response(
          JSON.stringify({
            error: "Auth not configured (DATABASE_URL + BETTER_AUTH_SECRET)",
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
    };

export const { GET, POST } = handlers;
