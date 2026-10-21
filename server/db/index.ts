import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// One pool per process, kept on globalThis so dev hot reloads reuse it instead of opening (and attaching) another.
const g = globalThis as { pgPool?: Pool };
if (!g.pgPool) {
  g.pgPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  attachDatabasePool(g.pgPool); // lets Vercel Fluid compute release idle connections
}

export const db = drizzle(g.pgPool, { schema });
export * as t from "./schema";
