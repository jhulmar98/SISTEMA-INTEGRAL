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
    const result = await pool.query("SELECT now() AS hora_utc");
    res.json({
      ok: true,
      hora_servidor_utc: result.rows[0].hora_utc
    });
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
      `SELECT id, nombre
       FROM municipalidades
       WHERE codigo = $1 AND activo = true`,
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
      `
      INSERT INTO supervisores (muni_id, nombre, dni)
      VALUES ($1, $2, $3)
      ON CONFLICT (muni_id, dni) DO NOTHING
      `,
      [muni_id, nombre, dni]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error registrando supervisor" });
  }
});

/* =====================================================
   👮‍♂️ REGISTRAR MARCACIÓN (UTC + BLOQUEO 3 MIN)
===================================================== */
app.post("/marcar", async (req, res) => {
  const {
    muni_id,
    dni,
    nombre,
    cargo,
    gerencia,
    turno_id,
    lat,
    lng,
    comentario = "",
    supervisor_dni
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /* 1️⃣ BLOQUEO 3 MINUTOS (UTC, DEFINITIVO) */
    const ultima = await client.query(
      `
      SELECT created_at
      FROM marcaciones
      WHERE personal_dni = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [dni]
    );

    if (ultima.rows.length > 0) {
      const diff = await client.query(
        `SELECT EXTRACT(EPOCH FROM (now() - $1)) AS segundos`,
        [ultima.rows[0].created_at]
      );

      if (diff.rows[0].segundos < 180) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "Debe esperar 3 minutos para volver a registrar"
        });
      }
    }

    /* 2️⃣ UPSERT PERSONAL */
    await client.query(
      `
      INSERT INTO personal (dni, muni_id, nombre, cargo, gerencia)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (dni) DO UPDATE SET
        nombre   = EXCLUDED.nombre,
        cargo    = EXCLUDED.cargo,
        gerencia = EXCLUDED.gerencia
      `,
      [dni, muni_id, nombre, cargo, gerencia]
    );

    /* 3️⃣ INSERTAR UBICACIÓN */
    const ub = await client.query(
      `
      INSERT INTO ubicaciones (muni_id, lat, lng)
      VALUES ($1, $2, $3)
      RETURNING id
      `,
      [muni_id, lat, lng]
    );

    const ubicacion_id = ub.rows[0].id;

    /* 4️⃣ OBTENER SUPERVISOR */
    const sup = await client.query(
      `SELECT id FROM supervisores WHERE dni = $1 AND muni_id = $2`,
      [supervisor_dni, muni_id]
    );

    const supervisor_id = sup.rows[0]?.id || null;

    /* 5️⃣ INSERTAR MARCACIÓN (TIMESTAMP UTC ÚNICO) */
    await client.query(
      `
      INSERT INTO marcaciones (
        muni_id,
        personal_dni,
        supervisor_id,
        ubicacion_id,
        turno_id,
        gerencia,
        comentario,
        created_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7, now()
      )
      `,
      [
        muni_id,
        dni,
        supervisor_id,
        ubicacion_id,
        turno_id,
        gerencia,
        comentario
      ]
    );

    await client.query("COMMIT");
    res.json({ ok: true });

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error en /marcar:", error);
    res.status(500).json({ error: "Error registrando marcación" });
  } finally {
    client.release();
  }
});

/* =====================================================
   ⏱ ÚLTIMA MARCACIÓN (UTC)
===================================================== */
app.get("/ultima-marcacion/:dni", async (req, res) => {
  const { dni } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT created_at
      FROM marcaciones
      WHERE personal_dni = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [dni]
    );

    if (result.rows.length === 0) {
      return res.json({ existe: false });
    }

    res.json({
      existe: true,
      timestamp: result.rows[0].created_at
    });
  } catch (error) {
    console.error("❌ Error última marcación:", error);
    res.status(500).json({ error: "Error consultando última marcación" });
  }
});

/* =====================================================
   📋 LISTAR MARCACIONES
===================================================== */
app.get("/marcaciones", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT m.*, p.nombre AS personal_nombre
      FROM marcaciones m
      LEFT JOIN personal p ON p.dni = m.personal_dni
      ORDER BY m.created_at DESC
      `
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
