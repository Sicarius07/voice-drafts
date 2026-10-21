import "server-only";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";

const oauth = (clientId?: string, clientSecret?: string) => (clientId && clientSecret ? { clientId, clientSecret } : undefined);
const google = oauth(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
const github = oauth(process.env.GITHUB_CLIENT_ID, process.env.GITHUB_CLIENT_SECRET);

/** OAuth providers with credentials set; the sign-in screen shows only these. */
export const OAUTH_PROVIDERS = [google && ("google" as const), github && ("github" as const)].filter((p) => !!p);

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  socialProviders: { ...(google && { google }), ...(github && { github }) },
  // No email verification (there's no mail service). Better Auth won't link an OAuth sign-in into an account whose email
  // isn't verified, so registering someone else's email can't take over their account.
  emailAndPassword: { enabled: true },
  plugins: [nextCookies()],
});

export async function getUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

/** For pages: signed-out users go back to the landing page. */
export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/");
  return user;
}
