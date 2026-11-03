import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerBusinessDiscoveryPrompt(server: McpServer): void {
  server.registerPrompt(
    "business_discovery",
    {
      title: "Discover Avalanche businesses",
      description:
        "Find businesses operating on Avalanche that show real adoption, using Snowline records and their evidence fields.",
      argsSchema: {
        sector: z
          .string()
          .min(1)
          .max(120)
          .optional()
          .describe(
            "Optional sector or category to focus on, e.g. 'DeFi & Infrastructure', 'Tokenized RWA', 'Enterprise Software'."
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("How many businesses to surface. Defaults to 10."),
      },
    },
    ({ sector, limit }) => {
      const count = limit ?? 10;
      const scope = sector
        ? `in the "${sector}" category`
        : "across all categories";

      const text = `Find up to ${count} Avalanche businesses ${scope} that show real signs of operating, and justify each one.

Method:
1. Call \`snowline_local_businesses\` with the \`category\` filter when one is given, otherwise list broadly.
2. For each candidate, call \`snowline_local_businesses\` again with its \`slug\` to read the full profile.
3. Call \`snowline_local_latest_intel\` with that business name to find its recent milestones.
4. Use \`snowline_local_search\` to look for related activity you may have missed.

What counts as evidence of a real business:
- A working \`websiteUrl\` or \`sourceUrl\`, and an official presence.
- Recent updates in \`snowline_local_latest_intel\` that link to a source.
- A credible \`valuationSource\` and a populated \`marketCapUsd\` where the entity is public.

What does not count on its own:
- A large or rising token price.
- A listing in the directory with no activity behind it.
- An announcement with no source link.

For each business report: name, slug, category, what it actually does, the concrete evidence you found with its source
link, \`verified\` status, and a one-line reason it qualifies. End with a short list of candidates you rejected and why.`;

      return {
        description: `Discover Avalanche businesses${sector ? ` in ${sector}` : ""} with real adoption evidence.`,
        messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
      };
    }
  );
}
