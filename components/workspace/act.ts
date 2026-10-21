"use client";

import { toast } from "sonner";
import type { ActionResult } from "@/app/actions";

/** Awaits a server action and shows its error (if any) as a toast. */
export async function act<T>(result: Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const r = await result;
  if (!r.ok) toast.error(r.error);
  return r;
}
