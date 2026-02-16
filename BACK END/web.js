const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const pool = require("./db");

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
      muni_id: muni_id,
      muni_nombre: muni_nombre,
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
   👥 OBTENER GERENCIAS
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

    res.json(result.rows.map(r => r.gerencia));

  } catch (error) {
    console.error("❌ Error obteniendo gerencias:", error);
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
      INSERT INTO usuarios_web (
        muni_id,
        nombre,
        correo,
        password_hash,
        rol
      )
      VALUES ($1,$2,$3,$4,$5)
      RETURNING id
      `,
      [muni_id, nombre, correo, hash, rol]
    );

    res.json({
      ok: true,
      id: result.rows[0].id
    });

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


module.exports = router;
