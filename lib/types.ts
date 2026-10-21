import type { FormulaId, Goal } from "@/lib/angles";
import type { Issue } from "@/lib/generate/validate";
import type { Tell } from "@/lib/judge/tells";
import type { RuleKind, RuleParams, RuleStatus } from "@/lib/learning/rules";
import type { VoiceMatch } from "@/lib/profile/voice-match";

export type DraftArm = "normal" | "learned" | "baseline";
export type DraftState = { thumbs: "up" | "down" | null; copied: boolean; picked: boolean };

export type ClientDraft = {
  id: string;
  batchId: string;
  idx: number;
  arm: DraftArm;
  formula: FormulaId;
  angle: string;
  text: string;
  kept: string | null;
  tells: Tell[];
  voiceMatch: VoiceMatch;
  warnings: Issue[];
  /** The original text when the humanizer rewrote this draft; `tells` describe this original. */
  humanizedFrom: string | null;
  why: { rules: string[]; examples: string[]; promptVersion: string; model: string };
  state: DraftState;
};

export type AbChoice = "a" | "b" | "tie" | "neither";

export type ClientBatch = {
  id: string;
  kind: "normal" | "ab";
  goal: Goal | "any";
  topic: string | null;
  notes: string;
  createdAt: string;
  drafts: ClientDraft[];
  /** For A/B batches once answered: the choice, and which arm each position was. */
  ab: { choice: AbChoice; arms: DraftArm[] } | null;
};

export type ClientRule = {
  id: string;
  kind: RuleKind;
  params: RuleParams;
  text: string;
  status: RuleStatus;
  evidenceCount: number;
  evidence: { removed: string; added: string }[];
  source: "edit" | "manual";
  archivedReason: string | null;
};

export type LearnedReceipt = { created: ClientRule[]; strengthened: ClientRule[]; contradicted: ClientRule[] };

/** NDJSON events streamed by /api/voices and /api/voices/[id]/generate. */
export type StreamEvent =
  | { type: "progress"; step: string }
  | { type: "batch"; batch: Omit<ClientBatch, "drafts">; angles: { idx: number; formula: FormulaId; angle: string }[] }
  | { type: "delta"; idx: number; d: string }
  | { type: "text"; idx: number; text: string }
  | { type: "draft"; idx: number; draft: ClientDraft }
  | { type: "draft_error"; idx: number; message: string }
  | { type: "done"; voiceId?: string }
  | { type: "error"; message: string; kind?: string };
