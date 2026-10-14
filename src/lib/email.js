const nodemailer = require("nodemailer");

// ---------------------------------------------------------------------------
// Envio de e-mail. Prioridade:
//  1) Gmail com OAuth2 (API do Google): GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET
//     + GMAIL_REFRESH_TOKEN + GMAIL_USER. Não usa a password da conta.
//  2) SMTP genérico (ex.: Gmail com "palavra-passe de aplicação"):
//     SMTP_HOST + SMTP_USER + SMTP_PASS.
//  3) Nenhum configurado: os e-mails ficam só registados na consola — a
//     aplicação continua a funcionar normalmente (útil em desenvolvimento).
// ---------------------------------------------------------------------------
let transportador = null;
let remetente = null;
let modo = "desativado";

if (
  process.env.GOOGLE_CLIENT_ID &&
  process.env.GOOGLE_CLIENT_SECRET &&
  process.env.GMAIL_REFRESH_TOKEN &&
  process.env.GMAIL_USER
) {
  transportador = nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: process.env.GMAIL_USER,
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      refreshToken: process.env.GMAIL_REFRESH_TOKEN,
    },
  });
  remetente = process.env.GMAIL_USER;
  modo = "gmail-oauth2";
} else if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transportador = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  remetente = process.env.SMTP_USER;
  modo = "smtp";
}

console.log(`[email] modo de envio: ${modo}`);

const EMAIL_DESTINO_FEEDBACK = process.env.FEEDBACK_EMAIL_TO || "vitajoao143@gmail.com";

function emailAtivo() {
  return !!transportador;
}

function escapar(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Envia um e-mail. Nunca lança erro: devolve { enviado, motivo }. */
async function enviarEmail({ to, subject, text, html, replyTo }) {
  if (!transportador) {
    console.log(`[email] (simulado — sem Gmail/SMTP configurado) Para: ${to}\nAssunto: ${subject}\n${text}\n`);
    return { enviado: false, motivo: "E-mail não configurado" };
  }
  try {
    await transportador.sendMail({
      from: `"GPI Track" <${remetente}>`,
      to,
      replyTo: replyTo || undefined,
      subject,
      text,
      html,
    });
    return { enviado: true };
  } catch (err) {
    console.error("[email] erro ao enviar:", err.message);
    return { enviado: false, motivo: err.message };
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
