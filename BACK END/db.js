const { Pool } = require('pg');

// Verificamos que exista la variable
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL no está definida");
  process.exit(1);
}

// 🔥 CONFIGURACIÓN CORRECTA PARA SUPABASE + RENDER
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Mensaje cuando conecta
pool.on('connect', () => {
  console.log('✅ Conectado a PostgreSQL (Supabase)');
});

// Capturar errores
pool.on('error', (err) => {
  console.error('❌ Error inesperado en PostgreSQL', err);
});

// Exportamos la conexión
module.exports = pool;
