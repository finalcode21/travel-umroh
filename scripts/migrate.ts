import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env.local first.");
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: url,
    ssl: url.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
  });
  const db = drizzle(pool);
  console.log("Running core migrations from ./drizzle …");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("✔ Core migrations applied.");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
