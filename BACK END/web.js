const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const pool = require("./db");
/* =====================================================
   👥 OBTENER GERENCIAS (DINÁMICO DESDE PERSONAL)
===================================================== */
router.get("/gerencias", async (req, res) => {

  const { muni_id } = req.query;

  if (!muni_id) {
    return res.status(400).json({ error: "muni_id requerido" });
  }

  try {

    const result = await pool.query(
      `
      SELECT DISTINCT gerencia
      FROM personal
      WHERE muni_id = $1
        AND activo = true
        AND gerencia IS NOT NULL
      ORDER BY gerencia ASC
      `,
      [muni_id]
    );

    const gerencias = result.rows.map(r => r.gerencia);

    res.json(gerencias);

  } catch (error) {
    console.error("❌ Error obteniendo gerencias:", error);
    res.status(500).json({ error: "Error del servidor" });
  }

});
/* =====================================================
   🔐 LOGIN WEB
===================================================== */
router.post("/login-web", async (req, res) => {

  const { codigo, correo, password } = req.body;

  try {

    if (!codigo || !correo || !password) {
      return res.status(400).json({ error: "Datos incompletos" });
    }

    const muni = await pool.query(
      `
      SELECT id, nombre, codigo
      FROM municipalidades
      WHERE codigo = $1
        AND activo = true
      `,
      [codigo]
    );

    if (muni.rows.length === 0) {
      return res.status(404).json({ error: "Municipalidad no encontrada" });
    }

    const muni_id = muni.rows[0].id;
    const muni_nombre = muni.rows[0].nombre;

    const result = await pool.query(
      `
      SELECT id, nombre, correo, password_hash, rol
      FROM usuarios_web
      WHERE muni_id = $1
        AND correo = $2
        AND activo = true
      `,
      [muni_id, correo]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    res.json({
      ok: true,
      muni_id,
      muni_nombre,
      muni_codigo: muni.rows[0].codigo,
      nombre: user.nombre,
      correo: user.correo,
      rol: user.rol
    });

  } catch (error) {
    console.error("❌ Error login:", error);
    res.status(500).json({ error: "Error del servidor" });
  }

});


/* =====================================================
   📋 LISTAR USUARIOS WEB
===================================================== */
router.get("/usuarios-web", async (req, res) => {

  const { muni_id, rol } = req.query;

  if (!muni_id) {
    return res.status(400).json({ error: "muni_id requerido" });
  }

  try {

    let query = `
      SELECT id, nombre, correo, rol
      FROM usuarios_web
      WHERE muni_id = $1
        AND activo = true
    `;

    const values = [muni_id];

    if (rol) {
      query += ` AND rol = $2`;
      values.push(rol);
    }

    query += ` ORDER BY id DESC`;

    const result = await pool.query(query, values);

    res.json(result.rows);

  } catch (error) {
    console.error("❌ Error listando usuarios:", error);
    res.status(500).json({ error: "Error del servidor" });
  }

});


/* =====================================================
   ➕ CREAR USUARIO WEB
===================================================== */
router.post("/crear-usuario-web", async (req, res) => {

  const { muni_id, nombre, correo, password, rol } = req.body;

  if (!muni_id || !nombre || !correo || !password || !rol) {
    return res.status(400).json({ error: "Datos incompletos" });
  }

  try {

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const result = await pool.query(
      `
      INSERT INTO usuarios_web
      (muni_id, nombre, correo, password_hash, rol)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING id
      `,
      [muni_id, nombre, correo, hash, rol]
    );

    res.json({ ok: true, id: result.rows[0].id });

  } catch (error) {

    if (error.code === "23505") {
      return res.status(400).json({ error: "Correo ya registrado" });
    }

    console.error("❌ Error creando usuario:", error);
    res.status(500).json({ error: "Error del servidor" });
  }

});


/* =====================================================
   🗑 DESACTIVAR USUARIO WEB
===================================================== */
router.delete("/eliminar-usuario-web/:id", async (req, res) => {

  const { id } = req.params;

  try {

    await pool.query(
      `
      UPDATE usuarios_web
      SET activo = false
      WHERE id = $1
      `,
      [id]
    );

    res.json({ ok: true });

  } catch (error) {
    console.error("❌ Error eliminando usuario:", error);
    res.status(500).json({ error: "Error del servidor" });
  }

});


/* =====================================================
   🔐 CAMBIAR CONTRASEÑA
===================================================== */
router.put("/cambiar-password/:id", async (req, res) => {

  const { id } = req.params;
  const { muni_id, nuevaPassword } = req.body;

  if (!muni_id || !nuevaPassword) {
    return res.status(400).json({ error: "Datos incompletos" });
  }

  try {

    const result = await pool.query(
      `
      SELECT id, rol, muni_id
      FROM usuarios_web
      WHERE id = $1
        AND activo = true
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const user = result.rows[0];

    if (user.muni_id !== parseInt(muni_id)) {
      return res.status(403).json({ error: "No autorizado" });
    }

    if (user.rol !== "SUPERVISOR") {
      return res.status(403).json({ error: "Solo supervisores" });
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(nuevaPassword, salt);

    await pool.query(
      `
      UPDATE usuarios_web
      SET password_hash = $1
      WHERE id = $2
      `,
      [hash, id]
    );

    res.json({ ok: true });

  } catch (error) {
    console.error("❌ Error cambiando contraseña:", error);
    res.status(500).json({ error: "Error del servidor" });
  }

});




/* =====================================================
   🗺️ LISTAR GEOCERCAS
===================================================== */
router.get("/geocercas", async (req, res) => {

  const { muni_id } = req.query;

  if (!muni_id) {
    return res.status(400).json({ error: "muni_id requerido" });
  }

  try {

    const geos = await pool.query(
      `
      SELECT id, nombre, color
      FROM geocercas
      WHERE muni_id = $1
        AND activo = true
      ORDER BY id DESC
      `,
      [muni_id]
    );

    const resultado = [];

    for (const g of geos.rows) {

      const puntos = await pool.query(
        `
        SELECT lat, lng, orden
        FROM geocerca_puntos
        WHERE geocerca_id = $1
        ORDER BY orden ASC
        `,
        [g.id]
      );

      resultado.push({
        id: g.id,
        nombre: g.nombre,
        color: g.color,
        puntos: puntos.rows
      });

    }

    res.json(resultado);

  } catch (error) {
    console.error("❌ Error listando geocercas:", error);
    res.status(500).json({ error: "Error del servidor" });
  }

});


/* =====================================================
   ➕ CREAR GEOCERCA
===================================================== */
router.post("/geocercas", async (req, res) => {

  const { muni_id, nombre, color, puntos } = req.body;

  if (!muni_id || !nombre || !color || !Array.isArray(puntos)) {
    return res.status(400).json({ error: "Datos incompletos" });
  }

  const client = await pool.connect();

  try {

    await client.query("BEGIN");

    const geo = await client.query(
      `
      INSERT INTO geocercas (muni_id, nombre, color)
      VALUES ($1,$2,$3)
      RETURNING id
      `,
      [muni_id, nombre, color]
    );

    const geocerca_id = geo.rows[0].id;

    for (const p of puntos) {
      await client.query(
        `
        INSERT INTO geocerca_puntos
        (geocerca_id, orden, lat, lng)
        VALUES ($1,$2,$3,$4)
        `,
        [geocerca_id, p.orden, p.lat, p.lng]
      );
    }

    await client.query("COMMIT");

    res.json({ ok: true, id: geocerca_id });

  } catch (error) {

    await client.query("ROLLBACK");
    console.error("❌ Error creando geocerca:", error);
    res.status(500).json({ error: "Error del servidor" });

  } finally {
    client.release();
  }

});


/* =====================================================
   ✏️ EDITAR GEOCERCA
===================================================== */
router.put("/geocercas/:id", async (req, res) => {

  const { id } = req.params;
  const { muni_id, nombre, color, puntos } = req.body;

  if (!muni_id || !nombre || !color || !Array.isArray(puntos)) {
    return res.status(400).json({ error: "Datos incompletos" });
  }

  const client = await pool.connect();

  try {

    await client.query("BEGIN");

    await client.query(
      `
      UPDATE geocercas
      SET nombre = $1,
          color = $2
      WHERE id = $3
        AND muni_id = $4
      `,
      [nombre, color, id, muni_id]
    );

    await client.query(
      `DELETE FROM geocerca_puntos WHERE geocerca_id = $1`,
      [id]
    );

    for (const p of puntos) {
      await client.query(
        `
        INSERT INTO geocerca_puntos
        (geocerca_id, orden, lat, lng)
        VALUES ($1,$2,$3,$4)
        `,
        [id, p.orden, p.lat, p.lng]
      );
    }

    await client.query("COMMIT");

    res.json({ ok: true });

  } catch (error) {

    await client.query("ROLLBACK");
    console.error("❌ Error actualizando geocerca:", error);
    res.status(500).json({ error: "Error del servidor" });

  } finally {
    client.release();
  }

});


/* =====================================================
   🗑 DESACTIVAR GEOCERCA
===================================================== */
router.delete("/geocercas/:id", async (req, res) => {

  const { id } = req.params;

  try {

    await pool.query(
      `
      UPDATE geocercas
      SET activo = false
      WHERE id = $1
      `,
      [id]
    );

    res.json({ ok: true });

  } catch (error) {
    console.error("❌ Error desactivando geocerca:", error);
    res.status(500).json({ error: "Error del servidor" });
  }

});

/* =====================================================
   🏬 LISTAR LOCALES
===================================================== */
router.get("/locales", async (req, res) => {

  const { muni_id } = req.query;

  if (!muni_id) {
    return res.status(400).json({ error: "muni_id requerido" });
  }

  try {

    const result = await pool.query(
      `
      SELECT id,
             codigo_local,
             nombre_local,
             direccion,
             sector,
             lat,
             lng,
             activo,
             creado_en
      FROM locales
      WHERE muni_id = $1
        AND activo = true
      ORDER BY id DESC
      `,
      [muni_id]
    );

    res.json(result.rows);

  } catch (error) {
    console.error("❌ Error listando locales:", error);
    res.status(500).json({ error: "Error del servidor" });
  }

});
/* =====================================================
   ➕ CREAR LOCAL
===================================================== */
router.post("/locales", async (req, res) => {

  const {
    muni_id,
    codigo_local,
    nombre_local,
    direccion,
    sector,
    lat = null,
    lng = null
  } = req.body;

  if (!muni_id || !codigo_local || !nombre_local || !direccion) {
    return res.status(400).json({ error: "Datos incompletos" });
  }

  try {

    const result = await pool.query(
      `
      INSERT INTO locales (
        muni_id,
        codigo_local,
        nombre_local,
        direccion,
        sector,
        lat,
        lng
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id
      `,
      [
        muni_id,
        codigo_local,
        nombre_local,
        direccion,
        sector,
        lat,
        lng
      ]
    );

    res.json({ ok: true, id: result.rows[0].id });

  } catch (error) {

    if (error.code === "23505") {
      return res.status(400).json({
        error: "Código de local ya existe en esta municipalidad"
      });
    }

    console.error("❌ Error creando local:", error);
    res.status(500).json({ error: "Error del servidor" });
  }

});
/* =====================================================
   🗑 DESACTIVAR LOCAL
===================================================== */
router.delete("/locales/:id", async (req, res) => {

  const { id } = req.params;

  try {

    await pool.query(
      `
      UPDATE locales
      SET activo = false
      WHERE id = $1
      `,
      [id]
    );

    res.json({ ok: true });

  } catch (error) {
    console.error("❌ Error desactivando local:", error);
    res.status(500).json({ error: "Error del servidor" });
  }

});

/* =====================================================
   🏬 ÚLTIMA MARCACIÓN POR LOCAL (1 por codigo_local)
===================================================== */
router.get("/marcaciones-locales-actuales", async (req, res) => {
  const { muni_id } = req.query;

  if (!muni_id) {
    return res.status(400).json({ error: "muni_id requerido" });
  }

  try {
    const result = await pool.query(
      `
      SELECT DISTINCT ON (ml.codigo_local)
        ml.codigo_local,
        ml.nombre_local,
        ml.direccion,
        ml.lat,
        ml.lng,
        ml.created_at
      FROM marcaciones_locales ml
      WHERE ml.muni_id = $1
      ORDER BY ml.codigo_local, ml.created_at DESC
      `,
      [muni_id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error marcaciones-locales-actuales:", error);
    res.status(500).json({ error: "Error del servidor" });
  }
});
/* =====================================================
   🚨 GUARDAR INCIDENCIAS DELICTIVAS
===================================================== */

router.post("/incidencias-delictivas", async (req, res) => {

  const { muni_id, incidencias } = req.body;

  if (!muni_id || !Array.isArray(incidencias)) {

    return res.status(400).json({
      error: "Datos incompletos"
    });

  }

  const client = await pool.connect();

  try {

    await client.query("BEGIN");

    /* 🔥 BORRAR INFORMACIÓN ANTERIOR */
    await client.query(
      `
      DELETE FROM incidencias_delictivas
      WHERE muni_id = $1
      `,
      [muni_id]
    );

    /* 🔥 INSERTAR NUEVA INFORMACIÓN */
    for (const item of incidencias) {

      await client.query(
        `
        INSERT INTO incidencias_delictivas (

          muni_id,

          codcaso,
          feccaso,
          txthoracaso,

          tipodelito,
          modalidaddelito,

          tipo_via,
          calle,
          numerocalle,
          cuadra,

          sectorvecinal,
          subsectorvecinal,

          latitud,
          longitud,

          comisaria

        )
        VALUES (
          $1,$2,$3,$4,$5,
          $6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15
        )
        `,
        [

          muni_id,

          item.CODCASO,
          item.FECCASO,
          item.TXTHORACASO,

          item.TIPODELITO,
          item.MODALIDADDELITO,

          item["TIPO VIA"],
          item.CALLE,
          item.NUMEROCALLE,
          item.CUADRA,

          item.SECTORVECINAL,
          item.SUBSECTORVECINAL,

          item.LATITUD,
          item.LONGITUD,

          item.COMISARIA

        ]
      );

    }

    await client.query("COMMIT");

    res.json({
      ok: true
    });

  } catch (error) {

    await client.query("ROLLBACK");

    console.error(
      "❌ Error incidencias:",
      error
    );

    res.status(500).json({
      error: "Error del servidor"
    });

  } finally {

    client.release();

  }

});
/* =====================================================
   🔥 LISTAR INCIDENCIAS DELICTIVAS (MAPA CALOR)
===================================================== */

router.get("/incidencias-delictivas", async (req, res) => {

  const { muni_id, tipo } = req.query;

  if (!muni_id) {
    return res.status(400).json({
      error: "muni_id requerido"
    });
  }

  try {

    let query = `
      SELECT

        id,

        tipodelito,
        modalidaddelito,

        latitud,
        longitud,

        sectorvecinal,
        comisaria,

        created_at

      FROM incidencias_delictivas

      WHERE muni_id = $1
        AND latitud IS NOT NULL
        AND longitud IS NOT NULL
    `;

    const values = [muni_id];

    /* =====================================================
       🔥 FILTRO POR TIPO
    ===================================================== */

    if (
      tipo &&
      tipo !== "TODOS"
    ) {

      query += `
        AND UPPER(TRIM(tipodelito))
            = UPPER(TRIM($2))
      `;

      values.push(tipo);

    }

    query += `
      ORDER BY created_at DESC
    `;

    const result = await pool.query(
      query,
      values
    );

    res.json(result.rows);

  } catch (error) {

    console.error(
      "❌ Error listando incidencias:",
      error
    );

    res.status(500).json({
      error: "Error del servidor"
    });

  }

});
/* =====================================================
   📋 TIPOS DE DELITO
===================================================== */

router.get("/tipos-delito", async (req, res) => {

  const { muni_id } = req.query;

  if (!muni_id) {
    return res.status(400).json({
      error: "muni_id requerido"
    });
  }

  try {

    const result = await pool.query(
      `
      SELECT DISTINCT
        TRIM(tipodelito) AS tipodelito

      FROM incidencias_delictivas

      WHERE muni_id = $1
        AND tipodelito IS NOT NULL
        AND TRIM(tipodelito) <> ''

      ORDER BY tipodelito ASC
      `,
      [muni_id]
    );

    res.json(
      result.rows.map(
        r => r.tipodelito
      )
    );

  } catch (error) {

    console.error(
      "❌ Error tipos-delito:",
      error
    );

    res.status(500).json({
      error: "Error del servidor"
    });

  }

});

/* =====================================================
   📊 DASHBOARD INCIDENCIAS
===================================================== */

router.get("/dashboard-incidencias", async (req, res) => {

  const { muni_id, anio } = req.query;

  if (!muni_id) {
    return res.status(400).json({
      error: "muni_id requerido"
    });
  }

  try {

    let filtroAnio = "";
    const values = [muni_id];

    if (anio && anio !== "TODOS") {

      filtroAnio = `
        AND EXTRACT(YEAR FROM feccaso) = $2
      `;

      values.push(anio);

    }

    /* =====================================================
       🔥 AÑOS DISPONIBLES
    ===================================================== */

    const aniosResult = await pool.query(
      `
      SELECT DISTINCT
        EXTRACT(YEAR FROM feccaso)::INTEGER AS anio

      FROM incidencias_delictivas

      WHERE muni_id = $1
        AND feccaso IS NOT NULL

      ORDER BY anio DESC
      `,
      [muni_id]
    );

    /* =====================================================
       🔥 TOTAL INCIDENCIAS
    ===================================================== */

    const totalResult = await pool.query(
      `
      SELECT COUNT(*) AS total

      FROM incidencias_delictivas

      WHERE muni_id = $1
      ${filtroAnio}
      `,
      values
    );

    /* =====================================================
       🔥 TOP DELITOS
    ===================================================== */

    const delitosResult = await pool.query(
      `
      SELECT

        COALESCE(
          TRIM(tipodelito),
          'SIN DELITO'
        ) AS tipodelito,

        COUNT(*)::INTEGER AS total

      FROM incidencias_delictivas

      WHERE muni_id = $1
      ${filtroAnio}

      GROUP BY tipodelito

      ORDER BY total DESC

      LIMIT 10
      `,
      values
    );

    /* =====================================================
       🔥 TOP SECTORES
    ===================================================== */

    const sectoresResult = await pool.query(
      `
      SELECT

        COALESCE(
          TRIM(sectorvecinal),
          'SIN SECTOR'
        ) AS sectorvecinal,

        COUNT(*)::INTEGER AS total

      FROM incidencias_delictivas

      WHERE muni_id = $1
      ${filtroAnio}

      GROUP BY sectorvecinal

      ORDER BY total DESC

      LIMIT 10
      `,
      values
    );

    /* =====================================================
       🔥 DELITOS POR MES
    ===================================================== */

    const mesesResult = await pool.query(
      `
      SELECT

        EXTRACT(
          MONTH FROM feccaso
        )::INTEGER AS mes,

        COUNT(*)::INTEGER AS total

      FROM incidencias_delictivas

      WHERE muni_id = $1
        AND feccaso IS NOT NULL
        ${filtroAnio}

      GROUP BY mes

      ORDER BY mes ASC
      `,
      values
    );

    /* =====================================================
       📤 RESPUESTA
    ===================================================== */

    res.json({

      total_incidencias:
        Number(totalResult.rows[0].total),

      top_delitos:
        delitosResult.rows,

      top_sectores:
        sectoresResult.rows,

      delitos_mes:
        mesesResult.rows,

      anios:
        aniosResult.rows.map(
          r => r.anio
        )

    });

  } catch (error) {

    console.error(
      "❌ dashboard-incidencias:",
      error
    );

    res.status(500).json({
      error: "Error del servidor"
    });

  }

});

/* =====================================================
   🚓 RECORRIDO SUPERVISOR
===================================================== */
router.get("/recorrido-supervisor", async (req, res) => {

  const {
    muni_id,
    supervisor_id,
    gerencia,
    fecha,
    turno
  } = req.query;

  if (!muni_id || !supervisor_id) {
    return res.status(400).json({
      error: "muni_id y supervisor_id requeridos"
    });
  }

  try {

    let query = `
      SELECT
        ps.lat,
        ps.lng,
        ps.created_at,
        t.codigo_turno

      FROM patrullajes_supervisor ps

      LEFT JOIN supervisores s
        ON s.id = ps.supervisor_id

      LEFT JOIN turnos t
        ON t.id = ps.turno_id

      WHERE ps.muni_id = $1
        AND ps.supervisor_id = $2
    `;

    const values = [
      muni_id,
      supervisor_id
    ];

    let idx = 3;

    /* =====================================================
       📅 FILTRO FECHA
    ===================================================== */
    if (fecha) {

      query += `
        AND ps.fecha = $${idx}
      `;

      values.push(fecha);
      idx++;
    }

    /* =====================================================
       ⏰ FILTRO TURNO
    ===================================================== */
    if (
      turno &&
      turno !== "TODO" &&
      turno !== "TODOS"
    ) {

      query += `
        AND t.codigo_turno = $${idx}
      `;

      values.push(turno);
      idx++;
    }

    /* =====================================================
       🏛 FILTRO GERENCIA
    ===================================================== */
    if (
      gerencia &&
      gerencia.trim() !== ""
    ) {

      query += `
        AND TRIM(s.gerencia)
            = TRIM($${idx})
      `;

      values.push(
        gerencia.trim()
      );

      idx++;
    }

    query += `
      ORDER BY ps.created_at ASC
    `;

    const result = await pool.query(
      query,
      values
    );

    res.json(result.rows);

  } catch (error) {

    console.error(
      "❌ Error recorrido-supervisor:",
      error
    );

    res.status(500).json({
      error: "Error del servidor"
    });

  }

});
router.get("/dashboard-delito", async (req, res) => {

  const { muni_id, tipo, anio, mes } = req.query;

  if (!muni_id || !tipo) {
    return res.status(400).json({
      error: "muni_id y tipo requeridos"
    });
  }

  try {

    /* =====================================================
       FILTROS GENERALES
    ===================================================== */

    const values = [muni_id, tipo];

    let filtros = `
      WHERE muni_id = $1
      AND UPPER(TRIM(tipodelito))
          = UPPER(TRIM($2))
    `;

    let idx = 3;

    /* =====================================================
       FILTRO AÑO
    ===================================================== */

    if (anio && anio != "TODOS") {

      filtros += `
        AND EXTRACT(YEAR FROM feccaso) = $${idx}
      `;

      values.push(anio);

      idx++;
    }

    /* =====================================================
       FILTRO MES
       SOLO PARA CARDS
    ===================================================== */

    let filtrosMes = filtros;

    let valuesMes = [...values];

    let idxMes = idx;

    if (mes && mes != "TODOS") {

      filtrosMes += `
        AND EXTRACT(MONTH FROM feccaso) = $${idxMes}
      `;

      valuesMes.push(mes);

      idxMes++;
    }

    /* =====================================================
       TOTAL
    ===================================================== */

    const totalResult = await pool.query(
      `
      SELECT COUNT(*)::INTEGER AS total

      FROM incidencias_delictivas

      ${filtrosMes}
      `,
      valuesMes
    );

    /* =====================================================
       MODALIDADES
    ===================================================== */

    const modalidadesResult = await pool.query(
      `
      SELECT

        COALESCE(
          TRIM(modalidaddelito),
          'SIN MODALIDAD'
        ) AS modalidad,

        COUNT(*)::INTEGER AS total

      FROM incidencias_delictivas

      ${filtrosMes}

      GROUP BY modalidad

      ORDER BY total DESC
      `,
      valuesMes
    );

    /* =====================================================
       DELITOS POR MES
       🔥 SOLO AÑO
    ===================================================== */

    const mesesResult = await pool.query(
      `
      SELECT

        EXTRACT(
          MONTH FROM feccaso
        )::INTEGER AS mes,

        COUNT(*)::INTEGER AS total

      FROM incidencias_delictivas

      ${filtros}

      GROUP BY mes

      ORDER BY mes ASC
      `,
      values
    );

    /* =====================================================
       AÑOS DISPONIBLES
    ===================================================== */

    const aniosResult = await pool.query(
      `
      SELECT DISTINCT

        EXTRACT(
          YEAR FROM feccaso
        )::INTEGER AS anio

      FROM incidencias_delictivas

      WHERE muni_id = $1

      ORDER BY anio DESC
      `,
      [muni_id]
    );

    /* =====================================================
       RESPUESTA
    ===================================================== */

    res.json({

      total:
        Number(totalResult.rows[0].total),

      modalidades:
        modalidadesResult.rows,

      delitos_mes:
        mesesResult.rows,

      anios:
        aniosResult.rows.map(
          r => r.anio
        )

    });

  } catch (error) {

    console.error(
      "❌ dashboard-delito:",
      error
    );

    res.status(500).json({
      error: "Error del servidor"
    });

  }

});
/* =====================================================
   🏠 DASHBOARD HOME DIARIO
   - Filtro por fecha
   - Filtro por turno
   - Personal único
   - Escaneos con duplicados
   - Ranking de supervisores
   - Tracking + distancia recorrida
===================================================== */
router.get("/dashboard-home", async (req, res) => {

  const {
    muni_id,
    fecha,
    turno = "TODO"
  } = req.query;

  if (!muni_id) {
    return res.status(400).json({
      error: "muni_id requerido"
    });
  }

  try {

    const fechaConsulta =
      fecha ||
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date());

    const turnoConsulta =
      String(turno || "TODO")
        .trim()
        .toUpperCase();


    /* =====================================================
       FILTRO TURNO MARCACIONES
    ===================================================== */

    let filtroTurnoMarcaciones = "";
    const valoresMarcaciones = [
      muni_id,
      fechaConsulta
    ];

    if (
      turnoConsulta !== "TODO" &&
      turnoConsulta !== "TODOS"
    ) {

      filtroTurnoMarcaciones = `
        AND t.codigo_turno = $3
      `;

      valoresMarcaciones.push(
        turnoConsulta
      );
    }


    /* =====================================================
       FILTRO TURNO TRACKING
    ===================================================== */

    let filtroTurnoTracking = "";
    const valoresTracking = [
      muni_id,
      fechaConsulta
    ];

    if (
      turnoConsulta !== "TODO" &&
      turnoConsulta !== "TODOS"
    ) {

      filtroTurnoTracking = `
        AND t.codigo_turno = $3
      `;

      valoresTracking.push(
        turnoConsulta
      );
    }


    /* =====================================================
       1️⃣ KPI PERSONAL ÚNICO
    ===================================================== */

    const personalTotalResult =
      await pool.query(
        `
        SELECT
          COUNT(
            DISTINCT m.personal_dni
          )::INTEGER AS total

        FROM marcaciones m

        LEFT JOIN turnos t
          ON t.id = m.turno_id

        WHERE m.muni_id = $1
          AND m.fecha = $2

          ${filtroTurnoMarcaciones}
        `,
        valoresMarcaciones
      );


    /* =====================================================
       2️⃣ KPI TOTAL ESCANEOS
       DUPLICADOS SÍ CUENTAN
    ===================================================== */

    const escaneosTotalResult =
      await pool.query(
        `
        SELECT
          COUNT(*)::INTEGER AS total

        FROM marcaciones m

        LEFT JOIN turnos t
          ON t.id = m.turno_id

        WHERE m.muni_id = $1
          AND m.fecha = $2

          ${filtroTurnoMarcaciones}
        `,
        valoresMarcaciones
      );


    /* =====================================================
       3️⃣ KPI SUPERVISORES CON ACTIVIDAD
    ===================================================== */

    const supervisoresTotalResult =
      await pool.query(
        `
        SELECT
          COUNT(
            DISTINCT m.supervisor_id
          )::INTEGER AS total

        FROM marcaciones m

        LEFT JOIN turnos t
          ON t.id = m.turno_id

        WHERE m.muni_id = $1
          AND m.fecha = $2
          AND m.supervisor_id IS NOT NULL

          ${filtroTurnoMarcaciones}
        `,
        valoresMarcaciones
      );


    /* =====================================================
       4️⃣ PERSONAL REGISTRADO POR TURNO
    ===================================================== */

    const personalTurnos =
      await pool.query(
        `
        SELECT

          t.codigo_turno AS turno,

          COUNT(
            DISTINCT m.personal_dni
          )::INTEGER AS personal,

          COUNT(*)::INTEGER AS escaneos

        FROM marcaciones m

        LEFT JOIN turnos t
          ON t.id = m.turno_id

        WHERE m.muni_id = $1
          AND m.fecha = $2

        GROUP BY
          t.codigo_turno

        ORDER BY
          t.codigo_turno
        `,
        [
          muni_id,
          fechaConsulta
        ]
      );


    /* =====================================================
       5️⃣ RANKING SUPERVISORES POR ESCANEOS
       DUPLICADOS SÍ CUENTAN
    ===================================================== */

    const rankingEscaneos =
      await pool.query(
        `
        SELECT

          s.id AS supervisor_id,

          s.nombre AS supervisor,

          s.dni,

          t.codigo_turno AS turno,

          COUNT(*)::INTEGER AS escaneos,

          TO_CHAR(
            MIN(m.hora),
            'HH24:MI:SS'
          ) AS primer_escaneo,

          TO_CHAR(
            MAX(m.hora),
            'HH24:MI:SS'
          ) AS ultimo_escaneo

        FROM marcaciones m

        JOIN supervisores s
          ON s.id = m.supervisor_id

        LEFT JOIN turnos t
          ON t.id = m.turno_id

        WHERE m.muni_id = $1
          AND m.fecha = $2

          ${filtroTurnoMarcaciones}

        GROUP BY

          s.id,
          s.nombre,
          s.dni,
          t.codigo_turno

        ORDER BY

          escaneos DESC,
          s.nombre ASC
        `,
        valoresMarcaciones
      );


    /* =====================================================
       6️⃣ OBTENER PUNTOS DE TRACKING
       PARA CALCULAR DISTANCIA REAL
    ===================================================== */

    const trackingPuntos =
      await pool.query(
        `
        SELECT

          ps.supervisor_id,

          s.nombre AS supervisor,

          s.dni,

          t.codigo_turno AS turno,

          ps.lat,
          ps.lng,
          ps.created_at

        FROM patrullajes_supervisor ps

        JOIN supervisores s
          ON s.id = ps.supervisor_id

        LEFT JOIN turnos t
          ON t.id = ps.turno_id

        WHERE ps.muni_id = $1
          AND ps.fecha = $2

          ${filtroTurnoTracking}

        ORDER BY

          ps.supervisor_id,
          t.codigo_turno,
          ps.created_at ASC
        `,
        valoresTracking
      );


    /* =====================================================
       FUNCIÓN HAVERSINE
    ===================================================== */

    function distanciaMetros(
      lat1,
      lng1,
      lat2,
      lng2
    ) {

      const R = 6371000;

      const rad = grados =>
        grados * Math.PI / 180;

      const dLat =
        rad(lat2 - lat1);

      const dLng =
        rad(lng2 - lng1);

      const a =
        Math.sin(dLat / 2) *
        Math.sin(dLat / 2) +

        Math.cos(
          rad(lat1)
        ) *

        Math.cos(
          rad(lat2)
        ) *

        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);

      const c =
        2 *
        Math.atan2(
          Math.sqrt(a),
          Math.sqrt(1 - a)
        );

      return R * c;
    }


    /* =====================================================
       AGRUPAR TRACKING
    ===================================================== */

    const gruposTracking =
      new Map();

    for (
      const punto
      of trackingPuntos.rows
    ) {

      const key =
        `${punto.supervisor_id}__${punto.turno || "SIN_TURNO"}`;

      if (
        !gruposTracking.has(key)
      ) {

        gruposTracking.set(
          key,
          {
            supervisor_id:
              punto.supervisor_id,

            supervisor:
              punto.supervisor,

            dni:
              punto.dni,

            turno:
              punto.turno,

            puntos: []
          }
        );
      }

      const lat =
        Number(punto.lat);

      const lng =
        Number(punto.lng);

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        continue;
      }

      gruposTracking
        .get(key)
        .puntos
        .push({
          lat,
          lng,
          created_at:
            punto.created_at
        });
    }


    /* =====================================================
       CALCULAR RECORRIDOS
    ===================================================== */

    const rankingRecorridos = [];

    let recorridoTotalKm = 0;

    for (
      const grupo
      of gruposTracking.values()
    ) {

      const puntos =
        grupo.puntos;

      if (!puntos.length)
        continue;

      let metros = 0;

      for (
        let i = 1;
        i < puntos.length;
        i++
      ) {

        metros += distanciaMetros(
          puntos[i - 1].lat,
          puntos[i - 1].lng,
          puntos[i].lat,
          puntos[i].lng
        );
      }

      const distanciaKm =
        metros / 1000;

      recorridoTotalKm +=
        distanciaKm;

      const inicio =
        puntos[0]
          ?.created_at;

      const fin =
        puntos[
          puntos.length - 1
        ]?.created_at;

      rankingRecorridos.push({

        supervisor_id:
          grupo.supervisor_id,

        supervisor:
          grupo.supervisor,

        dni:
          grupo.dni,

        turno:
          grupo.turno,

        hora_inicio:
          inicio
            ? new Intl.DateTimeFormat(
                "es-PE",
                {
                  timeZone:
                    "America/Lima",

                  hour:
                    "2-digit",

                  minute:
                    "2-digit",

                  second:
                    "2-digit",

                  hour12:
                    false
                }
              ).format(
                new Date(inicio)
              )
            : "—",

        hora_fin:
          fin
            ? new Intl.DateTimeFormat(
                "es-PE",
                {
                  timeZone:
                    "America/Lima",

                  hour:
                    "2-digit",

                  minute:
                    "2-digit",

                  second:
                    "2-digit",

                  hour12:
                    false
                }
              ).format(
                new Date(fin)
              )
            : "—",

        distancia_km:
          Number(
            distanciaKm.toFixed(2)
          ),

        puntos_tracking:
          puntos.length

      });
    }


    /* =====================================================
       ORDENAR RANKING RECORRIDO
    ===================================================== */

    rankingRecorridos.sort(
      (a, b) =>
        b.distancia_km -
        a.distancia_km
    );


    /* =====================================================
       RESPUESTA FINAL COMPATIBLE CON HOME.JS
    ===================================================== */

    res.json({

      fecha:
        fechaConsulta,

      turno:
        turnoConsulta,

      kpis: {

        personal_total:
          Number(
            personalTotalResult
              .rows[0]
              ?.total || 0
          ),

        escaneos_total:
          Number(
            escaneosTotalResult
              .rows[0]
              ?.total || 0
          ),

        supervisores_total:
          Number(
            supervisoresTotalResult
              .rows[0]
              ?.total || 0
          ),

        recorrido_total_km:
          Number(
            recorridoTotalKm
              .toFixed(2)
          )

      },

      personal_por_turno:
        personalTurnos.rows,

      ranking_escaneos:
        rankingEscaneos.rows,

      ranking_recorridos:
        rankingRecorridos

    });

  } catch (error) {

    console.error(
      "❌ dashboard-home:",
      error
    );

    res.status(500).json({
      error:
        "Error obteniendo dashboard",
      detalle:
        error.message
    });

  }

});
module.exports = router;






