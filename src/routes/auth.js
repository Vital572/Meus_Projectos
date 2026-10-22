const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const pool = require("../../db/pool");
const { assinarToken, assinarTokenMFA, autenticar, JWT_SECRET } = require("../middleware/auth");
const { estaUtilizadorLigado } = require("../sockets");
const { avaliarSenha } = require("../../public/js/password-strength");
const { enviarEmailRecuperacao, urlBase } = require("../lib/email");
const jwt = require("jsonwebtoken");
const { authenticator } = require("otplib");
const qrcode = require("qrcode");

// Login com Google: só fica ativo se GOOGLE_CLIENT_ID estiver no .env.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;
let clienteGoogle = null;
if (GOOGLE_CLIENT_ID) {
  const { OAuth2Client } = require("google-auth-library");
  clienteGoogle = new OAuth2Client(GOOGLE_CLIENT_ID);
}

const MINUTOS_VALIDADE_RECUPERACAO = 60;
const CORES_AVATAR = ["#0EA5B7", "#E67E22", "#8E44AD", "#27AE60", "#C0392B"];
const MSG_SESSAO_ATIVA =
  "Este utilizador já está autenticado noutro separador, navegador ou dispositivo. Termine essa sessão antes de iniciar uma nova.";

const sha256 = (t) => crypto.createHash("sha256").update(t).digest("hex");

/** Valida a password com a mesma regra da barra de progressão. Devolve texto de erro ou null. */
function validarSenha(password) {
  if (typeof password !== "string" || !password) return "A password é obrigatória.";
  if (password.length > 128) return "A password é demasiado longa (máximo 128 caracteres).";
  const r = avaliarSenha(password);
  if (!r.aceite) {
    return `A password é demasiado fraca (${r.rotulo.toLowerCase()}). Use pelo menos 8 caracteres, misturando maiúsculas, minúsculas, números e/ou símbolos.`;
  }
  return null;
}

const router = express.Router();

// GET /api/auth/config — informação pública necessária ao ecrã de entrada
router.get("/config", (req, res) => {
  res.json({
    googleClientId: GOOGLE_CLIENT_ID,
    // A "conta de demonstração" só se mostra em desenvolvimento (MOSTRAR_CONTA_DEMO=true).
    mostrarContaDemo: process.env.MOSTRAR_CONTA_DEMO === "true",
  });
});


// POST /api/auth/registar
router.post("/registar", async (req, res) => {
  const { password } = req.body;
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim();
  if (!name || !email || !password) {
    return res.status(400).json({ erro: "Nome, e-mail e password são obrigatórios." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ erro: "Indique um e-mail válido." });
  }
  const erroSenha = validarSenha(password);
  if (erroSenha) return res.status(400).json({ erro: erroSenha });
  try {
    const hash = await bcrypt.hash(password, 10);
    const cor = CORES_AVATAR[Math.floor(Math.random() * CORES_AVATAR.length)];

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
      `SELECT id, name, email, password_hash, avatar_color, role, is_active, mfa_enabled
       FROM gpitrack.users WHERE email = $1`,
      [email]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ erro: "Credenciais inválidas." });

    if (!user.is_active) {
      return res.status(403).json({ erro: "Esta conta foi desativada por um administrador." });
    }

    if (!user.password_hash) {
      return res.status(401).json({
        erro: "Esta conta foi criada com o Google. Entre com o botão do Google, ou use \"Esqueceu a password?\" para definir uma password.",
      });
    }
    const ok = await bcrypt.compare(password || "", user.password_hash);
    if (!ok) return res.status(401).json({ erro: "Credenciais inválidas." });

    // Password certa, mas se a conta tem autenticação de dois fatores ativa
    // ainda não entra — fica à espera do código da app autenticadora. O
    // "mfa_token" é só um bilhete de 5 minutos para o próximo pedido, nunca
    // uma sessão válida (ver assinarTokenMFA/autenticar).
    if (user.mfa_enabled) {
      return res.json({ mfa_required: true, mfa_token: assinarTokenMFA(user.id) });
    }

    // Impede que a mesma conta tenha duas sessões em simultâneo (outro
    // separador, outro navegador, ou outro dispositivo). A verificação
    // usa a ligação em tempo real (Socket.IO) como fonte da verdade: se
    // essa sessão anterior for encerrada (separador fechado, logout, ou
    // perda de ligação), o lugar liberta-se automaticamente.
    if (estaUtilizadorLigado(user.id)) {
      return res.status(409).json({ erro: MSG_SESSAO_ATIVA });
    }

    await pool.query(`UPDATE gpitrack.users SET last_seen_at = now() WHERE id = $1`, [user.id]);

    delete user.password_hash;
    delete user.is_active;
    delete user.mfa_enabled;
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

// ---------------- Autenticação de dois fatores (2FA / MFA, TOTP) ----------------

// POST /api/auth/mfa/verificar-login — segundo passo do login quando a conta
// tem 2FA ativo: troca o "mfa_token" de 5 minutos + o código de 6 dígitos da
// app autenticadora pela sessão normal (igual ao que /login devolvia antes).
router.post("/mfa/verificar-login", async (req, res) => {
  const { mfa_token, code } = req.body;
  if (!mfa_token || !code) return res.status(400).json({ erro: "Código em falta." });

  let payload;
  try {
    payload = jwt.verify(mfa_token, JWT_SECRET);
  } catch {
    return res.status(401).json({ erro: "Este pedido expirou. Volte a entrar com a password." });
  }
  if (!payload.mfaPending) return res.status(401).json({ erro: "Pedido inválido." });

  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, avatar_color, role, is_active, mfa_secret FROM gpitrack.users WHERE id = $1`,
      [payload.id]
    );
    const user = rows[0];
    if (!user || !user.is_active || !user.mfa_secret) {
      return res.status(401).json({ erro: "Não foi possível validar o código." });
    }
    if (!authenticator.check(String(code).trim(), user.mfa_secret)) {
      return res.status(401).json({ erro: "Código incorreto. Verifique a app autenticadora e tente de novo." });
    }
    if (estaUtilizadorLigado(user.id)) {
      return res.status(409).json({ erro: MSG_SESSAO_ATIVA });
    }
    await pool.query(`UPDATE gpitrack.users SET last_seen_at = now() WHERE id = $1`, [user.id]);
    delete user.is_active;
    delete user.mfa_secret;
    res.json({ user, token: assinarToken(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao validar o código." });
  }
});

// GET /api/auth/mfa/configurar — gera (ou reaproveita) um segredo TOTP ainda
// por confirmar e devolve o QR code para o ler numa app autenticadora.
// Só fica "ativo" de facto depois de /mfa/ativar confirmar um código certo.
router.get("/mfa/configurar", autenticar, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT email, mfa_enabled FROM gpitrack.users WHERE id = $1`, [req.user.id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ erro: "Utilizador não encontrado." });
    if (user.mfa_enabled) return res.status(400).json({ erro: "A autenticação de dois fatores já está ativa." });

    const secret = authenticator.generateSecret();
    await pool.query(`UPDATE gpitrack.users SET mfa_secret = $1 WHERE id = $2`, [secret, req.user.id]);

    const otpauth = authenticator.keyuri(user.email, "GPI Track", secret);
    const qrCodeDataUrl = await qrcode.toDataURL(otpauth);
    res.json({ secret, qrCodeDataUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao preparar a autenticação de dois fatores." });
  }
});

// POST /api/auth/mfa/ativar — confirma o primeiro código gerado pela app e,
// se bater certo, ativa definitivamente a 2FA nesta conta.
router.post("/mfa/ativar", autenticar, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ erro: "Indique o código de 6 dígitos." });
  try {
    const { rows } = await pool.query(`SELECT mfa_secret FROM gpitrack.users WHERE id = $1`, [req.user.id]);
    const secret = rows[0]?.mfa_secret;
    if (!secret) return res.status(400).json({ erro: "Peça primeiro o QR code em \"Configurar\"." });
    if (!authenticator.check(String(code).trim(), secret)) {
      return res.status(400).json({ erro: "Código incorreto. Confirme a hora do telemóvel e tente de novo." });
    }
    await pool.query(`UPDATE gpitrack.users SET mfa_enabled = true WHERE id = $1`, [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao ativar a autenticação de dois fatores." });
  }
});

// POST /api/auth/mfa/desativar — exige a password atual (contas Google-only
// sem password confirmam só com o código atual da app, como alternativa).
router.post("/mfa/desativar", autenticar, async (req, res) => {
  const { password, code } = req.body;
  try {
    const { rows } = await pool.query(
      `SELECT password_hash, mfa_secret, mfa_enabled FROM gpitrack.users WHERE id = $1`,
      [req.user.id]
    );
    const user = rows[0];
    if (!user || !user.mfa_enabled) return res.status(400).json({ erro: "A autenticação de dois fatores não está ativa." });

    let confirmado = false;
    if (user.password_hash && password) {
      confirmado = await bcrypt.compare(password, user.password_hash);
    } else if (code) {
      confirmado = authenticator.check(String(code).trim(), user.mfa_secret);
    }
    if (!confirmado) return res.status(401).json({ erro: "Confirmação incorreta." });

    await pool.query(`UPDATE gpitrack.users SET mfa_enabled = false, mfa_secret = NULL WHERE id = $1`, [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao desativar a autenticação de dois fatores." });
  }
});

// GET /api/auth/eu — dados do utilizador autenticado (revalida estado atual na BD)
router.get("/eu", autenticar, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, avatar_color, role, is_active, email_notificacoes, mfa_enabled,
              (password_hash IS NOT NULL) AS tem_password
       FROM gpitrack.users WHERE id = $1`,
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

// POST /api/auth/google — entrada/registo com a conta Google (Google Identity Services)
router.post("/google", async (req, res) => {
  if (!clienteGoogle) {
    return res.status(503).json({ erro: "O login com Google não está configurado neste servidor." });
  }
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ erro: "Credencial Google em falta." });

  try {
    let dados;
    try {
      const ticket = await clienteGoogle.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
      dados = ticket.getPayload();
    } catch {
      return res.status(401).json({ erro: "Não foi possível validar a conta Google. Tente novamente." });
    }
    if (!dados?.email || !dados.email_verified) {
      return res.status(401).json({ erro: "O e-mail desta conta Google não está verificado." });
    }

    const { rows } = await pool.query(
      `SELECT id, name, email, avatar_color, role, is_active, google_id, mfa_enabled
       FROM gpitrack.users WHERE google_id = $1 OR lower(email) = lower($2)
       ORDER BY (google_id = $1) DESC NULLS LAST LIMIT 1`,
      [dados.sub, dados.email]
    );
    let user = rows[0];
    let novo = false;

    if (user) {
      if (!user.is_active) {
        return res.status(403).json({ erro: "Esta conta foi desativada por um administrador." });
      }
      if (!user.google_id) {
        // Conta já existente com o mesmo e-mail (verificado pelo Google): associa-a.
        // O e-mail de uma conta criada com password nunca foi confirmado; por isso, se alguém
        // se tivesse registado antes com o e-mail de outra pessoa, ficaria com acesso à conta
        // dela depois de esta entrar com o Google. Para o impedir, a password antiga é
        // anulada ao associar — a pessoa entra com o Google (ou define uma nova password
        // em "Esqueceu a password?").
        await pool.query(
          `UPDATE gpitrack.users SET google_id = $1, password_hash = NULL WHERE id = $2`,
          [dados.sub, user.id]
        );
      }
    } else {
      const { rows: contagem } = await pool.query(`SELECT COUNT(*)::int AS total FROM gpitrack.users`);
      const role = contagem[0].total === 0 ? "admin" : "member";
      const cor = CORES_AVATAR[Math.floor(Math.random() * CORES_AVATAR.length)];
      const nome = (dados.name || dados.email.split("@")[0]).slice(0, 120);
      const inserido = await pool.query(
        `INSERT INTO gpitrack.users (name, email, google_id, avatar_color, role)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, avatar_color, role, is_active`,
        [nome, dados.email, dados.sub, cor, role]
      );
      user = inserido.rows[0];
      novo = true;
    }

    // Contas com autenticação de dois fatores: o Google não dispensa o código da app
    // autenticadora (igual ao que acontece no login com password).
    if (user.mfa_enabled) {
      return res.json({ mfa_required: true, mfa_token: assinarTokenMFA(user.id) });
    }

    // Mesma regra de sessão única do login normal.
    if (estaUtilizadorLigado(user.id)) {
      return res.status(409).json({ erro: MSG_SESSAO_ATIVA });
    }

    await pool.query(`UPDATE gpitrack.users SET last_seen_at = now() WHERE id = $1`, [user.id]);
    const publico = { id: user.id, name: user.name, email: user.email, avatar_color: user.avatar_color, role: user.role };
    res.json({ user: publico, token: assinarToken(publico), novo });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ erro: "Já existe uma conta com este e-mail. Tente novamente." });
    }
    console.error(err);
    res.status(500).json({ erro: "Erro ao entrar com o Google." });
  }
});

// POST /api/auth/esqueci-senha — pede um e-mail de recuperação.
// Responde SEMPRE o mesmo, exista a conta ou não, para não revelar que e-mails estão registados.
router.post("/esqueci-senha", async (req, res) => {
  const email = String(req.body.email || "").trim();
  res.json({ ok: true, mensagem: "Se existir uma conta com este e-mail, enviámos as instruções de recuperação." });
  if (!email) return;

  // O resto corre depois de responder: o tempo de resposta não denuncia se a conta existe.
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, is_active FROM gpitrack.users WHERE lower(email) = lower($1)`,
      [email]
    );
    const user = rows[0];
    if (!user || !user.is_active) return;

    // Evita encher a caixa de entrada de alguém com pedidos repetidos.
    const recente = await pool.query(
      `SELECT 1 FROM gpitrack.password_resets WHERE user_id = $1 AND created_at > now() - interval '60 seconds'`,
      [user.id]
    );
    if (recente.rowCount > 0) return;

    const token = crypto.randomBytes(32).toString("hex");
    await pool.query(
      `INSERT INTO gpitrack.password_resets (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + make_interval(mins => $3::int))`,
      [user.id, sha256(token), MINUTOS_VALIDADE_RECUPERACAO]
    );
    const link = `${urlBase()}/redefinir-senha.html?token=${token}`;
    const r = await enviarEmailRecuperacao({ nome: user.name, email: user.email, link, minutos: MINUTOS_VALIDADE_RECUPERACAO });
    if (!r.enviado) console.log(`[recuperação] E-mail não enviado (${r.motivo}). Link de teste para ${user.email}:\n${link}\n`);
  } catch (err) {
    console.error("[recuperação] erro:", err);
  }
});

// POST /api/auth/validar-token-recuperacao — a página de redefinição confirma se a ligação ainda é válida
router.post("/validar-token-recuperacao", async (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== "string") return res.status(400).json({ valido: false });
  try {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM gpitrack.password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [sha256(token)]
    );
    res.json({ valido: rowCount > 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ valido: false });
  }
});

// POST /api/auth/redefinir-senha — define a nova password com o token recebido por e-mail
router.post("/redefinir-senha", async (req, res) => {
  const { token, password } = req.body;
  if (!token || typeof token !== "string") return res.status(400).json({ erro: "Ligação de recuperação inválida." });
  const erroSenha = validarSenha(password);
  if (erroSenha) return res.status(400).json({ erro: erroSenha });

  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    const { rows } = await cliente.query(
      `SELECT id, user_id FROM gpitrack.password_resets
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
      [sha256(token)]
    );
    const pedido = rows[0];
    if (!pedido) {
      await cliente.query("ROLLBACK");
      return res.status(400).json({ erro: "Esta ligação é inválida ou já expirou. Peça uma nova recuperação." });
    }
    const hash = await bcrypt.hash(password, 10);
    await cliente.query(`UPDATE gpitrack.users SET password_hash = $1 WHERE id = $2`, [hash, pedido.user_id]);
    // Invalida este e quaisquer outros pedidos pendentes do mesmo utilizador.
    await cliente.query(
      `UPDATE gpitrack.password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
      [pedido.user_id]
    );
    await cliente.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await cliente.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.status(500).json({ erro: "Erro ao redefinir a password." });
  } finally {
    cliente.release();
  }
});

// PATCH /api/auth/preferencias — ligar/desligar as notificações por e-mail
router.patch("/preferencias", autenticar, async (req, res) => {
  const { email_notificacoes } = req.body;
  if (typeof email_notificacoes !== "boolean") return res.status(400).json({ erro: "Valor inválido." });
  try {
    await pool.query(`UPDATE gpitrack.users SET email_notificacoes = $1 WHERE id = $2`, [email_notificacoes, req.user.id]);
    res.json({ ok: true, email_notificacoes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao guardar a preferência." });
  }
});

module.exports = router;
