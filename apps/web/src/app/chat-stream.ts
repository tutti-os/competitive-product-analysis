import type { AgentRunEvent, ContentBlock } from "@product-competition/shared";

/**
 * Fold a streaming run event into an assistant message's contentBlocks. Pure
 * and immutable so React can diff cheaply — mirrors the server-side accumulator
 * so a live thread and a reloaded thread render identically.
 */
export function applyEventToBlocks(blocks: ContentBlock[], event: AgentRunEvent): ContentBlock[] {
  switch (event.type) {
    case "text_delta":
      return appendText(blocks, event.text);
    case "thinking_delta":
      return appendThinking(blocks, event.text);
    case "status":
      return markThinkingDone(blocks);
    case "tool_call":
      return [...markThinkingDone(blocks), {
        type: "tool",
        toolCallId: event.id,
        name: event.name,
        status: "running",
        ...(event.input !== undefined ? { input: event.input } : {}),
      }];
    case "tool_result":
      return blocks.map((block) =>
        block.type === "tool" && block.toolCallId === event.id
          ? {
              ...block,
              status: event.status === "failed" ? "failed" : "completed",
              ...(event.name ? { name: event.name } : {}),
              ...(event.summary ? { summary: event.summary } : {}),
              ...(event.output !== undefined ? { output: event.output } : {}),
            }
          : block,
      );
    default:
      return blocks;
  }
}

function appendText(blocks: ContentBlock[], text: string): ContentBlock[] {
  const last = blocks[blocks.length - 1];
  if (last && last.type === "text") {
    return [...blocks.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...markThinkingDone(blocks), { type: "text", text }];
}

function appendThinking(blocks: ContentBlock[], text: string): ContentBlock[] {
  const last = blocks[blocks.length - 1];
  if (last && last.type === "thinking" && !last.done) {
    return [...blocks.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...blocks, { type: "thinking", text }];
}

function markThinkingDone(blocks: ContentBlock[]): ContentBlock[] {
  const last = blocks[blocks.length - 1];
  if (last && last.type === "thinking" && !last.done) {
    return [...blocks.slice(0, -1), { ...last, done: true }];
  }
  return blocks;
}
