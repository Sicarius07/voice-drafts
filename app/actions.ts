"use server";

import { z } from "zod";
import { RULE_KIND_IDS, type RuleKind, type RuleParams } from "@/lib/learning/rules";
import { FEEDBACK_TYPES, type FeedbackType } from "@/lib/learning/signals";
import type { AbChoice } from "@/lib/types";
import { getUser } from "@/server/auth";
import { UserError } from "@/server/services/context";
import * as learning from "@/server/services/learning";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Runs `fn` for the signed-in user. Errors come back as values (Next redacts thrown messages in production). */
async function run<T>(fn: (userId: string) => Promise<T>): Promise<ActionResult<T>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  try {
    return { ok: true, data: await fn(user.id) };
  } catch (err) {
    if (!(err instanceof UserError || err instanceof z.ZodError)) console.error(err);
    return { ok: false, error: err instanceof UserError ? err.message : "Something went wrong." };
  }
}

const Feedback = z.enum(FEEDBACK_TYPES);

export const sendFeedback = async (draftId: string, type: FeedbackType, payload: Record<string, unknown> = {}) =>
  run((u) => learning.recordFeedback(u, draftId, Feedback.parse(type), payload));

export const regenerateBatch = async (batchId: string) => run((u) => learning.recordRegenerate(u, batchId));

export const saveEdit = async (draftId: string, kept: string) => run((u) => learning.saveEdit(u, draftId, z.string().max(25_000).parse(kept)));

export const fillPlaceholder = async (draftId: string, index: number, value: string) =>
  run((u) => learning.fillPlaceholder(u, draftId, z.number().int().min(0).parse(index), z.string().trim().min(1).max(500).parse(value)));

export const chooseAb = async (batchId: string, choice: AbChoice) =>
  run((u) => learning.recordAbChoice(u, batchId, z.enum(["a", "b", "tie", "neither"]).parse(choice)));

export const allowTell = async (voiceId: string, category: string) => run((u) => learning.allowCategory(u, voiceId, category));

export const changeRule = async (ruleId: string, action: learning.RuleAction) =>
  run((u) => learning.ruleAction(u, ruleId, z.enum(["confirm", "archive", "undo", "restore"]).parse(action)));

const Params = z.object({ phrase: z.string().max(60).optional(), n: z.number().int().min(40).optional(), note: z.string().max(140).optional() });

export const editRule = async (ruleId: string, params: RuleParams) => run((u) => learning.updateRule(u, ruleId, Params.parse(params)));

export const addRule = async (voiceId: string, kind: RuleKind, params: RuleParams) =>
  run((u) => learning.addRule(u, voiceId, z.enum(RULE_KIND_IDS).parse(kind), Params.parse(params)));

export const restoreRuleset = async (versionId: string) => run((u) => learning.restoreRuleset(u, versionId));
