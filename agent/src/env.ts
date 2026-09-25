import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.startsWith("REPLACE_ME")) {
    throw new Error(
      `Missing environment variable ${name}. Copy agent/.env.example to agent/.env and fill it in.`,
    );
  }
  return v;
}

function optional(name: string): string | null {
  const v = process.env[name];
  return !v || v.startsWith("REPLACE_ME") ? null : v;
}

/**
 * Secrets are read here, on the server, and used inside tool code. They are
 * never placed in the agent's context — so there is nothing for an injected
 * "export your API keys" instruction to reach.
 */
export const env = {
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  sharedSecret: required("AGENT_SHARED_SECRET"),
  port: Number(process.env.PORT ?? 8787),

  // Null until the actor's pricing has been confirmed in the Apify Console.
  // While null, discovery runs against fixtures and spends nothing.
  apifyToken: optional("APIFY_TOKEN"),
  apifyActorId: optional("APIFY_ACTOR_ID"),
  firecrawlApiKey: optional("FIRECRAWL_API_KEY"),

  // Explicit opt-in to spending real money. A key merely BEING present is not
  // consent to spend — a token gets pasted in early, or left over from another
  // project, long before anyone has checked what an actor costs. The Apify
  // budget is pooled and shared, so overspending takes it from someone else.
  // Both of these must be literally "true" before a live call is made.
  apifyLive: process.env.APIFY_LIVE === "true",
  firecrawlLive: process.env.FIRECRAWL_LIVE === "true",

  workerId: `agent-${process.pid}`,

  // Milestone emails (drafts ready, search finished) are no longer sent
  // directly from this process — Render's outbound network could not reach
  // Gmail's SMTP servers at all (confirmed via Render's own logs). notify.ts
  // now POSTs the send request to the web app's own /api/internal/notify
  // instead, authenticated with sharedSecret (the same token already used
  // for web -> agent calls, reused here for the reverse direction). Null
  // (not configured) means notify.ts silently skips, same fail-soft posture
  // as before — a notification failing must never block real work.
  webAppUrl: optional("WEB_APP_URL"),
};

export const liveDiscovery = env.apifyLive && Boolean(env.apifyToken && env.apifyActorId);
export const liveScraping = env.firecrawlLive && Boolean(env.firecrawlApiKey);

// Say plainly, at boot, which mode each provider is in. A run that quietly
// spent money because of an env var nobody remembered setting is worse than a
// noisy one that did not.
export function describeProviders(): string {
  const apify = liveDiscovery
    ? "Apify: LIVE — real actor runs will be billed"
    : env.apifyToken && env.apifyActorId
      ? "Apify: fixtures (set APIFY_LIVE=true to spend)"
      : "Apify: fixtures (no token/actor configured)";
  const firecrawl = liveScraping
    ? "Firecrawl: LIVE — real scrapes will use your quota"
    : env.firecrawlApiKey
      ? "Firecrawl: fixtures (set FIRECRAWL_LIVE=true to spend)"
      : "Firecrawl: fixtures (no key configured)";
  return `${apify}
${firecrawl}`;
}
