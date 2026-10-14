const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Readable } = require("stream");

// ---------------------------------------------------------------------------
// Armazenamento dos ficheiros enviados (anexos de tarefas, ficheiros/imagens/
// áudio do chat da equipa).
//
//  • SUPABASE_URL + SUPABASE_SECRET_KEY definidos  → Supabase Storage (online).
//    Obrigatório no Render: o disco do Render é apagado a cada deploy/reinício,
//    por isso os ficheiros NÃO podem ficar lá.
//  • Caso contrário → pasta local /uploads (desenvolvimento no seu PC).
//
// Os ficheiros ficam num bucket PRIVADO. Nunca há ligações públicas: o
// servidor verifica as permissões e só então "passa" o ficheiro ao utilizador.
// ---------------------------------------------------------------------------
const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_KEY = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const BUCKET = (process.env.SUPABASE_BUCKET || "gpi-track-ficheiros").trim();
const usaSupabase = !!(SUPABASE_URL && SUPABASE_KEY);
const PASTA_LOCAL = path.join(__dirname, "..", "..", "uploads");

const PASTAS = { ANEXOS: "task-attachments", CANAL: "channel-media" };
const LIMITE_BUCKET_BYTES = 25 * 1024 * 1024;

function cabecalhos(extra = {}) {
  // Mesmo formato que a biblioteca oficial do Supabase envia (apikey + Bearer).
  return { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra };
}
const urlObjeto = (pasta, nome, tipo = "") =>
  `${SUPABASE_URL}/storage/v1/object/${tipo ? tipo + "/" : ""}${BUCKET}/${pasta}/${nome}`;

function nomeUnico(nomeOriginal) {
  // Só letras/números na extensão: o nome vai fazer parte do caminho no bucket.
  const ext = path.extname(nomeOriginal || "").toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12);
  return `${Date.now()}-${crypto.randomUUID()}${ext}`;
}

/** Cria o bucket privado se ainda não existir e regista o modo no arranque. */
async function iniciar() {
  if (!usaSupabase) {
    fs.mkdirSync(path.join(PASTA_LOCAL, PASTAS.ANEXOS), { recursive: true });
    fs.mkdirSync(path.join(PASTA_LOCAL, PASTAS.CANAL), { recursive: true });
    console.log("[ficheiros] modo: disco local (/uploads) — só para desenvolvimento.");
    if (process.env.RENDER) {
      console.warn("[ficheiros] ATENÇÃO: no Render o disco é apagado a cada deploy. Configure SUPABASE_URL e SUPABASE_SECRET_KEY.");
    }
    return;
  }
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: cabecalhos({ "Content-Type": "application/json" }),
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: LIMITE_BUCKET_BYTES }),
    });
    if (r.ok) console.log(`[ficheiros] modo: Supabase Storage — bucket privado "${BUCKET}" criado.`);
    else if ([400, 409].includes(r.status)) console.log(`[ficheiros] modo: Supabase Storage — bucket "${BUCKET}" pronto.`);
    else console.warn(`[ficheiros] Supabase Storage respondeu ${r.status} ao verificar o bucket: ${(await r.text()).slice(0, 200)}`);
  } catch (err) {
    console.warn("[ficheiros] não foi possível contactar o Supabase Storage:", err.message);
  }
}

/** Guarda o ficheiro e devolve o nome único com que ficou registado. */
async function guardar(pasta, nomeOriginal, buffer, mimetype) {
  const nome = nomeUnico(nomeOriginal);
  if (!usaSupabase) {
    await fs.promises.writeFile(path.join(PASTA_LOCAL, pasta, nome), buffer);
    return nome;
  }
  const tipo = (mimetype || "application/octet-stream").split(";")[0].trim() || "application/octet-stream";
  const r = await fetch(urlObjeto(pasta, nome), {
    method: "POST",
    headers: cabecalhos({ "Content-Type": tipo, "x-upsert": "false", "cache-control": "max-age=3600" }),
    body: buffer,
  });
  if (!r.ok) throw new Error(`Supabase Storage (${r.status}): ${(await r.text()).slice(0, 300)}`);
  return nome;
}

// Só estes tipos podem abrir "dentro" do navegador (imagens, áudio, vídeo, PDF).
// Tudo o resto — HTML, SVG, scripts… — é sempre descarregado, para que um
// ficheiro malicioso enviado por um utilizador nunca corra dentro do site.
function podeAbrirNoNavegador(mime) {
  const t = String(mime || "").split(";")[0].trim().toLowerCase();
  return (/^(image|audio|video)\//.test(t) && t !== "image/svg+xml") || t === "application/pdf";
}

/**
 * Envia o ficheiro ao cliente (após as permissões já terem sido verificadas).
 * Devolve false se o ficheiro não existir (o chamador responde 404).
 * Suporta pedidos "Range" (necessário para o áudio avançar/recuar no Safari).
 */
async function enviar(req, res, pasta, nome, { nomeDownload, mimetype, comoAnexo = false } = {}) {
  const abrirDentro = !comoAnexo && podeAbrirNoNavegador(mimetype);
  const tipo = mimetype || "application/octet-stream";

  if (!usaSupabase) {
    const caminho = path.join(PASTA_LOCAL, pasta, nome);
    if (!fs.existsSync(caminho)) return false;
    res.setHeader("Content-Type", tipo);
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (abrirDentro) {
      res.sendFile(caminho);
    } else {
      res.download(caminho, nomeDownload || nome);
    }
    return true;
  }

  const pedido = { headers: cabecalhos() };
  if (req.headers.range) pedido.headers.Range = req.headers.range;
  const r = await fetch(urlObjeto(pasta, nome, "authenticated"), pedido);
  if (r.status === 404 || r.status === 400) return false;
  if (!r.ok && r.status !== 206) throw new Error(`Supabase Storage (${r.status}) ao ler o ficheiro.`);

  res.status(r.status === 206 ? 206 : 200);
  res.setHeader("Content-Type", tipo);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=3600");
  for (const h of ["content-length", "content-range"]) {
    const v = r.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  if (abrirDentro) res.setHeader("Content-Disposition", "inline");
  else res.attachment(nomeDownload || nome); // acrescenta Content-Disposition com o nome correto (UTF-8)
  res.setHeader("Content-Type", tipo); // attachment() mexe no Content-Type; repõe o certo

  const corpo = Readable.fromWeb(r.body);
  corpo.on("error", () => res.destroy());
  corpo.pipe(res);
  return true;
}

/** Apaga um ficheiro. Nunca lança erro (é uma limpeza "o melhor possível"). */
async function apagar(pasta, nome) {
  if (!nome) return;
  try {
    if (!usaSupabase) {
      await fs.promises.unlink(path.join(PASTA_LOCAL, pasta, nome));
    } else {
      await fetch(urlObjeto(pasta, nome), { method: "DELETE", headers: cabecalhos() });
    }
  } catch {
    /* já não existia, ou o serviço está indisponível — ignora */
  }
}

async function apagarVarios(pasta, nomes) {
  await Promise.allSettled((nomes || []).filter(Boolean).map((n) => apagar(pasta, n)));
}

module.exports = { PASTAS, iniciar, guardar, enviar, apagar, apagarVarios, usaSupabase };
