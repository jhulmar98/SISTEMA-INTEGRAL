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
   📐 FUNCIÓN DETECCIÓN PUNTO EN POLÍGONO
===================================================== */
function pointInPolygon(lat, lng, polygon) {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;

    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

 
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
  const { muni_id, nombre, dni, cargo, gerencia } = req.body;

  try {
    const result = await pool.query(
      `
      INSERT INTO supervisores (muni_id, nombre, dni, cargo, gerencia)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (muni_id, dni)
      DO UPDATE SET
        nombre   = EXCLUDED.nombre,
        cargo    = EXCLUDED.cargo,
        gerencia = EXCLUDED.gerencia
      RETURNING id
      `,
      [muni_id, nombre, dni, cargo, gerencia]
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

    /* 1️⃣ BLOQUEO 3 MINUTOS */
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

    /* 2️⃣ TURNO ACTIVO */
    const turno = await client.query(
      `
      SELECT id
      FROM turnos
      WHERE muni_id = $1
        AND (
          (hora_inicio < hora_fin AND 
            (now() AT TIME ZONE 'America/Lima')::time 
              BETWEEN hora_inicio AND hora_fin)
          OR
          (hora_inicio > hora_fin AND 
            (
              (now() AT TIME ZONE 'America/Lima')::time >= hora_inicio
              OR
              (now() AT TIME ZONE 'America/Lima')::time <= hora_fin
            )
          )
        )
      LIMIT 1
      `,
      [muni_id]
    );

    if (turno.rows.length === 0) {
      throw new Error("No existe turno activo");
    }

    const turno_id = turno.rows[0].id;

    /* 3️⃣ UPSERT PERSONAL */
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

    /* 4️⃣ DETECTAR SECTOR */
    let sector_nombre = null;

    const geos = await client.query(
      `SELECT id, nombre FROM geocercas WHERE muni_id = $1 AND activo = true`,
      [muni_id]
    );

    for (const geo of geos.rows) {
      const puntos = await client.query(
        `
        SELECT lat, lng
        FROM geocerca_puntos
        WHERE geocerca_id = $1
        ORDER BY orden
        `,
        [geo.id]
      );

      if (pointInPolygon(lat, lng, puntos.rows)) {
        sector_nombre = geo.nombre;
        break;
      }
    }

    /* 5️⃣ INSERTAR UBICACIÓN CON SECTOR */
    const ub = await client.query(
      `
      INSERT INTO ubicaciones (muni_id, lat, lng, sector)
      VALUES ($1, $2, $3, $4)
      RETURNING id
      `,
      [muni_id, lat, lng, sector_nombre]
    );

    const ubicacion_id = ub.rows[0].id;

    /* 6️⃣ OBTENER SUPERVISOR */
    const sup = await client.query(
      `
      SELECT id
      FROM supervisores
      WHERE dni = $1 AND muni_id = $2
      `,
      [supervisor_dni, muni_id]
    );

    const supervisor_id = sup.rows[0]?.id || null;

    /* 7️⃣ INSERTAR MARCACIÓN */
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
        comentario
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
          (hora_inicio < hora_fin AND 
             (now() AT TIME ZONE 'America/Lima')::time 
               BETWEEN hora_inicio AND hora_fin)

          OR
          
            (hora_inicio > hora_fin AND 
             (
               (now() AT TIME ZONE 'America/Lima')::time >= hora_inicio
               OR
               (now() AT TIME ZONE 'America/Lima')::time <= hora_fin
             )
            )

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

  const { muni_id, supervisor_id, lat, lng, gerencia, cargo } = req.body;

  if (muni_id == null || supervisor_id == null || lat == null || lng == null) {
    return res.status(400).json({ error: "Datos incompletos" });
  }

  try {

    const turno = await pool.query(
      `
      SELECT id
      FROM turnos
      WHERE muni_id = $1
        AND (
          (hora_inicio < hora_fin AND 
             (now() AT TIME ZONE 'America/Lima')::time 
               BETWEEN hora_inicio AND hora_fin)
          OR
          (hora_inicio > hora_fin AND 
             (
               (now() AT TIME ZONE 'America/Lima')::time >= hora_inicio
               OR
               (now() AT TIME ZONE 'America/Lima')::time <= hora_fin
             )
          )
        )
      LIMIT 1
      `,
      [muni_id]
    );

    if (turno.rows.length === 0) {
      return res.status(400).json({ error: "No existe turno activo" });
    }

    const turno_id = turno.rows[0].id;

    await pool.query(
      `
      INSERT INTO patrullajes_supervisor (
        muni_id,
        supervisor_id,
        turno_id,
        lat,
        lng,
        gerencia,
        cargo,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7, (now() AT TIME ZONE 'America/Lima'))
      `,
      [
        muni_id,
        supervisor_id,
        turno_id,
        lat,
        lng,
        gerencia,
        cargo
      ]
    );

    res.json({ ok: true });

  } catch (error) {
    console.error("❌ Error en /patrullaje:", error.message);
    res.status(500).json({ error: "Error registrando patrullaje" });
  }
});

app.get("/supervisores-activos", async (req, res) => {
  const { muni_id, gerencia } = req.query;

  if (!muni_id) {
    return res.status(400).json({ error: "muni_id requerido" });
  }

  try {

    let query = `
      SELECT DISTINCT ON (ps.supervisor_id)
        ps.supervisor_id,
        s.nombre,
        s.gerencia,
        s.cargo,
        ps.lat,
        ps.lng,
        ps.created_at,
        t.codigo_turno,
        CASE
          WHEN ps.created_at > (now() AT TIME ZONE 'America/Lima') - interval '2 minutes'
          THEN true
          ELSE false
        END AS activo
      FROM patrullajes_supervisor ps
      JOIN supervisores s ON s.id = ps.supervisor_id
      LEFT JOIN turnos t ON t.id = ps.turno_id
      WHERE ps.muni_id = $1
    `;

    const values = [muni_id];
    let idx = 2;

    if (gerencia && gerencia.trim() !== "") {
      query += ` AND TRIM(s.gerencia) = TRIM($${idx})`;
      values.push(gerencia.trim());
      idx++;
    }

    query += `
      ORDER BY ps.supervisor_id, ps.created_at DESC
    `;

    const result = await pool.query(query, values);

    res.json(result.rows);

  } catch (error) {
    console.error("❌ Error supervisores-activos:", error);
    res.status(500).json({ error: "Error del servidor" });
  }
});

app.get("/recorrido-supervisor", async (req, res) => {
  const { muni_id, supervisor_id, gerencia } = req.query;

  if (!muni_id || !supervisor_id) {
    return res.status(400).json({
      error: "muni_id y supervisor_id requeridos"
    });
  }

  try {

    let query = `
      SELECT ps.lat, ps.lng, ps.created_at
      FROM patrullajes_supervisor ps
      JOIN supervisores s ON s.id = ps.supervisor_id
      WHERE ps.muni_id = $1
        AND ps.supervisor_id = $2
        AND (ps.created_at AT TIME ZONE 'America/Lima')::date =
            (now() AT TIME ZONE 'America/Lima')::date
    `;

    const values = [muni_id, supervisor_id];
    let idx = 3;

    if (gerencia && gerencia.trim() !== "") {
      query += ` AND TRIM(s.gerencia) = TRIM($${idx})`;
      values.push(gerencia.trim());
      idx++;
    }

    query += ` ORDER BY ps.created_at ASC`;

    const result = await pool.query(query, values);

    res.json(result.rows);

  } catch (error) {
    console.error("❌ Error recorrido-supervisor:", error);
    res.status(500).json({ error: "Error del servidor" });
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

    /* 1️⃣ Resolver turno_id */
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

    /* 2️⃣ Query base */
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
        u.sector                     AS sector,

        t.codigo_turno               AS codigo_turno,

        COUNT(*) OVER (
          PARTITION BY m.personal_dni
        ) AS total_marcaciones

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

    /* 3️⃣ Filtro turno */
    if (turno_id) {
      query += ` AND m.turno_id = $${idx}`;
      values.push(turno_id);
      idx++;
    }

    /* 4️⃣ Filtro gerencia */
    if (gerencia && gerencia.trim() !== "") {
      query += ` AND TRIM(m.gerencia) = TRIM($${idx})`;
      values.push(gerencia.trim());
      idx++;
    }

    /* 5️⃣ ORDER BY obligatorio para DISTINCT ON */
    query += `
      ORDER BY m.personal_dni, m.created_at DESC
    `;

    const result = await pool.query(query, values);

    res.json(result.rows);

  } catch (error) {
    console.error("❌ Error marcaciones-actuales:", error);
    res.status(500).json({ error: "Error del servidor" });
  }
});

/* =====================================================
   📡 INICIAR TRANSMISIÓN EN VIVO
===================================================== */
   app.post("/iniciar-transmision", async (req, res) => {
   
     const {
       muni_id,
       supervisor_dni,
       nombre_supervisor,
       gerencia,
       lat,
       lng
     } = req.body;
   
     if (!muni_id || !supervisor_dni || !lat || !lng) {
       return res.status(400).json({ error: "Datos incompletos" });
     }
   
     try {
   
       const stream_key = "live_" + Date.now();
   
       const result = await pool.query(
         `
         INSERT INTO transmisiones_supervisor (
              muni_id,
              supervisor_dni,
              nombre_supervisor,
              gerencia,
              lat,
              lng,
              fecha,
              hora,
              stream_key,
              estado
            )
            VALUES (
              $1,$2,$3,$4,$5,$6,
              (now() AT TIME ZONE 'America/Lima')::date,
              (now() AT TIME ZONE 'America/Lima')::time,
              $7,
              'ACTIVO'
            )
         RETURNING id
         `,
         [
           muni_id,
           supervisor_dni,
           nombre_supervisor,
           gerencia,
           lat,
           lng,
           stream_key
         ]
       );
   
       res.json({
         ok: true,
         transmision_id: result.rows[0].id,
         stream_key,
         stream_url: `rtmp://tu-servidor/live/${stream_key}`
       });
   
     } catch (error) {
       console.error("❌ Error iniciar transmisión:", error);
       res.status(500).json({ error: "Error iniciando transmisión" });
     }
   });
   /* =====================================================
   📡 FINALIZAR TRANSMISIÓN
===================================================== */
   app.post("/finalizar-transmision", async (req, res) => {
   
     const { stream_key } = req.body;
   
     if (!stream_key) {
       return res.status(400).json({ error: "stream_key requerido" });
     }
   
     try {
   
       await pool.query(
         `
         UPDATE transmisiones_supervisor
         SET estado = 'FINALIZADO',
            finished_at = now()
         WHERE stream_key = $1
         `,
         [stream_key]
       );
   
       res.json({ ok: true });
   
     } catch (error) {
       console.error("❌ Error finalizar transmisión:", error);
       res.status(500).json({ error: "Error finalizando transmisión" });
     }
   });
   /* =====================================================
   📡 TRANSMISIONES ACTIVAS
   ===================================================== */
   app.get("/transmisiones-activas", async (req, res) => {
   
     const { muni_id } = req.query;
   
     if (!muni_id) {
       return res.status(400).json({ error: "muni_id requerido" });
     }
   
     try {
   
       const result = await pool.query(
         `
         SELECT
           id,
           supervisor_dni,
           nombre_supervisor,
           gerencia,
           lat,
           lng,
           stream_key,
           created_at
         FROM transmisiones_supervisor
         WHERE muni_id = $1
           AND estado = 'ACTIVO'
         ORDER BY created_at DESC
         `,
         [muni_id]
       );
   
       res.json(result.rows);
   
     } catch (error) {
       console.error("❌ Error transmisiones:", error);
       res.status(500).json({ error: "Error del servidor" });
     }
   });

/* =====================================================
   📜 HISTORIAL DE TRANSMISIONES DEL DÍA
===================================================== */
app.get("/transmisiones-hoy", async (req, res) => {

  const { muni_id, gerencia } = req.query;

  if (!muni_id) {
    return res.status(400).json({ error: "muni_id requerido" });
  }

  try {

    let query = `
      SELECT
        id,
        nombre_supervisor,
        gerencia,
        stream_key,
        created_at,
        finished_at,
        estado
      FROM transmisiones_supervisor
      WHERE muni_id = $1
        AND estado = 'FINALIZADO'
        AND (created_at AT TIME ZONE 'America/Lima')::date =
            (now() AT TIME ZONE 'America/Lima')::date
    `;

    const values = [muni_id];
    let idx = 2;

    if (gerencia && gerencia !== "ALL") {
      query += ` AND gerencia = $${idx}`;
      values.push(gerencia);
      idx++;
    }

    query += ` ORDER BY created_at DESC`;

    const result = await pool.query(query, values);

    res.json(result.rows);

  } catch (error) {
    console.error("❌ Error historial transmisiones:", error);
    res.status(500).json({ error: "Error del servidor" });
  }

});
/* ===================================================== */
app.listen(PORT, () => {
  console.log("🚀 Servidor corriendo en puerto", PORT);
});





























