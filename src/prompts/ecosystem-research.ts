import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * A research prompt that steers an agent toward evidence rather than hype.
 *
 * The wording is deliberate: it names the tool calls to make, and it states
 * what must *not* be treated as proof. Avalanche has a long tail of projects
 * whose only signal is an announcement, so the prompt forces the distinction.
 */
export function registerEcosystemResearchPrompt(server: McpServer): void {
  server.registerPrompt(
    "ecosystem_research",
    {
      title: "Research the Avalanche ecosystem",
      description:
        "Produce an evidence-based brief on Avalanche ecosystem activity using Snowline data, separating verified activity from announcements.",
      argsSchema: {
        topic: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe("Optional subject to focus on, e.g. 'tokenized treasuries' or 'gaming L1s'."),
        depth: z
          .enum(["brief", "standard", "deep"])
          .optional()
          .describe("How much evidence to gather. Defaults to 'standard'."),
      },
    },
    ({ topic, depth }) => {
      const level = depth ?? "standard";
      const scope = topic ?? "the Avalanche ecosystem";

      const text = `Research ${scope} using the Snowline MCP tools, then write an evidence-based brief.

Depth: ${level}.

Method — use the tools, do not rely on prior knowledge:
1. Call \`snowline_local_search\` to find candidate businesses, projects and updates. Start broad, then narrow.
2. Call \`snowline_local_businesses\` and \`snowline_local_projects\` for profiles of the candidates worth keeping.
3. Call \`snowline_local_latest_intel\` for recent milestones, and \`snowline_local_network_stats\` plus
   \`snowline_local_chains\` for network context — an L1 with real \`txCount24h\` and \`activeAddresses24h\` is active;
   one that merely exists is not.
4. Call \`snowline_local_builders\` only when a named person is load-bearing for the claim.
5. If you need an endpoint none of the above covers, call \`snowline_local_api\` with no arguments to list every
   documented endpoint, then call it with that path.

Rules for the output:
- Prioritise entities with a real product and a working link over entities with only a listing.
- Cite the \`sourceUrl\`, \`sourceArticles\` or \`officialUrl\` for every factual claim. An update with no source link is
  a weak signal and must be labelled as such.
- Use \`verified\` from the records. Label anything with \`verified: false\` as unverified rather than dropping it silently.
- Report \`priceAsOf\` alongside any token price, and \`meta.asOf\` alongside any network figure. If \`meta.stale\` is true,
  say the snapshot is stale.
- Do not treat a token price rise, a marketing announcement, or a partnership claim as evidence of adoption.
- Where Snowline returns no data, write "no Snowline data" instead of inferring.

Return: a short summary, then the entities that hold up, each with its evidence and source link, then a section listing
what could not be verified.`;

      return {
        description: `Evidence-based Avalanche ecosystem research${topic ? ` on ${topic}` : ""}.`,
        messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
      };
    }
  );
}
