const express = require("express");
const pool = require("../../db/pool");
const { enviarEmailFeedback } = require("../lib/email");

const router = express.Router();

// POST /api/feedback — pública (não exige sessão), para a página inicial e
// para quem estiver autenticado no Espaço de Gestão. Fica guardada na base de
// dados; a plataforma ainda não tem um serviço de e-mail configurado, por
// isso não é enviada por e-mail — é vista na Administração.
router.post("/", async (req, res) => {
  const { name, email, message, page } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ erro: "Escreva a sua mensagem antes de enviar." });
  }
  if (message.trim().length > 3000) {
    return res.status(400).json({ erro: "Mensagem demasiado longa (máximo 3000 caracteres)." });
  }

  try {
    const nomeFinal = (name || "").trim().slice(0, 150) || null;
    const emailFinal = (email || "").trim().slice(0, 255) || null;
    const mensagemFinal = message.trim();
    const paginaFinal = (page || "").slice(0, 100) || null;

    await pool.query(
      `INSERT INTO gpitrack.feedback (name, email, message, page) VALUES ($1, $2, $3, $4)`,
      [nomeFinal, emailFinal, mensagemFinal, paginaFinal]
    );

    // O feedback já ficou guardado — o e-mail é um extra, por isso uma falha
    // aqui nunca impede a resposta de sucesso ao utilizador.
    enviarEmailFeedback({ name: nomeFinal, email: emailFinal, message: mensagemFinal, page: paginaFinal }).catch(() => {});

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao enviar feedback." });
  }
});

module.exports = router;
