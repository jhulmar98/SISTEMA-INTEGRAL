const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const pool = require("./db");

/* =====================================================
   🏢 LISTAR GERENCIAS
===================================================== */
router.get("/gerencias", async (req, res) => {

  const { muni_id } = req.query;

  if (!muni_id) {
    return res.status(400).json({ error: "muni_id requerido" });
  }

  try {

    const result = await pool.query(
      `
      SELECT id, nombre
      FROM gerencias
      WHERE muni_id = $1
        AND activo = true
      ORDER BY nombre ASC
      `,
      [muni_id]
    );

    res.json(result.rows);

  } catch (error) {

    console.error("❌ Error listando gerencias:", error);
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
      SELECT id, nombre
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


module.exports = router;

