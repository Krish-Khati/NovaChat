/**
 * Local, static product data. No network, no keys, no fake AI output.
 * lib/mock was deleted in Phase 2 — everything user-facing here is either
 * real configuration (models, voices) or static UI content (prompt cards).
 */

/* Groq models exposed in settings (per Phase 2 spec). */
export const GROQ_MODELS = [
  {
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    description: "Default · strongest reasoning",
  },
  {
    id: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B",
    description: "Fastest · everyday answers",
  },
] as const;

/**
 * Cartesia voice catalog. Voice IDs are Cartesia public library IDs.
 * The first entry is the docs-canonical example voice — guaranteed shape,
 * safe default. The others were carried over from Phase 1 and are UNVERIFIED
 * on a given account; swap in IDs from https://play.cartesia.ai/voices as
 * needed (they are just strings).
 */
export const CARTESIA_VOICES = [
  { id: "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4", name: "Library Default", tone: "Warm · measured · US" },
  { id: "a0e99841-438c-4a64-b679-ae682c38ff84", name: "Mia", tone: "Bright & energetic · US" },
  { id: "156fb8d2-335b-495e-9df1-2a26a2f70022", name: "Leo", tone: "Deep & calm · US" },
  { id: "f786b574-daa5-4673-aa0c-cbe3e8534c02", name: "Sophie", tone: "Warm & clear · US" },
  { id: "614d0d61-2bac-4069-9a8b-161e6a8be21f", name: "Daniel", tone: "British · refined" },
  { id: "793be5e0-3121-4a1b-a62d-6a9bd4e3e88e", name: "Arushi", tone: "Soft & reassuring · IN" },
] as const;

export const DEFAULT_MODEL = GROQ_MODELS[0].id;
export const DEFAULT_VOICE_ID = CARTESIA_VOICES[0].id;

export const SUGGESTED_PROMPTS = [
  {
    id: "s1",
    icon: "Compass",
    title: "Plan my week",
    prompt: "Plan a realistic week for me: deep work mornings, two meetings max per day, and Fridays for shipping. Ask me what's on my plate first.",
  },
  {
    id: "s2",
    icon: "Code2",
    title: "Review my code",
    prompt: "Review this TypeScript function for edge cases and suggest a more robust signature:\n\n```ts\nasync function load(id) {\n  const r = await fetch('/api/' + id)\n  return r.json()\n}\n```",
  },
  {
    id: "s3",
    icon: "Newspaper",
    title: "Catch me up",
    prompt: "What are the most important AI developments this week? Search the web and cite your sources.",
  },
  {
    id: "s4",
    icon: "PenLine",
    title: "Draft an email",
    prompt: "Draft a short, warm email to my team: we're moving the standup to 9:30, decision needed by Thursday, keep it under 120 words.",
  },
] as const;
