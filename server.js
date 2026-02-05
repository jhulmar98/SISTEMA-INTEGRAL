const express = require("express");
const cors = require("cors");
require("dotenv").config();
const pool = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* =====================================================
   🧪 PROBAR CONEXIÓN A LA BASE DE DATOS
===================================================== */
app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ ok: true, hora_servidor: result.rows[0] });
  } catch (error) {
    console.error("Error DB:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/* =====================================================
   🏛 VALIDAR CÓDIGO DE MUNICIPALIDAD
===================================================== */
app.post("/validar-muni", async (req, res) => {
  const { codigo } = req.body;

  try {
    const result = await pool.query(
      "SELECT id, nombre FROM municipalidades WHERE codigo = $1 AND activo = true",
      [codigo]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Código no válido" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error del servidor" });
  }
});

/* =====================================================
   👮 REGISTRAR SUPERVISOR
===================================================== */
app.post("/registrar-supervisor", async (req, res) => {
  const { muni_id, nombre, dni } = req.body;

  try {
    await pool.query(
      `INSERT INTO supervisores (muni_id, nombre, dni)
       VALUES ($1, $2, $3)
       ON CONFLICT (muni_id, dni) DO NOTHING`,
      [muni_id, nombre, dni]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error registrando supervisor" });
  }
});

/* =====================================================
   👮‍♂️ REGISTRAR MARCACIÓN DE PERSONAL
===================================================== */
app.post("/marcar", async (req, res) => {
  const {
    muni_id,
    dni,
    turno_id,
    lat,
    lng,
    comentario,
    supervisor_dni
  } = req.body;

  try {
    // Buscar ID del supervisor
    const sup = await pool.query(
      "SELECT id FROM supervisores WHERE dni = $1 AND muni_id = $2",
      [supervisor_dni, muni_id]
    );

    const supervisor_id = sup.rows[0]?.id || null;

    await pool.query(
      `INSERT INTO marcaciones
       (muni_id, personal_dni, supervisor_id, turno_id, lat, lng, fecha, hora, comentario)
       VALUES ($1,$2,$3,$4,$5,$6,CURRENT_DATE,CURRENT_TIME,$7)`,
      [muni_id, dni, supervisor_id, turno_id, lat, lng, comentario]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error registrando marcación" });
  }
});

/* =====================================================
   📋 LISTAR MARCACIONES (para reportes)
===================================================== */
app.get("/marcaciones", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.*, p.nombre AS personal_nombre
       FROM marcaciones m
       LEFT JOIN personal p ON p.dni = m.personal_dni
       ORDER BY fecha DESC, hora DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error obteniendo marcaciones" });
  }
});

/* ===================================================== */
app.listen(PORT, () => {
  console.log("🚀 Servidor corriendo en puerto", PORT);
});
