/**
 * Print what is actually in the database — the quickest way to confirm a
 * migration landed without booting the app. Reads only, unless asked otherwise.
 *
 *   bun --conditions=react-server run scripts/db-check.ts
 *   bun --conditions=react-server run scripts/db-check.ts --apply
 *
 * `--apply` is what runs initDb(): fourteen CREATE statements, plus five
 * availability rules and three event types seeded into whichever of those two
 * tables comes back empty. Against the shared production Turso instance that
 * is a write, and not one anybody expects from something called db-check — so
 * it is opt-in. Which also rules out the lib read helpers here: every one of
 * them calls initDb() on its way in, so the default path queries the tables
 * directly instead.
 *
 * The condition flag is required: the lib modules import `server-only`, which
 * throws unless the resolver picks its react-server entry the way Next does.
 */
import { db, initDb } from "../src/lib/db";
import { DEFAULT_SETTINGS } from "../src/lib/settings";

if (process.argv.includes("--apply")) {
  await initDb();
  console.log("applied the schema, and seeded any table that was empty.");
}

const tables = await db.execute(
  "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'coffee_%' ORDER BY name",
);
const present = new Set(tables.rows.map((r) => String(r.name)));

// Without this the report fails one SELECT at a time on a fresh database, and
// "no such table" doesn't tell an operator which flag they were missing.
const missing = ["coffee_availability_rules", "coffee_event_types", "coffee_settings"].filter(
  (name) => !present.has(name),
);
if (missing.length > 0) {
  console.error(
    `db-check: ${missing.join(", ")} not found. This script only reads — ` +
      "re-run it with --apply to create the schema and seed a fresh database.",
  );
  process.exit(1);
}

// The same shape listEventTypes() and listRules() return, minus the init.
const types = await db.execute(
  `SELECT slug, duration_min FROM coffee_event_types
   WHERE active = 1 ORDER BY position ASC, created_at ASC`,
);
console.log("event types:", types.rows.map((r) => `${r.slug} (${r.duration_min}m)`));

const rules = await db.execute(
  `SELECT weekday, start_min, end_min FROM coffee_availability_rules
   ORDER BY weekday ASC, start_min ASC`,
);
console.log("rules:", rules.rows.map((r) => `${r.weekday}:${r.start_min}-${r.end_min}`));

// getSettings() is off limits for the same reason, so the stored rows are laid
// over the defaults it would have filled in. The one difference from its
// return value: everything here is the string it is stored as, uncoerced.
const stored = await db.execute("SELECT key, value FROM coffee_settings");
console.log("settings:", {
  ...DEFAULT_SETTINGS,
  ...Object.fromEntries(stored.rows.map((r) => [String(r.key), String(r.value)] as const)),
});

console.log("tables:", [...present]);
