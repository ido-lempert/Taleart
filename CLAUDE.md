<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# Delegating Small Tasks to Haiku Sub-Agents

- Always delegate small, well-scoped tasks (e.g. lookups, searches, simple edits, running a command and summarizing output) to a sub-agent using the Agent tool with `model: "haiku"`, whenever possible.
- The sub-agent returns its results to the main agent; it does not report directly to the user.
- The main agent reviews each result and judges it as one of:
  - **Done** — accept it and use it in the answer.
  - **Needs improvement** — send follow-up instructions to the same sub-agent (SendMessage) to refine it.
  - **Rework** — the result is wrong or off-target; re-run the task with clearer instructions (or do it directly if delegation keeps failing).
- Keep larger, ambiguous, or judgment-heavy tasks (architecture, design decisions, final answers) in the main agent.

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax


<!-- nx configuration end-->