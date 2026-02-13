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

    // 🔎 1️⃣ BUSCAR MUNICIPALIDAD POR CÓDIGO
    const muni = await pool.query(
      `SELECT id FROM municipalidades WHERE codigo = $1`,
      [codigo]
    );

    if (muni.rows.length === 0) {
      return res.status(404).json({ error: "Municipalidad no encontrada" });
    }

    const muni_id = muni.rows[0].id;

    // 🔎 2️⃣ BUSCAR USUARIO
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

    // 🔐 3️⃣ VALIDAR PASSWORD
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    res.json({
      ok: true,
      nombre: user.nombre,
      rol: user.rol
    });

  } catch (error) {
    console.error("❌ Error login:", error);
    res.status(500).json({ error: "Error servidor" });
  }
});


module.exports = router;


