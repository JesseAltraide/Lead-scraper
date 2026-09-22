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

  workerId: `agent-${process.pid}`,
};

export const liveDiscovery = Boolean(env.apifyToken && env.apifyActorId);
export const liveScraping = Boolean(env.firecrawlApiKey);
