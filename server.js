require("dotenv").config();
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const http = require("http");
const { Server } = require("socket.io");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./src/routes/auth");
const projectRoutes = require("./src/routes/projects");
const taskRoutes = require("./src/routes/tasks");
const commentRoutes = require("./src/routes/comments");
const notificationRoutes = require("./src/routes/notifications");
const adminRoutes = require("./src/routes/admin");
const reportRoutes = require("./src/routes/reports");
const workspaceRoutes = require("./src/routes/workspace");
const feedbackRoutes = require("./src/routes/feedback");
const { configurarSockets } = require("./src/sockets");
const cron = require("node-cron");
const { verificarPrazosDeTarefas } = require("./src/lib/lembretes");

const app = express();
// Necessário quando a app corre atrás de um proxy (Render, Railway, etc.) —
// sem isto, o express-rate-limit rejeita os pedidos com um erro de validação
// por ver o cabeçalho X-Forwarded-For sem "confiar" nele.
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.set("io", io);

// Cabeçalhos de segurança HTTP (X-Frame-Options, X-Content-Type-Options, etc.).
// O CSP por defeito do helmet fica desativado porque a aplicação carrega vários
// scripts e folhas de estilo de CDNs (Bootstrap, Chart.js, Socket.IO, ícones) —
// ativar o CSP sem configurar essas origens bloquearia tudo. Ao colocar isto
// "na nuvem" a sério, vale a pena vir aqui configurar o CSP com as origens exatas.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());

// Limita tentativas de login/registo para dificultar ataques de força bruta
const limitadorAutenticacao = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: "Demasiadas tentativas. Tente novamente dentro de alguns minutos." },
});
app.use("/api/auth/login", limitadorAutenticacao);
app.use("/api/auth/registar", limitadorAutenticacao);

app.use(express.json());
app.use(cookieParser());
// desativa a cache do navegador para os ficheiros estáticos (HTML/CSS/JS):
// isto evita que, ao atualizar o protótipo (ex: substituir os ficheiros por
// uma nova versão extraída de um .zip), o navegador continue a usar código
// antigo em cache — o que já causou o problema de sessões "a misturarem-se"
// mesmo depois da correção ter sido aplicada nos ficheiros.
app.use(express.static(path.join(__dirname, "public"), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  },
}));

app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/comments", commentRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/relatorios", reportRoutes);
app.use("/api/workspace", workspaceRoutes);

// Feedback é público (sem sessão) — limitado para evitar abuso
const limitadorFeedback = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: "Demasiados envios. Tente novamente dentro de alguns minutos." },
});
app.use("/api/feedback", limitadorFeedback, feedbackRoutes);

app.get("/api/saude", (req, res) => res.json({ ok: true, hora: new Date().toISOString() }));

configurarSockets(io);

// Todos os dias às 08:00 — avisa quem tem tarefas com prazo amanhã ou hoje.
// (usar a hora do sistema onde o servidor estiver hospedado)
cron.schedule("0 8 * * *", async () => {
  try {
    const resultado = await verificarPrazosDeTarefas(io);
    console.log(`[lembretes] ${resultado.avisadas_amanha} avisadas (amanhã), ${resultado.avisadas_hoje} avisadas (hoje)`);
  } catch (err) {
    console.error("[lembretes] erro ao verificar prazos:", err);
  }
});

const PORTA = process.env.PORT || 3000;
server.listen(PORTA, () => {
  console.log(`\nGPI Track a correr em http://localhost:${PORTA}`);
  console.log("Utilize 'npm run seed' para popular a base de dados com dados de exemplo.\n");
});
