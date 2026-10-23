import { defineConfig } from "drizzle-kit";

// drizzle-kit only generates SQL here. Wrangler applies it (`pnpm db:migrate`, and the
// deploy script with --remote). Tests apply the same files with readD1Migrations().
//
// Layout compatibility: drizzle-kit writes `migrations/NNNN_<name>.sql` (index prefix,
// starting at 0000) plus a `migrations/meta/` folder with its journal and snapshots.
// Wrangler reads only the top-level `*.sql` files in `migrations_dir`, in name order, and
// ignores `meta/`. So both tools share the folder with no post-processing.
// Always pass a name: `pnpm db:generate --name <change>`. Never edit an applied migration.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/worker/db/schema.ts",
  out: "./migrations",
  migrations: { prefix: "index" },
  strict: true,
  verbose: true,
});
