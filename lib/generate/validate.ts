import { unknownBrackets, words } from "@/lib/text";

export type Issue = { code: "near_copy" | "placeholder" | "names"; message: string; items: string[] };
export type Validation = { errors: Issue[]; warnings: Issue[] };
export type ValidationContext = { notes: string; corpus: string[] };

/** Strips wrapping quotes and "Here's a tweet:" style preambles; normalizes Unicode. */
export function cleanup(raw: string): string {
  let t = raw.normalize("NFC").trim();
  t = t.replace(/^(?:here(?:'|’)?s|here is)[^\n:]{0,40}:\s*\n?/i, "").trim();
  if (/^["“].*["”]$/s.test(t)) t = t.slice(1, -1).trim();
  return t;
}

const shingles = (ws: string[], n = 8) => new Set(ws.slice(0, Math.max(0, ws.length - n + 1)).map((_, i) => ws.slice(i, i + n).join(" ")));

/** True if the draft copies a corpus post: a shared 8-word run, or word-set Jaccard >= 0.6. */
export function nearCopy(text: string, corpus: string[]): string | null {
  const ws = words(text);
  const sh = shingles(ws);
  const set = new Set(ws);
  for (const post of corpus) {
    const pw = words(post);
    if ([...shingles(pw)].some((s) => sh.has(s))) return post;
    const ps = new Set(pw);
    const inter = [...set].filter((w) => ps.has(w)).length;
    if (set.size >= 5 && inter / (set.size + ps.size - inter) >= 0.6) return post;
  }
  return null;
}

const NAME = /\b[A-Z][\p{L}'’]+(?:\s+[A-Z][\p{L}'’]+)+/gu;

export function validate(text: string, { notes, corpus }: ValidationContext): Validation {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const copied = nearCopy(text, corpus);
  if (copied) errors.push({ code: "near_copy", message: "Too close to one of their existing posts; write something new.", items: [copied] });
  const brackets = unknownBrackets(text);
  if (brackets.length) errors.push({ code: "placeholder", message: "Only the allowed placeholders may appear in brackets.", items: brackets });
  const known = `${notes}\n${corpus.join("\n")}`.toLowerCase();
  const names = (text.match(NAME) ?? []).filter((n) => !known.includes(n.toLowerCase()));
  if (names.length) warnings.push({ code: "names", message: "Check these names: they are not in your notes or past posts.", items: names });
  return { errors, warnings };
}
