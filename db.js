const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("❌ ERROR: DATABASE_URL no está definida");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on("connect", () => {
  console.log("✅ Conectado a PostgreSQL (Supabase)");
});

pool.on("error", (err) => {
  console.error("❌ Error inesperado en PostgreSQL", err);
});

module.exports = pool;
