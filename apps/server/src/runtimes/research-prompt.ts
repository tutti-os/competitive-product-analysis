import { SKILL_SLUG } from "./skill-loader.js";

import type { ResearchRunContext } from "./runtime-provider.js";

const SKILL_REL_DIR = `.local-agent/skills/${SKILL_SLUG}`;

/**
 * System prompt: frame the agent as the research operator that runs the
 * product-swipefile skill from the current run directory and leaves its
 * evidence-backed artifacts on disk for the app to capture.
 */
export function buildResearchSystemPrompt(context: ResearchRunContext): string {
  const python = context.pythonBin || "python3";
  return [
    "You are the research operator for Competitive Analysis, a local-first product-research workspace.",
    'Your job: when the user asks to research/analyze a product (e.g. "调研一下 Notion" or "research Cursor"), run a deep, evidence-backed product teardown using the bundled product-swipefile skill, and leave the resulting Markdown artifacts on disk.',
    "",
    "## The skill",
    `The product-swipefile skill is materialized at \`${SKILL_REL_DIR}/\` relative to your current working directory.`,
    `Always start by reading \`${SKILL_REL_DIR}/SKILL.md\` for its mandatory staged pipeline (evidence collection → inventory → gap checks → writing → validation) and hard constraints (evidence-traceable, no hallucination, no table-dumping).`,
    "Important host override: you are already the exact Agent Target selected for this stage. Do not execute the skill root `run.py`, do not invoke any agent-provider CLI, and do not launch any other provider-specific or nested agent process. Evidence tools such as opencli remain allowed during Stage 1.",
    "The host enforces stage isolation by launching Stage 1 and Stage 2 as separate fresh agent invocations. Obey the stage contract in the turn envelope and stop after completing only that stage.",
    `For deterministic operations, use only the provider-agnostic \`${SKILL_REL_DIR}/scripts/research_helper.py\` helpers from inside the scripts directory (so the \`product_research\` package imports resolve), with \`${python}\`. For example: \`cd ${SKILL_REL_DIR}/scripts && ${python} research_helper.py new-run --product \"<name>\" --root \"<run_cwd>\"\`, where \`<run_cwd>\` is the absolute run_cwd value given in the turn envelope below. Perform collection and writing directly with your current tools, applying the same stage gates and validation helpers.`,
    "",
    "## Output location (important)",
    'Keep every artifact inside the run_cwd directory given in the turn envelope so the app can capture it. When creating the run directory with `new-run`, always pass `--root "<run_cwd>"` using that absolute path — never the skill folder and never a home-directory default.',
    "The canonical deliverable is `report.md`. Also produce `inventory.md`, `meta.json`, and the `raw/` evidence cache as the skill specifies, all under run_cwd.",
    "Do not export to Obsidian/Notion/Feishu unless the user explicitly asks; the local Markdown artifacts are the deliverable here.",
    "",
    "## Conversation behavior",
    "Your streamed text is shown live in a chat thread. Keep it concise: briefly narrate what you're doing and, at the end, hand off with where the report lives, the product covered, and any evidence/source gaps that affected conclusions. Do not paste the full report into chat — it is saved as report.md.",
    "If the user's message is small talk or not a concrete product-research request, respond conversationally and ask for the product to research instead of running the full pipeline.",
    "Work decisively and avoid stalling; if a tool (e.g. opencli) is unavailable, fall back to web search as the skill describes and note the coverage gap.",
  ].join("\n");
}

/**
 * The per-turn user prompt: a thin envelope around the user's message plus the
 * run identity. The skill itself owns the heavy research instructions.
 */
export function buildResearchPrompt(context: ResearchRunContext): string {
  const python = context.pythonBin || "python3";
  return [
    "<research_turn>",
    `run_id: ${context.runId}`,
    `session_id: ${context.sessionId}`,
    `run_cwd: ${context.cwd}`,
    "</research_turn>",
    ...(context.resuming
      ? [
          "",
          "<continuation>",
          "This session has an in-progress research run whose working directory was preserved at run_cwd. Do NOT start a fresh new-run by default — resume the existing run so already-collected evidence is not thrown away.",
          `1. Find the existing run directory under run_cwd (it contains run.json/meta.json, typically run_cwd/<product_slug>/<timestamp>/). Run \`cd ${SKILL_REL_DIR}/scripts && ${python} research_helper.py stage-status --run-dir "<that dir>"\` to get the mechanical next_stage.`,
          "2. Continue from next_stage: reuse the existing inventory.md and raw/ evidence, and only collect what is still missing. Do not re-run searches for evidence that is already frozen.",
          "3. Only create a new run with new-run if no existing run directory is found, or if the user's new message is clearly about a different product than the in-progress run.",
          "</continuation>",
        ]
      : []),
    "",
    "<user_message>",
    context.prompt,
    "</user_message>",
  ].join("\n");
}

export function buildStage1Prompt(context: ResearchRunContext): string {
  return [
    buildResearchPrompt(context),
    "",
    "<host_stage_contract>",
    "stage: stage1_collect_and_freeze",
    "Complete evidence collection, raw caching, inventory.md, validate-inventory, and checkpoint_stage1.md only.",
    "Do not write report.md. The host will start a separate fresh Agent invocation for Stage 2 after the checkpoint exists.",
    "</host_stage_contract>",
  ].join("\n");
}

export function buildStage2Prompt(context: ResearchRunContext, checkpointPath: string): string {
  return [
    "<research_turn>",
    `run_id: ${context.runId}`,
    `session_id: ${context.sessionId}`,
    `run_cwd: ${context.cwd}`,
    "</research_turn>",
    "",
    "<user_message>",
    context.prompt,
    "</user_message>",
    "",
    "<host_stage_contract>",
    "stage: stage2_write_from_frozen_evidence",
    `stage1_checkpoint: ${checkpointPath}`,
    "This is a fresh Agent invocation. Read checkpoint_stage1.md, the frozen inventory.md, references/writing.md, and only the raw files referenced by inventory.md.",
    "Do not use WebSearch, WebFetch, opencli, conversation history, or unrecorded Stage 1 reasoning. Do not modify inventory.md or collect new facts.",
    "Write report.md, run validate-report, and create checkpoint_stage2.md. If an essential evidence gap remains, write stage2_collection_gap.md and stop instead of inventing facts.",
    "</host_stage_contract>",
  ].join("\n");
}
