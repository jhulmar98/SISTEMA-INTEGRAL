const webRoutes = require("./web");

const express = require("express");
const cors = require("cors");
require("dotenv").config();
const pool = require("./db");

const app = express();
app.use(cors());
app.use(express.json());
app.use(webRoutes);

const PORT = process.env.PORT || 3000;

/* =====================================================
   🧪 TEST DB / HORA SERVIDOR (UTC)
===================================================== */
app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT now() AS hora_utc");
    res.json({
      ok: true,
      hora_servidor_utc: result.rows[0].hora_utc,
    });
  } catch (error) {
    console.error("❌ Error DB:", error);
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
      `
      SELECT id, nombre
      FROM municipalidades
      WHERE codigo = $1 AND activo = true
      `,
      [codigo]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Código no válido" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ validar-muni:", error);
    res.status(500).json({ error: "Error del servidor" });
  }
});

/* =====================================================
   👮 REGISTRAR SUPERVISOR
===================================================== */
app.post("/registrar-supervisor", async (req, res) => {
  const { muni_id, nombre, dni } = req.body;

  try {
    const result = await pool.query(
      `
      INSERT INTO supervisores (muni_id, nombre, dni)
      VALUES ($1, $2, $3)
      ON CONFLICT (muni_id, dni)
      DO UPDATE SET nombre = EXCLUDED.nombre
      RETURNING id
      `,
      [muni_id, nombre, dni]
    );

    res.json({
      ok: true,
      supervisor_id: result.rows[0].id,
    });

  } catch (error) {
    console.error("❌ registrar-supervisor:", error);
    res.status(500).json({ error: "Error registrando supervisor" });
  }
});

/* =====================================================
   👮‍♂️ REGISTRAR MARCACIÓN (PRODUCCIÓN REAL)
===================================================== */
app.post("/marcar", async (req, res) => {
  const {
    muni_id,
    dni,
    nombre,
    cargo,
    gerencia,
    lat,
    lng,
    comentario = "",
    supervisor_dni,
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /* 1️⃣ BLOQUEO 3 MINUTOS (UTC - FUENTE ÚNICA) */
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
          error: "Debe esperar 3 minutos para volver a registrar",
        });
      }
    }

    /* 2️⃣ DETERMINAR TURNO ACTIVO (BACKEND MANDA) */
    const turno = await client.query(
      `
      SELECT id
      FROM turnos
      WHERE muni_id = $1
        AND (
          (hora_inicio < hora_fin AND CURRENT_TIME BETWEEN hora_inicio AND hora_fin)
          OR
          (hora_inicio > hora_fin AND (CURRENT_TIME >= hora_inicio OR CURRENT_TIME <= hora_fin))
        )
      LIMIT 1
      `,
      [muni_id]
    );

    if (turno.rows.length === 0) {
      throw new Error("No existe turno activo para esta hora");
    }

    const turno_id = turno.rows[0].id;

    /* 3️⃣ UPSERT PERSONAL (QR = FUENTE DE VERDAD) */
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

    /* 4️⃣ INSERTAR UBICACIÓN */
    const ub = await client.query(
      `
      INSERT INTO ubicaciones (muni_id, lat, lng)
      VALUES ($1, $2, $3)
      RETURNING id
      `,
      [muni_id, lat, lng]
    );

    const ubicacion_id = ub.rows[0].id;

    /* 5️⃣ OBTENER SUPERVISOR */
    const sup = await client.query(
      `
      SELECT id
      FROM supervisores
      WHERE dni = $1 AND muni_id = $2
      `,
      [supervisor_dni, muni_id]
    );

    const supervisor_id = sup.rows[0]?.id || null;

    /* 6️⃣ INSERTAR MARCACIÓN (COHERENTE CON TABLA 7) */
    await client.query(
      `
      INSERT INTO marcaciones (
        muni_id,
        personal_dni,
        supervisor_id,
        ubicacion_id,
        turno_id,
        fecha,
        hora,
        gerencia,
        comentario,
        created_at
      )
      VALUES (
        $1,$2,$3,$4,$5,
        (now() AT TIME ZONE 'America/Lima')::date,
        (now() AT TIME ZONE 'America/Lima')::time,

        $6,$7,
        now()
      )
      `,
      [
        muni_id,
        dni,
        supervisor_id,
        ubicacion_id,
        turno_id,
        gerencia,
        comentario,
      ]
    );

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error en /marcar:", error.message);
    res.status(500).json({ error: "Error registrando marcación" });
  } finally {
    client.release();
  }
});

/* =====================================================
   ⏱ ÚLTIMA MARCACIÓN (UTC – AUDITORÍA)
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
      timestamp: result.rows[0].created_at,
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
    console.error("❌ listar-marcaciones:", error);
    res.status(500).json({ error: "Error obteniendo marcaciones" });
  }
});
/* =====================================================
   🏬 REGISTRAR LOCAL
===================================================== */
app.post("/marcar-local", async (req, res) => {
  const {
    muni_id,
    codigo_local,
    nombre_local,
    direccion,
    lat,
    lng,
    comentario = "",
    supervisor_dni,
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ DETERMINAR TURNO ACTIVO
    const turno = await client.query(
      `
      SELECT id
      FROM turnos
      WHERE muni_id = $1
        AND (
          (hora_inicio < hora_fin AND CURRENT_TIME BETWEEN hora_inicio AND hora_fin)
          OR
          (hora_inicio > hora_fin AND (CURRENT_TIME >= hora_inicio OR CURRENT_TIME <= hora_fin))
        )
      LIMIT 1
      `,
      [muni_id]
    );

    if (turno.rows.length === 0) {
      throw new Error("No existe turno activo");
    }

    const turno_id = turno.rows[0].id;

    // 2️⃣ OBTENER SUPERVISOR
    const sup = await client.query(
      `
      SELECT id
      FROM supervisores
      WHERE dni = $1 AND muni_id = $2
      `,
      [supervisor_dni, muni_id]
    );

    const supervisor_id = sup.rows[0]?.id || null;

    // 3️⃣ INSERTAR MARCACIÓN LOCAL
    await client.query(
      `
      INSERT INTO marcaciones_locales (
        muni_id,
        supervisor_id,
        turno_id,
        fecha,
        hora,
        codigo_local,
        nombre_local,
        direccion,
        lat,
        lng,
        comentario,
        created_at
      )
      VALUES (
        $1,$2,$3,
        (now() AT TIME ZONE 'America/Lima')::date,
        (now() AT TIME ZONE 'America/Lima')::time,
        $4,$5,$6,$7,$8,$9,
        now()
      )
      `,
      [
        muni_id,
        supervisor_id,
        turno_id,
        codigo_local,
        nombre_local,
        direccion,
        lat,
        lng,
        comentario,
      ]
    );

    await client.query("COMMIT");
    res.json({ ok: true });

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error en /marcar-local:", error.message);
    res.status(500).json({ error: "Error registrando local" });
  } finally {
    client.release();
  }
});
/* =====================================================
   🚓 PATRULLAJE SUPERVISOR (OPTIMIZADO)
   - Detecta turno automáticamente
   - Inserta sin transacción (alto rendimiento)
===================================================== */
app.post("/patrullaje", async (req, res) => {
  console.log("🚓 PATRULLAJE RECIBIDO:", req.body);

  const { muni_id, supervisor_id, lat, lng } = req.body;

  // Validación correcta (NO usar !variable)
  if (muni_id == null || supervisor_id == null || lat == null || lng == null) {
    return res.status(400).json({ error: "Datos incompletos" });
  }

  try {
    /* 1️⃣ DETERMINAR TURNO ACTIVO */
    const turno = await pool.query(
      `
      SELECT id
      FROM turnos
      WHERE muni_id = $1
        AND (
          (hora_inicio < hora_fin AND CURRENT_TIME BETWEEN hora_inicio AND hora_fin)
          OR
          (hora_inicio > hora_fin AND (CURRENT_TIME >= hora_inicio OR CURRENT_TIME <= hora_fin))
        )
      LIMIT 1
      `,
      [muni_id]
    );

    if (turno.rows.length === 0) {
      return res.status(400).json({ error: "No existe turno activo" });
    }

    const turno_id = turno.rows[0].id;

    /* 2️⃣ INSERTAR TRACKING */
    await pool.query(
      `
      INSERT INTO patrullajes_supervisor (
        muni_id,
        supervisor_id,
        turno_id,
        lat,
        lng,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5, (now() AT TIME ZONE 'America/Lima'))
      `,
      [muni_id, supervisor_id, turno_id, lat, lng]
    );

    res.json({ ok: true });

  } catch (error) {
    console.error("❌ Error en /patrullaje:", error.message);
    res.status(500).json({ error: "Error registrando patrullaje" });
  }
});
/* =====================================================
   ⏰ OBTENER TURNO ACTUAL (PARA WEB)
===================================================== */
app.get("/turno-actual", async (req, res) => {
  const { muni_id } = req.query;

  if (!muni_id) {
    return res.status(400).json({ error: "muni_id requerido" });
  }

  try {
    const turno = await pool.query(
      `
      SELECT codigo_turno
      FROM turnos
      WHERE muni_id = $1
        AND (
          (hora_inicio < hora_fin AND 
           (now() AT TIME ZONE 'America/Lima')::time BETWEEN hora_inicio AND hora_fin)
          OR
          (hora_inicio > hora_fin AND 
           ((now() AT TIME ZONE 'America/Lima')::time >= hora_inicio OR
            (now() AT TIME ZONE 'America/Lima')::time <= hora_fin))
        )
      LIMIT 1
      `,
      [muni_id]
    );

    if (turno.rows.length === 0) {
      return res.json({ codigo_turno: null });
    }

    res.json({ codigo_turno: turno.rows[0].codigo_turno });
  } catch (error) {
    console.error("❌ Error turno actual:", error);
    res.status(500).json({ error: "Error del servidor" });
  }
});

/* =====================================================
   📍 MARCACIONES ACTUALES (ÚLTIMO ESCANEO POR PERSONA)
   - 1 fila por personal_dni (último created_at)
   - Filtra por muni_id + fecha + turno (opcional) + gerencia (opcional)
   - Devuelve codigo_turno
===================================================== */
app.get("/marcaciones-actuales", async (req, res) => {
  const { muni_id, fecha, turno, gerencia } = req.query;

  if (!muni_id || !fecha) {
    return res.status(400).json({ error: "muni_id y fecha requeridos" });
  }

  try {

    /* =====================================================
       1️⃣ Resolver turno_id si viene turno=T1/T2/T3
    ===================================================== */
    let turno_id = null;

    if (turno && turno !== "TODO" && turno !== "Todo") {
      const turnoResult = await pool.query(
        `
        SELECT id
        FROM turnos
        WHERE muni_id = $1
          AND codigo_turno = $2
        LIMIT 1
        `,
        [muni_id, turno]
      );

      if (turnoResult.rows.length > 0) {
        turno_id = turnoResult.rows[0].id;
      }
    }

    /* =====================================================
       2️⃣ Query base
    ===================================================== */
    let query = `
      SELECT DISTINCT ON (m.personal_dni)

        m.personal_dni               AS dni,
        COALESCE(p.nombre, '')       AS nombre,
        COALESCE(p.cargo,  '')       AS cargo,

        m.gerencia                   AS gerencia,

        COALESCE(s.nombre, '')       AS supervisor_nombre,
        COALESCE(s.dni,    '')       AS supervisor_dni,

        COALESCE(m.comentario, '')   AS comentario,

        m.fecha                      AS fecha,
        m.hora                       AS hora,
        m.created_at                 AS created_at,

        u.lat                        AS lat,
        u.lng                        AS lng,

        t.codigo_turno               AS codigo_turno   -- 🔥 IMPORTANTE

      FROM marcaciones m

      INNER JOIN ubicaciones u ON u.id = m.ubicacion_id
      LEFT JOIN personal p     ON p.dni = m.personal_dni
      LEFT JOIN supervisores s ON s.id  = m.supervisor_id
      LEFT JOIN turnos t       ON t.id  = m.turno_id

      WHERE m.muni_id = $1
        AND m.fecha   = $2
    `;

    const values = [muni_id, fecha];
    let idx = 3;

    /* =====================================================
       3️⃣ Filtro turno si aplica
    ===================================================== */
    if (turno_id) {
      query += ` AND m.turno_id = $${idx}`;
      values.push(turno_id);
      idx++;
    }

    /* =====================================================
       4️⃣ Filtro gerencia si aplica
    ===================================================== */
    if (gerencia && gerencia.trim() !== "") {
      query += ` AND TRIM(m.gerencia) = TRIM($${idx})`;
      values.push(gerencia.trim());
      idx++;
    }

    /* =====================================================
       5️⃣ DISTINCT ON requiere ORDER BY coherente
    ===================================================== */
    query += `
      ORDER BY m.personal_dni, m.created_at DESC
    `;

    const result = await pool.query(query, values);

    /* =====================================================
       6️⃣ Logs de auditoría profesional
    ===================================================== */
    console.log("📊 /marcaciones-actuales", {
      muni_id,
      fecha,
      turno: turno || null,
      turno_id,
      gerencia: gerencia || null,
      filas: result.rows.length,
    });

    res.json(result.rows);

  } catch (error) {
    console.error("❌ Error marcaciones-actuales:", error);
    res.status(500).json({ error: "Error del servidor" });
  }
});



/* ===================================================== */
app.listen(PORT, () => {
  console.log("🚀 Servidor corriendo en puerto", PORT);
});
















