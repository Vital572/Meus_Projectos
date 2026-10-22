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
const pool = require("./db/pool");
const storage = require("./src/lib/storage");

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
// "same-origin-allow-popups" é necessário para o popup do "Entrar com o Google"
// (com o valor por defeito do helmet, "same-origin", o Google bloqueia o popup).
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
}));
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
app.use("/api/auth/google", limitadorAutenticacao);
app.use("/api/auth/mfa/verificar-login", limitadorAutenticacao); // o código de 6 dígitos não pode ser adivinhado por tentativa e erro

// Recuperação de conta: limite mais apertado (cada pedido pode gerar um e-mail).
const limitadorRecuperacao = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: "Demasiados pedidos de recuperação. Tente novamente dentro de alguns minutos." },
});
app.use("/api/auth/esqueci-senha", limitadorRecuperacao);
app.use("/api/auth/redefinir-senha", limitadorRecuperacao);
app.use("/api/auth/validar-token-recuperacao", limitadorRecuperacao);

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

// Usado pelo Render ("Health Check Path") e por serviços de "keep-alive".
// Responde sempre 200 (para o Render não reiniciar a app por uma falha
// momentânea da base de dados); o campo "bd" diz se a base de dados responde.
app.get("/api/saude", async (req, res) => {
  let bd = false;
  try {
    await pool.query("SELECT 1");
    bd = true;
  } catch {}
  res.json({ ok: true, bd, hora: new Date().toISOString() });
});

configurarSockets(io);

// Todos os dias às 08:00 (hora de Angola, mesmo que o servidor esteja noutro
// fuso — o Render usa UTC) — avisa quem tem tarefas com prazo amanhã ou hoje.
// Nota: no plano gratuito do Render a app "adormece" após 15 min sem pedidos e
// este agendamento só corre se ela estiver acordada (ver DEPLOY.md, "keep-alive").
cron.schedule("0 8 * * *", async () => {
  try {
    const resultado = await verificarPrazosDeTarefas(io);
    console.log(`[lembretes] ${resultado.avisadas_amanha} avisadas (amanhã), ${resultado.avisadas_hoje} avisadas (hoje)`);
  } catch (err) {
    console.error("[lembretes] erro ao verificar prazos:", err);
  }
}, { timezone: process.env.TZ_LEMBRETES || "Africa/Luanda" });

// Em vez de "rebentar" por um erro solto (ex.: uma falha momentânea de rede),
// regista-o e continua a servir os restantes utilizadores.
process.on("unhandledRejection", (err) => console.error("[erro não tratado]", err));
process.on("uncaughtException", (err) => console.error("[exceção não tratada]", err));

// Diagnóstico no arranque: diz logo nos registos do Render o que falta/está errado.
async function verificarBaseDeDados() {
  try {
    const { rows } = await pool.query("SELECT to_regclass('gpitrack.users') AS tabela");
    if (rows[0].tabela) {
      console.log("[bd] ligação ao PostgreSQL OK.");
    } else {
      console.warn("[bd] ligado ao PostgreSQL, mas as tabelas NÃO existem. Execute db/schema.sql no SQL Editor do Supabase (ver DEPLOY.md).");
    }
  } catch (err) {
    let dica = "";
    if (err.code === "ENETUNREACH" || /ENETUNREACH/.test(err.message)) dica = " → o Render só usa IPv4: use a 'Session pooler' do Supabase (aws-0-….pooler.supabase.com:5432), não a ligação direta.";
    else if (err.code === "ENOTFOUND") dica = " → o endereço (host) da DATABASE_URL está errado.";
    else if (err.code === "28P01") dica = " → password da base de dados errada (a da DATABASE_URL tem de ser a do projeto Supabase; símbolos especiais têm de ir codificados).";
    else if (/Tenant or user not found/i.test(err.message)) dica = " → o utilizador tem de ser 'postgres.<ref-do-projeto>' (copie a string da Session pooler no Supabase → Connect).";
    console.error(`[bd] NÃO foi possível ligar ao PostgreSQL: ${err.message}${dica}`);
  }
}

// O Render envia SIGTERM em cada novo deploy: fecha com calma (sem cortar pedidos a meio).
function encerrar(sinal) {
  console.log(`\n[${sinal}] a encerrar…`);
  server.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on("SIGTERM", () => encerrar("SIGTERM"));
process.on("SIGINT", () => encerrar("SIGINT"));

const PORTA = process.env.PORT || 3000;
// "0.0.0.0": o Render exige que a app aceite ligações vindas de fora do contentor.
server.listen(PORTA, "0.0.0.0", () => {
  console.log(`\nGPI Track a correr na porta ${PORTA}${process.env.APP_URL ? " — " + process.env.APP_URL : ` — http://localhost:${PORTA}`}`);
  if (!process.env.RENDER) console.log("Utilize 'npm run seed' para popular a base de dados com dados de exemplo (só em desenvolvimento local).\n");
  verificarBaseDeDados();
  storage.iniciar();
});
