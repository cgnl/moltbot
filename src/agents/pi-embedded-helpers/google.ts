import { sanitizeGoogleTurnOrdering } from "./bootstrap.js";

export function isGoogleModelApi(api?: string | null): boolean {
  return (
    api === "google-gemini-cli" || api === "google-generative-ai" || api === "google-antigravity"
  );
}

export function isAntigravityClaude(params: {
  api?: string | null;
  provider?: string | null;
  modelId?: string;
}): boolean {
  const provider = params.provider?.toLowerCase();
  const api = params.api?.toLowerCase();
  // Always treat google-antigravity as needing thinking-block sanitization
  // to avoid "thinking.signature required" errors on tool-calls (bridge bug)
  if (provider === "google-antigravity" || api === "google-antigravity") return true;
  return false;
}

export { sanitizeGoogleTurnOrdering };
