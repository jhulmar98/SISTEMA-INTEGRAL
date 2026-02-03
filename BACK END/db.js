const { Pool } = require('pg');

// Verificamos que la variable de entorno exista
if (!process.env.DATABASE_URL) {
  console.error("❌ ERROR: DATABASE_URL no está definida en las variables de entorno");
  process.exit(1);
}

// Creamos el pool de conexión a PostgreSQL (Supabase)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // 🔥 Necesario para Supabase
  }
});

// Evento cuando la conexión se establece correctamente
pool.on('connect', () => {
  console.log('✅ Conectado a PostgreSQL (Supabase)');
});

// Evento para capturar errores de conexión
pool.on('error', (err) => {
  console.error('❌ Error inesperado en PostgreSQL', err);
  process.exit(1);
});

// Función para probar la conexión manualmente (opcional)
async function testConnection() {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('🕒 Hora del servidor DB:', res.rows[0]);
  } catch (err) {
    console.error('❌ Error probando conexión DB:', err);
  }
}

testConnection();

module.exports = pool;
