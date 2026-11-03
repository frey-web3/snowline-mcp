import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerProjectAnalysisPrompt(server: McpServer): void {
  server.registerPrompt(
    "project_analysis",
    {
      title: "Analyse an Avalanche project",
      description:
        "Analyse one Avalanche project from its Snowline profile, activity, milestones and supporting sources.",
      argsSchema: {
        project: z
          .string()
          .min(1)
          .max(120)
          .describe("Project slug or name to analyse, e.g. 'Team1FR'."),
        question: z
          .string()
          .min(1)
          .max(300)
          .optional()
          .describe("Optional specific question the analysis should answer."),
      },
    },
    ({ project, question }) => {
      const text = `Analyse the Avalanche project "${project}" using Snowline data.${
        question ? `\n\nAnswer this specific question: ${question}` : ""
      }

Method:
1. Call \`snowline_local_projects\` with \`slug: "${project}"\` for the profile. If that returns nothing, call
   \`snowline_local_search\` first to resolve the correct slug, and say so rather than guessing.
2. Call \`snowline_local_latest_intel\` filtered to this project or its business for recent milestones.
3. Call \`snowline_local_tokens\` only if the project has a token, and read \`priceAsOf\` and \`liquidityUsd\`, not just price.
4. Call \`snowline_local_builders\` if named people matter to the assessment.

Structure the analysis as:
- **What it is** — description and category, taken from the record.
- **Activity** — what Snowline shows it has actually shipped, with dates and source links.
- **Evidence quality** — which claims trace to a source link, and which rest on an announcement alone.
- **Token** — if applicable, market data with \`priceAsOf\`, and an explicit note that price is third-party market data,
  not a Snowline-verified fact.
- **Verification status** — the \`verified\` flag as published.
- **What is unknown** — gaps in the Snowline data. Do not fill them with assumptions or outside recollection.

Do not describe the project as promising, strong or legitimate on the basis of token performance or marketing copy.
Base every sentence on a field Snowline actually returned.`;

      return {
        description: `Analyse the Avalanche project "${project}" from Snowline data.`,
        messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
      };
    }
  );
}
