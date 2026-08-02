/**
 * Apply the schema and print what came back — the quickest way to confirm a
 * migration landed without booting the app.
 *
 *   bun --conditions=react-server run scripts/db-check.ts
 *
 * The condition flag is required: the lib modules import `server-only`, which
 * throws unless the resolver picks its react-server entry the way Next does.
 */
import { db, initDb } from "../src/lib/db";
import { listEventTypes } from "../src/lib/event-types";
import { listRules } from "../src/lib/schedule";
import { getSettings } from "../src/lib/settings";

await initDb();
console.log("event types:", (await listEventTypes()).map((t) => `${t.slug} (${t.durationMin}m)`));
console.log("rules:", (await listRules()).map((r) => `${r.weekday}:${r.startMin}-${r.endMin}`));
console.log("settings:", await getSettings());
const tables = await db.execute(
  "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'coffee_%' ORDER BY name",
);
console.log("tables:", tables.rows.map((r) => r.name));
