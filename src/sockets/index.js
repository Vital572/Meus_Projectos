const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../middleware/auth");
const pool = require("../../db/pool");

// presença por projeto: Map<projectId, Map<socketId, {id, name}>>
const presencaProjeto = new Map();

// presença global (para o painel de administração): Map<socketId, {id, name, email, role, entrouEm}>
const presencaGlobal = new Map();

let ioRef = null;

function utilizadoresOnlineProjeto(projectId) {
  const mapa = presencaProjeto.get(projectId);
  if (!mapa) return [];
  const vistos = new Set();
  const lista = [];
  for (const u of mapa.values()) {
    if (!vistos.has(u.id)) { vistos.add(u.id); lista.push(u); }
  }
  return lista;
}

function utilizadoresOnlineGlobal() {
  const vistos = new Set();
  const lista = [];
  for (const u of presencaGlobal.values()) {
    if (!vistos.has(u.id)) { vistos.add(u.id); lista.push(u); }
  }
  return lista;
}

function difundirPresencaGlobal() {
  if (!ioRef) return;
  ioRef.to("admins").emit("admin:presence", utilizadoresOnlineGlobal());
}

/**
 * Desliga imediatamente todas as ligações ativas de um utilizador.
 * Usado quando um administrador desativa uma conta em tempo real.
 */
function desconectarUtilizador(userId, motivo) {
  if (!ioRef) return;
  for (const [, socket] of ioRef.sockets.sockets) {
    if (socket.user?.id === userId) {
      socket.emit("conta:desativada", { motivo });
      socket.disconnect(true);
    }
  }
}

function configurarSockets(io) {
  ioRef = io;

  // Autenticação do socket via token JWT (cookie ou auth payload)
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers.cookie
          ?.split("; ")
          .find((c) => c.startsWith("token="))
          ?.split("=")[1];
      if (!token) return next(new Error("Sem token de autenticação."));
      const payload = jwt.verify(token, JWT_SECRET);

      // Revalida o estado da conta na base de dados (pode ter sido desativada)
      const { rows } = await pool.query(
        `SELECT role, is_active FROM gpitrack.users WHERE id = $1`,
        [payload.id]
      );
      if (!rows[0] || !rows[0].is_active) return next(new Error("Conta desativada."));

      socket.user = { ...payload, role: rows[0].role };
      next();
    } catch (err) {
      next(new Error("Token inválido."));
    }
  });

  io.on("connection", (socket) => {
    console.log(`[socket] Ligado: ${socket.user.name} (${socket.id})`);

    // Sala pessoal — usada para notificações e para forçar logout
    socket.join(`user:${socket.user.id}`);

    presencaGlobal.set(socket.id, {
      id: socket.user.id,
      name: socket.user.name,
      email: socket.user.email,
      role: socket.user.role,
      entrouEm: new Date().toISOString(),
    });
    if (socket.user.role === "admin") socket.join("admins");
    difundirPresencaGlobal();

    pool.query(`UPDATE gpitrack.users SET last_seen_at = now() WHERE id = $1`, [socket.user.id]).catch(() => {});

    // O cliente entra na "sala" do projeto que está a visualizar
    socket.on("project:entrar", (projectId) => {
      socket.join(`project:${projectId}`);
      socket.data.projectId = projectId;

      if (!presencaProjeto.has(projectId)) presencaProjeto.set(projectId, new Map());
      presencaProjeto.get(projectId).set(socket.id, { id: socket.user.id, name: socket.user.name });

      io.to(`project:${projectId}`).emit("presence:update", utilizadoresOnlineProjeto(projectId));
    });

    socket.on("project:sair", (projectId) => {
      socket.leave(`project:${projectId}`);
      presencaProjeto.get(projectId)?.delete(socket.id);
      io.to(`project:${projectId}`).emit("presence:update", utilizadoresOnlineProjeto(projectId));
    });

    // Indicador "a escrever..." num comentário
    socket.on("comment:digitando", ({ projectId, taskId }) => {
      socket.to(`project:${projectId}`).emit("comment:digitando", { taskId, user: socket.user.name });
    });

    socket.on("disconnect", () => {
      const projectId = socket.data.projectId;
      if (projectId && presencaProjeto.has(projectId)) {
        presencaProjeto.get(projectId).delete(socket.id);
        io.to(`project:${projectId}`).emit("presence:update", utilizadoresOnlineProjeto(projectId));
      }
      presencaGlobal.delete(socket.id);
      difundirPresencaGlobal();
      pool.query(`UPDATE gpitrack.users SET last_seen_at = now() WHERE id = $1`, [socket.user.id]).catch(() => {});
      console.log(`[socket] Desligado: ${socket.user?.name} (${socket.id})`);
    });
  });
}

/** true se este utilizador já tem, neste momento, pelo menos uma ligação em tempo real ativa. */
function estaUtilizadorLigado(userId) {
  for (const u of presencaGlobal.values()) {
    if (u.id === userId) return true;
  }
  return false;
}

module.exports = { configurarSockets, desconectarUtilizador, utilizadoresOnlineGlobal, estaUtilizadorLigado };
