import { openai } from "@ai-sdk/openai";

/**
 * The single place V2 AI features pick a model. CLAUDE.md §3 commits to
 * `@ai-sdk/openai`; `AI_MODEL` can override the default without a code change,
 * and swapping providers later means editing only this file.
 */
export function defaultModel() {
  return openai(process.env.AI_MODEL ?? "gpt-4o-mini");
}
