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

    /* 1️⃣ VALIDAR QUE LLEGUEN DATOS */
    if (!codigo || !correo || !password) {
      return res.status(400).json({ error: "Datos incompletos" });
    }

    /* 2️⃣ BUSCAR MUNICIPALIDAD */
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

    /* 3️⃣ BUSCAR USUARIO WEB */
    const result = await pool.query(
      `
      SELECT id, nombre, password_hash, rol
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

    /* 4️⃣ VALIDAR PASSWORD */
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    /* 5️⃣ RESPUESTA COMPLETA PARA FRONTEND */
    res.json({
      ok: true,
      muni_id: muni_id,
      muni_nombre: muni_nombre,
      nombre: user.nombre,
      rol: user.rol
    });

  } catch (error) {
    console.error("❌ Error login:", error);
    res.status(500).json({ error: "Error del servidor" });
  }

});

module.exports = router;
