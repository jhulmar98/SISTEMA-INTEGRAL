const { Pool } = require("pg");

// Verifica que exista la variable de entorno
if (!process.env.DATABASE_URL) {
  console.error("❌ ERROR: DATABASE_URL no está definida");
  process.exit(1);
}

// Crear conexión a PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  // 🔥 IMPORTANTE:
  // Render PostgreSQL interno NO necesita SSL
  ssl: false
});

// Cuando se conecta correctamente
pool.on("connect", () => {
  console.log("✅ Conectado a PostgreSQL (Render)");
});

// Si ocurre un error inesperado
pool.on("error", (err) => {
  console.error("❌ Error inesperado en PostgreSQL", err);
});

module.exports = pool;
