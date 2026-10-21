import { diffWords } from "diff";
import { isPlaceholder } from "@/lib/text";

export type Hunk = { id: number; removed: string; added: string; before: string; after: string };

const tail = (s: string, n = 5) => s.trim().split(/\s+/).slice(-n).join(" ");
const head = (s: string, n = 5) => s.trim().split(/\s+/).slice(0, n).join(" ");

/** Word-level edit hunks between what we showed and what the user kept. Placeholder fills are not edits. */
export function hunks(shown: string, kept: string): Hunk[] {
  const parts = diffWords(shown, kept);
  const out: Hunk[] = [];
  let cur: Omit<Hunk, "id" | "after"> | null = null;
  let lastSame = "";
  for (const p of parts) {
    if (!p.added && !p.removed) {
      if (cur) out.push({ ...cur, id: out.length + 1, after: head(p.value) });
      cur = null;
      lastSame = p.value;
      continue;
    }
    cur ??= { removed: "", added: "", before: tail(lastSame) };
    if (p.removed) cur.removed += p.value;
    else cur.added += p.value;
  }
  if (cur) out.push({ ...cur, id: out.length + 1, after: "" });
  return out
    .map((h) => ({ ...h, removed: h.removed.trim(), added: h.added.trim() }))
    .filter((h) => !isPlaceholder(h.removed))
    .map((h, i) => ({ ...h, id: i + 1 }));
}

const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/** Share of words changed (0 = kept as-is, 1 = rewritten), ignoring placeholder fills. */
export function editBurden(shown: string, kept: string): number {
  const changed = hunks(shown, kept).reduce((n, h) => n + wordCount(h.removed) + wordCount(h.added), 0);
  const total = wordCount(shown) + wordCount(kept);
  return total ? Math.min(1, changed / total) : 0;
}
