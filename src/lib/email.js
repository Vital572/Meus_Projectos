const crypto = require("crypto");

// ---------------------------------------------------------------------------
// Envio de e-mail. Prioridade:
//  1) Gmail API (HTTPS) com OAuth2 — É O MODO PARA O RENDER. O plano gratuito
//     do Render bloqueia as portas SMTP (25/465/587), por isso o envio tem de
//     ir por HTTPS. Precisa de GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET +
//     GMAIL_REFRESH_TOKEN + GMAIL_USER (ver DEPLOY.md).
//  2) SMTP (ex.: Gmail com "palavra-passe de aplicação"): SMTP_HOST + SMTP_USER
//     + SMTP_PASS. Só funciona fora do Render grátis (ex.: no seu PC).
//  3) Nenhum configurado: os e-mails ficam só registados na consola — a
//     aplicação continua a funcionar normalmente (útil em desenvolvimento).
// ---------------------------------------------------------------------------
let clienteGmail = null; // OAuth2Client (google-auth-library)
let transportadorSmtp = null;
let remetente = null;
let modo = "desativado";

if (
  process.env.GOOGLE_CLIENT_ID &&
  process.env.GOOGLE_CLIENT_SECRET &&
  process.env.GMAIL_REFRESH_TOKEN &&
  process.env.GMAIL_USER
) {
  const { OAuth2Client } = require("google-auth-library");
  clienteGmail = new OAuth2Client(process.env.GOOGLE_CLIENT_ID.trim(), process.env.GOOGLE_CLIENT_SECRET.trim());
  clienteGmail.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN.trim() });
  remetente = process.env.GMAIL_USER.trim();
  modo = "gmail-api";
} else if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  const nodemailer = require("nodemailer");
  transportadorSmtp = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  remetente = process.env.SMTP_USER;
  modo = "smtp";
}

console.log(`[email] modo de envio: ${modo}`);
if (modo === "smtp" && process.env.RENDER) {
  console.warn("[email] ATENÇÃO: o Render grátis bloqueia SMTP. Use a Gmail API (GMAIL_REFRESH_TOKEN) — ver DEPLOY.md.");
}

const EMAIL_DESTINO_FEEDBACK = process.env.FEEDBACK_EMAIL_TO || "vitajoao143@gmail.com";

function emailAtivo() {
  return modo !== "desativado";
}

function escapar(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- Construção da mensagem (formato RFC 2822 / MIME) para a Gmail API ----
const semQuebras = (t) => String(t ?? "").replace(/[\r\n]+/g, " ").trim(); // evita injeção de cabeçalhos

/** Cabeçalho com acentos → "encoded-words" UTF-8 (RFC 2047), em blocos curtos. */
function codificarCabecalho(texto) {
  const t = semQuebras(texto);
  if (/^[\x20-\x7E]*$/.test(t)) return t;
  const blocos = [];
  let atual = "";
  for (const ch of t) {
    if (Buffer.byteLength(atual + ch, "utf8") > 42) {
      blocos.push(atual);
      atual = "";
    }
    atual += ch;
  }
  if (atual) blocos.push(atual);
  return blocos.map((b) => `=?UTF-8?B?${Buffer.from(b, "utf8").toString("base64")}?=`).join("\r\n ");
}

const emBase64 = (t) => Buffer.from(t, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n").trimEnd();

function construirMensagem({ from, to, subject, text, html, replyTo }) {
  const limite = `gpitrack_${crypto.randomBytes(12).toString("hex")}`;
  const linhas = [
    `From: "GPI Track" <${semQuebras(from)}>`,
    `To: ${semQuebras(to)}`,
    ...(replyTo ? [`Reply-To: ${semQuebras(replyTo)}`] : []),
    `Subject: ${codificarCabecalho(subject)}`,
    "MIME-Version: 1.0",
  ];
  if (html) {
    linhas.push(`Content-Type: multipart/alternative; boundary="${limite}"`, "");
    linhas.push(`--${limite}`, 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", emBase64(text || ""));
    linhas.push(`--${limite}`, 'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", emBase64(html));
    linhas.push(`--${limite}--`, "");
  } else {
    linhas.push('Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", emBase64(text || ""), "");
  }
  return Buffer.from(linhas.join("\r\n"), "utf8");
}

async function enviarPelaGmailApi(dados) {
  const { token } = await clienteGmail.getAccessToken();
  const raw = construirMensagem({ from: remetente, ...dados }).toString("base64url");
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!r.ok) throw new Error(`Gmail API (${r.status}): ${(await r.text()).slice(0, 300)}`);
}

/** Envia um e-mail. Nunca lança erro: devolve { enviado, motivo }. */
async function enviarEmail({ to, subject, text, html, replyTo }) {
  if (!emailAtivo()) {
    console.log(`[email] (simulado — sem Gmail/SMTP configurado) Para: ${to}\nAssunto: ${subject}\n${text}\n`);
    return { enviado: false, motivo: "E-mail não configurado" };
  }
  try {
    if (modo === "gmail-api") {
      await enviarPelaGmailApi({ to, subject, text, html, replyTo });
    } else {
      await transportadorSmtp.sendMail({ from: `"GPI Track" <${remetente}>`, to, replyTo: replyTo || undefined, subject, text, html });
    }
    return { enviado: true };
  } catch (err) {
    let motivo = err.message || String(err);
    if (/invalid_grant/i.test(motivo)) {
      motivo += " — o GMAIL_REFRESH_TOKEN expirou ou foi revogado; gere um novo (ver DEPLOY.md, passo do Gmail).";
    }
    console.error("[email] erro ao enviar:", motivo);
    return { enviado: false, motivo };
  }
}

/** Moldura HTML simples e consistente para todos os e-mails da plataforma. */
function modeloEmail({ titulo, paragrafos = [], botao = null, rodape = "" }) {
  const botaoHtml = botao
    ? `<p style="margin:26px 0"><a href="${escapar(botao.url)}" style="background:#22C7DD;color:#0B1220;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:9px;display:inline-block">${escapar(botao.texto)}</a></p>`
    : "";
  return `<!DOCTYPE html><html><body style="margin:0;background:#0B1220;padding:28px 12px;font-family:Segoe UI,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#182648;border:1px solid #253461;border-radius:14px;padding:28px;color:#E7ECF6">
    <div style="font-weight:700;font-size:15px;color:#22C7DD;margin-bottom:14px">GPI Track</div>
    <h2 style="margin:0 0 14px;font-size:19px">${escapar(titulo)}</h2>
    ${paragrafos.map((p) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#C9D3EA">${escapar(p)}</p>`).join("")}
    ${botaoHtml}
    <p style="margin:22px 0 0;font-size:12px;color:#97A3C0;line-height:1.5">${escapar(rodape)}</p>
  </div></body></html>`;
}

function urlBase() {
  return (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
}

async function enviarEmailRecuperacao({ nome, email, link, minutos }) {
  const assunto = "Recuperação de acesso — GPI Track";
  const paragrafos = [
    `Olá, ${nome}.`,
    "Recebemos um pedido para redefinir a password da sua conta no GPI Track.",
    `Clique no botão abaixo para escolher uma nova password. A ligação é válida durante ${minutos} minutos e só pode ser usada uma vez.`,
  ];
  const rodape = "Se não fez este pedido, pode ignorar este e-mail — a sua password continua a mesma.";
  return enviarEmail({
    to: email,
    subject: assunto,
    text: `${paragrafos.join("\n\n")}\n\n${link}\n\n${rodape}`,
    html: modeloEmail({ titulo: "Redefinir a sua password", paragrafos, botao: { texto: "Escolher nova password", url: link }, rodape }),
  });
}

const TITULOS_NOTIFICACAO = {
  "task.assigned": "Foi-lhe atribuída uma tarefa",
  "task.made_responsible": "Foi-lhe atribuída uma tarefa",
  "comment.new": "Novo comentário numa tarefa",
  mention: "Foi mencionado(a) num comentário",
  "project.invite": "Convite para um projeto",
  "project.invited": "Convite para um projeto",
  "project.made_responsible": "É agora responsável por um projeto",
  "meeting.scheduled": "Reunião marcada",
  "meeting.cancelled": "Reunião cancelada",
  "task.due_tomorrow": "Prazo de tarefa amanhã",
  "task.due_today": "Prazo de tarefa hoje",
  "task.file_sent": "Recebeu um ficheiro",
  "admin.announcement": "Anúncio da administração",
};

/** E-mail de uma notificação de projeto (as mesmas que aparecem no sino). */
async function enviarEmailNotificacao({ nome, email, tipo, conteudo, projectId, taskId }) {
  let destino = `${urlBase()}/projetos.html`;
  if (projectId) destino = `${urlBase()}/board.html?projeto=${projectId}${taskId ? `&tarefa=${taskId}` : ""}`;
  const titulo = TITULOS_NOTIFICACAO[tipo] || "Nova notificação";
  const rodape = "Recebe este e-mail porque tem as notificações por e-mail ativas no GPI Track. Pode desativá-las no Espaço de Gestão → Visão geral.";
  return enviarEmail({
    to: email,
    subject: `[GPI Track] ${titulo}`,
    text: `Olá, ${nome}.\n\n${conteudo}\n\nAbrir: ${destino}\n\n${rodape}`,
    html: modeloEmail({ titulo, paragrafos: [`Olá, ${nome}.`, conteudo], botao: { texto: "Abrir no GPI Track", url: destino }, rodape }),
  });
}

async function enviarEmailFeedback({ name, email, message, page }) {
  const assunto = `[GPI Track] Novo feedback${name ? ` de ${name}` : ""}`;
  const corpo = `Página: ${page || "—"}\nNome: ${name || "Anónimo"}\nE-mail: ${email || "—"}\n\nMensagem:\n${message}`;
  return enviarEmail({ to: EMAIL_DESTINO_FEEDBACK, subject: assunto, text: corpo, replyTo: email });
}

module.exports = { enviarEmail, enviarEmailFeedback, enviarEmailRecuperacao, enviarEmailNotificacao, emailAtivo, urlBase };
