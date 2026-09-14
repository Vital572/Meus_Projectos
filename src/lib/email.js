const nodemailer = require("nodemailer");

// O envio de e-mail só fica realmente ativo depois de configurar
// SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS no .env — sem isso, os e-mails
// ficam só "simulados" (registados na consola), mas o feedback continua
// sempre a ficar guardado na base de dados e visível na Administração.
let transportador = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transportador = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

const EMAIL_DESTINO_FEEDBACK = process.env.FEEDBACK_EMAIL_TO || "vitajoao143@gmail.com";

async function enviarEmailFeedback({ name, email, message, page }) {
  const assunto = `[GPI Track] Novo feedback${name ? ` de ${name}` : ""}`;
  const corpo = `Página: ${page || "—"}\nNome: ${name || "Anónimo"}\nE-mail: ${email || "—"}\n\nMensagem:\n${message}`;

  if (!transportador) {
    console.log(`[email] SMTP não configurado — feedback guardado na base de dados, mas não enviado por e-mail.\n${corpo}`);
    return { enviado: false, motivo: "SMTP não configurado" };
  }

  try {
    await transportador.sendMail({
      from: `"GPI Track" <${process.env.SMTP_USER}>`,
      to: EMAIL_DESTINO_FEEDBACK,
      replyTo: email || undefined,
      subject: assunto,
      text: corpo,
    });
    return { enviado: true };
  } catch (err) {
    console.error("[email] erro ao enviar feedback por e-mail:", err.message);
    return { enviado: false, motivo: err.message };
  }
}

module.exports = { enviarEmailFeedback };
