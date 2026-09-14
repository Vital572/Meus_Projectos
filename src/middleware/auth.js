const jwt = require("jsonwebtoken");
const pool = require("../../db/pool");

const JWT_SECRET = process.env.JWT_SECRET || "gpi-track-segredo-de-desenvolvimento";

function assinarToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role || "member" },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function autenticar(req, res, next) {
  // O cabeçalho Authorization (enviado a partir do sessionStorage, isolado por
  // separador do navegador) tem prioridade. O parâmetro ?token= existe para
  // pedidos que o próprio browser faz diretamente (abrir um anexo, mostrar
  // uma imagem, tocar um áudio) e que por isso não conseguem enviar
  // cabeçalhos personalizados. O cookie fica como último recurso.
  const token = req.headers.authorization?.replace("Bearer ", "") || req.query?.token || req.cookies?.token;
  if (!token) {
    return res.status(401).json({ erro: "Não autenticado." });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ erro: "Sessão inválida ou expirada." });
  }
}

// A usar depois de "autenticar": exige que o utilizador seja administrador.
// Verifica sempre o estado atual na base de dados (não confia apenas no token),
// para que uma despromoção ou desativação tenha efeito imediato.
async function exigirAdmin(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT role, is_active FROM gpitrack.users WHERE id = $1`,
      [req.user.id]
    );
    const atual = rows[0];
    if (!atual || !atual.is_active) {
      return res.status(403).json({ erro: "Conta inexistente ou desativada." });
    }
    if (atual.role !== "admin") {
      return res.status(403).json({ erro: "Acesso restrito a administradores." });
    }
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao validar permissões." });
  }
}

module.exports = { assinarToken, autenticar, exigirAdmin, JWT_SECRET };
