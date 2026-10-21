import { PLACEHOLDER_RE } from "@/lib/text";

/** What the generator says belongs in a placeholder: "[your metric]" → "hours spent checking the agent's output". */
export type PlaceholderHint = { placeholder: string; hint: string };

const HINTED_RE = /\[(your number|your metric|date|name|company|link)\s*:\s*([^\]\n]{1,160})\]/gi;

/** Moves inline hints ("[your metric: hours saved]") out of the text, so every check and the card see "[your metric]". */
export function splitHints(text: string): { text: string; hints: PlaceholderHint[] } {
  const hints: PlaceholderHint[] = [];
  const clean = text.replace(HINTED_RE, (_, label: string, hint: string) => {
    const placeholder = `[${label.toLowerCase()}]`;
    hints.push({ placeholder, hint: hint.trim() });
    return placeholder;
  });
  return { text: clean, hints };
}

/** For each placeholder in `text`, in order: the index of the first unused hint for the same placeholder (-1 = none). */
function assign(text: string, hints: PlaceholderHint[]): number[] {
  const used = new Set<number>();
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => {
    const i = hints.findIndex((h, j) => !used.has(j) && h.placeholder === m[0].toLowerCase());
    if (i >= 0) used.add(i);
    return i;
  });
}

export const hintsFor = (text: string, hints: PlaceholderHint[]) => assign(text, hints).map((i) => hints[i]?.hint ?? null);

/** Replaces the index-th placeholder with `value` and drops its hint; null if there is no such placeholder. */
export function withFilled(text: string, hints: PlaceholderHint[], index: number, value: string) {
  const m = [...text.matchAll(PLACEHOLDER_RE)][index];
  if (!m) return null;
  const used = assign(text, hints)[index];
  return { text: text.slice(0, m.index) + value + text.slice(m.index + m[0].length), hints: hints.filter((_, j) => j !== used) };
}
