const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../../db/pool");
const { assinarToken, autenticar } = require("../middleware/auth");
const { estaUtilizadorLigado } = require("../sockets");

const router = express.Router();

// POST /api/auth/registar
router.post("/registar", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ erro: "Nome, e-mail e password são obrigatórios." });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const cores = ["#0EA5B7", "#E67E22", "#8E44AD", "#27AE60", "#C0392B"];
    const cor = cores[Math.floor(Math.random() * cores.length)];

    // O primeiro utilizador alguma vez criado torna-se automaticamente administrador.
    const { rows: contagem } = await pool.query(`SELECT COUNT(*)::int AS total FROM gpitrack.users`);
    const role = contagem[0].total === 0 ? "admin" : "member";

    const { rows } = await pool.query(
      `INSERT INTO gpitrack.users (name, email, password_hash, avatar_color, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, avatar_color, role`,
      [name, email, hash, cor, role]
    );
    const user = rows[0];
    const token = assinarToken(user);
    // Nota: já não definimos um cookie de sessão partilhado — o token é
    // devolvido no corpo da resposta e guardado pelo cliente em
    // sessionStorage, isolado por separador do navegador. Isto permite
    // que várias contas fiquem ligadas em simultâneo em separadores
    // diferentes do mesmo browser, sem uma sessão "pisar" a outra.
    res.status(201).json({ user, token });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ erro: "Já existe uma conta com este e-mail." });
    }
    console.error(err);
    res.status(500).json({ erro: "Erro ao registar utilizador." });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, password_hash, avatar_color, role, is_active
       FROM gpitrack.users WHERE email = $1`,
      [email]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ erro: "Credenciais inválidas." });

    if (!user.is_active) {
      return res.status(403).json({ erro: "Esta conta foi desativada por um administrador." });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ erro: "Credenciais inválidas." });

    // Impede que a mesma conta tenha duas sessões em simultâneo (outro
    // separador, outro navegador, ou outro dispositivo). A verificação
    // usa a ligação em tempo real (Socket.IO) como fonte da verdade: se
    // essa sessão anterior for encerrada (separador fechado, logout, ou
    // perda de ligação), o lugar liberta-se automaticamente.
    if (estaUtilizadorLigado(user.id)) {
      return res.status(409).json({
        erro: `Este utilizador já está autenticado noutro separador, navegador ou dispositivo. Termine essa sessão antes de iniciar uma nova.`,
      });
    }

    await pool.query(`UPDATE gpitrack.users SET last_seen_at = now() WHERE id = $1`, [user.id]);

    delete user.password_hash;
    delete user.is_active;
    const token = assinarToken(user);
    res.json({ user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao iniciar sessão." });
  }
});

// POST /api/auth/logout
router.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

// GET /api/auth/eu — dados do utilizador autenticado (revalida estado atual na BD)
router.get("/eu", autenticar, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, avatar_color, role, is_active FROM gpitrack.users WHERE id = $1`,
      [req.user.id]
    );
    const atual = rows[0];
    if (!atual || !atual.is_active) {
      res.clearCookie("token");
      return res.status(401).json({ erro: "Conta desativada." });
    }
    res.json({ user: atual });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter dados do utilizador." });
  }
});

module.exports = router;
