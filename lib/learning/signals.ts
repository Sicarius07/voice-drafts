export const FEEDBACK_TYPES = [
  "copy",
  "thumbs_up",
  "thumbs_down",
  "pick",
  "edit",
  "delete",
  "regenerate",
  "ab_choice",
  "tell_override",
] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

/** Angle-bandit reward per signal (r in 0..1, weighted by trust). Unlisted signals don't move angle weights. */
export const REWARDS: Partial<Record<FeedbackType, { r: number; weight: number }>> = {
  copy: { r: 1, weight: 1 },
  thumbs_up: { r: 1, weight: 1 },
  pick: { r: 1, weight: 1 },
  edit: { r: 0.5, weight: 1 },
  thumbs_down: { r: 0, weight: 1 },
  delete: { r: 0, weight: 1 },
  regenerate: { r: 0, weight: 0.25 },
};

/** A draft counts as accepted if it was copied, liked or picked. */
export const ACCEPT_TYPES: FeedbackType[] = ["copy", "thumbs_up", "pick"];

export const THUMBS_DOWN_REASONS = ["Not my voice", "Sounds AI", "Boring", "Made-up facts"] as const;
