const express = require("express");
const pool = require("../../db/pool");
const { autenticar } = require("../middleware/auth");

const router = express.Router();
router.use(autenticar);

// GET /api/notifications — últimas notificações do utilizador autenticado
router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, content, project_id, task_id, is_read, created_at
       FROM gpitrack.notifications WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 30`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter notificações." });
  }
});

// PATCH /api/notifications/:id/lida — marca uma notificação como lida
router.patch("/:id/lida", async (req, res) => {
  try {
    await pool.query(
      `UPDATE gpitrack.notifications SET is_read = true WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao marcar notificação como lida." });
  }
});

// PATCH /api/notifications/lidas — marca todas como lidas
router.patch("/lidas", async (req, res) => {
  try {
    await pool.query(
      `UPDATE gpitrack.notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao marcar notificações como lidas." });
  }
});

module.exports = router;
