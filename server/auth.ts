import "server-only";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";

const github = process.env.GITHUB_CLIENT_ID
  ? { github: { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET! } }
  : undefined;

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  socialProviders: github,
  // Email/password exists only for local development (testing without an OAuth app). Production is GitHub-only.
  emailAndPassword: { enabled: process.env.NODE_ENV !== "production" },
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
