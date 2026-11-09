#!/usr/bin/env node
/**
 * GPI Track — teste de carga / volume.
 *
 * Enche a plataforma com muitos utilizadores, projetos, tarefas, membros,
 * vários responsáveis por projeto, conversas, automações, metas, Gantt, etc.,
 * usando a API REAL (por isso passa pelas mesmas permissões, notificações,
 * automações e eventos em tempo real que um utilizador normal), e mede como
 * a plataforma e a base de dados reagem.
 *
 * Uso (o servidor tem de estar a correr: npm start, noutro terminal):
 *   npm run carga                      -> escala "media"
 *   npm run carga -- --escala=pequena  -> pequena | media | grande | extrema
 *   npm run carga -- --eu=o-seu@email  -> adiciona a SUA conta a todos os projetos
 *                                         (metade como responsável) para os ver no ecrã
 *   npm run carga -- --sem-tempo-real  -> salta o teste de Socket.IO
 *   npm run carga:limpar               -> apaga tudo o que a carga criou
 *
 * Os dados criados são identificáveis: utilizadores "cargaNNN@carga.gpitrack.test"
 * (password: Carga#2026x). No fim é escrito um relatório em relatorio-carga-<escala>.md.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const pool = require("./pool");
const { assinarToken } = require("../src/middleware/auth");

const BASE = process.env.CARGA_URL || `http://localhost:${process.env.PORT || 3000}`;
const DOMINIO = "carga.gpitrack.test";
const PASSWORD = "Carga#2026x";
const PREFIXO = "[carga] ";

const ESCALAS = {
  pequena: { utilizadores: 15, projetos: 4, tarefas: 25, mensagens: 40, membros: [5, 9] },
  media: { utilizadores: 40, projetos: 12, tarefas: 80, mensagens: 150, membros: [6, 18] },
  grande: { utilizadores: 120, projetos: 30, tarefas: 200, mensagens: 400, membros: [10, 40] },
  extrema: { utilizadores: 300, projetos: 60, tarefas: 400, mensagens: 800, membros: [15, 80] },
};

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v === undefined ? true : v];
}));
const escalaNome = ESCALAS[args.escala] ? args.escala : "media";

// A carga cria dezenas de utilizadores falsos (com password conhecida) e muitos dados.
// Numa base de dados remota (Supabase = a versão ONLINE) isso poluiria o site real e
// deixaria contas que qualquer pessoa com esta password poderia usar. Por isso pede
// confirmação. (Apagar o que a carga criou — "npm run carga:limpar" — é sempre permitido.)
if (!args.limpar && !pool.ehLocal && process.env.PERMITIR_CARGA_REMOTA !== "sim") {
  console.error(
    "\nPARADO: a base de dados configurada NÃO é local (é remota, ex.: Supabase).\n" +
    "O teste de carga criaria utilizadores e dados falsos na versão online.\n" +
    "Se tem a certeza, execute: PERMITIR_CARGA_REMOTA=sim npm run carga\n" +
    "Para remover dados de uma carga anterior: npm run carga:limpar\n"
  );
  process.exit(1);
}
const E = ESCALAS[escalaNome];

// ---------------------------------------------------------------- utilitários
const rnd = (n) => Math.floor(Math.random() * n);
const entre = (a, b) => a + rnd(b - a + 1);
const escolher = (arr) => arr[rnd(arr.length)];
const prob = (p) => Math.random() < p;
function amostra(arr, n) {
  const c = [...arr];
  for (let i = c.length - 1; i > 0; i--) { const j = rnd(i + 1); [c[i], c[j]] = [c[j], c[i]]; }
  return c.slice(0, Math.max(0, Math.min(n, c.length)));
}
const dataISO = (dias) => new Date(Date.now() + dias * 86400000).toISOString().substring(0, 10);
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

async function paralelo(itens, limite, fn) {
  let i = 0;
  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (i < itens.length) {
      const idx = i++;
      try { await fn(itens[idx], idx); } catch (e) { erros.push("paralelo: " + e.message); }
    }
  });
  await Promise.all(trabalhadores);
}

const NOMES = ["Vital", "Ana", "Domingos", "Beatriz", "Carlos", "Délcio", "Elsa", "Fernando", "Graça", "Hélder",
  "Isabel", "João", "Kátia", "Luís", "Mariana", "Nelson", "Olga", "Paulo", "Quintino", "Rita",
  "Sebastião", "Teresa", "Ulisses", "Vera", "Wilson", "Xavier", "Yara", "Zacarias", "Adilson", "Bernardete",
  "Cláudio", "Dulce", "Edgar", "Filomena", "Gabriel", "Helena", "Inácio", "Joana", "Kiala", "Laurinda",
  "Miguel", "Nzinga", "Osvaldo", "Palmira", "Quim", "Rosa", "Samuel", "Tânia", "Uanhenga", "Valdemar"];
const APELIDOS = ["Silva", "Santos", "Manuel", "Kiala", "Sabata", "Fernandes", "Gomes", "Pedro", "Lopes", "Mendes",
  "Neto", "Cardoso", "Baptista", "Tavares", "Domingos", "Francisco", "João", "Miguel", "Quintas", "Zau"];
const CORES = ["#22C7DD", "#7B68EE", "#FDAB3D", "#00C875", "#E2445C", "#A25DDC", "#0086C0", "#FC636B"];
const TEMAS = ["Plataforma de CV", "Portal Académico", "App de Biblioteca", "Sistema de Matrículas", "Painel de Notas",
  "Site Institucional", "Gestão de Estágios", "Portal do Docente", "Rede Wi-Fi do Campus", "Migração de Servidores",
  "Sistema de Horários", "Aplicação Móvel", "Arquivo Digital", "Laboratório Virtual", "Observatório de Dados"];
const VERBOS = ["Desenhar", "Implementar", "Testar", "Documentar", "Rever", "Migrar", "Configurar", "Otimizar", "Validar",
  "Integrar", "Corrigir", "Planear", "Analisar", "Publicar", "Automatizar"];
const OBJETOS = ["ecrã de login", "API de tarefas", "base de dados", "relatório mensal", "módulo de exportação",
  "autenticação", "painel de estatísticas", "notificações", "cópias de segurança", "formulário de inscrição",
  "pesquisa avançada", "permissões de utilizador", "importação de dados", "página inicial", "serviço de e-mail",
  "gráfico de Gantt", "calendário", "cache", "testes automáticos", "manual do utilizador"];
const FRASES = ["Já avancei com isto, falta rever.", "Preciso de ajuda com este ponto.", "Atualizei conforme combinado.",
  "Podemos falar sobre isto na reunião?", "Concluído do meu lado.", "Encontrei um problema, vou investigar.",
  "Ficou melhor do que esperava!", "Alguém pode validar?", "Vou precisar de mais dois dias.", "Enviei o ficheiro ao responsável.",
  "Boa ideia, vamos seguir assim.", "Isto depende da outra tarefa.", "Prazo está apertado, mas dá.", "Tudo ok por aqui."];
const EMOJIS = ["👍", "🎉", "❤️", "😂", "👀", "🚀", "✅", "🙏"];

// ---------------------------------------------------------------- métricas
const metricas = new Map(); // "METODO /rota/:id" -> { t: [ms], erros: n, status: {} }
const erros = [];
const avisos = [];
function chave(metodo, caminho) {
  const limpo = caminho.split("?")[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ":id");
  return `${metodo} ${limpo}`;
}
function registar(k, ms, status) {
  if (!metricas.has(k)) metricas.set(k, { t: [], erros: 0, status: {} });
  const m = metricas.get(k);
  m.t.push(ms);
  m.status[status] = (m.status[status] || 0) + 1;
  if (status >= 500) m.erros++;
}
function percentil(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
let faseMetricas = null; // Map separado por fase
const fasesMetricas = {};
function iniciarFase(nome) { faseMetricas = fasesMetricas[nome] = new Map(); return nome; }

async function api(u, metodo, caminho, corpo, opcoes = {}) {
  const headers = { Authorization: "Bearer " + u.token };
  let body;
  if (corpo instanceof FormData) body = corpo;
  else if (corpo !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(corpo); }
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(BASE + caminho, { method: metodo, headers, body });
  } catch (e) {
    erros.push(`${metodo} ${caminho}: sem resposta (${e.message})`);
    return { ok: false, status: 0, dados: null, ms: 0 };
  }
  const ct = res.headers.get("content-type") || "";
  let dados = null;
  let bytes = 0;
  if (ct.includes("json")) { dados = await res.json().catch(() => null); }
  else { bytes = (await res.arrayBuffer()).byteLength; }
  const ms = performance.now() - t0;
  const k = chave(metodo, caminho);
  registar(k, ms, res.status);
  if (faseMetricas) {
    if (!faseMetricas.has(k)) faseMetricas.set(k, { t: [], erros: 0, status: {}, bytes: 0 });
    const m = faseMetricas.get(k);
    m.t.push(ms); m.bytes += bytes || JSON.stringify(dados || "").length;
    m.status[res.status] = (m.status[res.status] || 0) + 1;
    if (res.status >= 500) m.erros++;
  }
  if (!res.ok && !opcoes.tolerar) {
    erros.push(`${metodo} ${caminho} -> ${res.status} ${dados?.erro || ""}`.trim());
  }
  return { ok: res.ok, status: res.status, dados, ms, bytes };
}

function titulo() { return `${escolher(VERBOS)} ${escolher(OBJETOS)}`; }
function descricao() {
  const n = entre(1, 5);
  return Array.from({ length: n }, () => `${escolher(VERBOS)} ${escolher(OBJETOS)}. ${escolher(FRASES)}`).join(" ");
}

// ---------------------------------------------------------------- limpeza
async function limpar() {
  console.log("A limpar os dados criados pela carga…");
  const { rows: us } = await pool.query(`SELECT id FROM gpitrack.users WHERE email LIKE $1`, [`%@${DOMINIO}`]);
  const ids = us.map((u) => u.id);
  if (ids.length) {
    // ficheiros no disco (anexos e canal) dos projetos destes utilizadores
    const { rows: f1 } = await pool.query(
      `SELECT stored_name FROM gpitrack.task_attachments WHERE uploaded_by = ANY($1)`, [ids]);
    const { rows: f2 } = await pool.query(
      `SELECT stored_name FROM gpitrack.channel_messages WHERE user_id = ANY($1) AND stored_name IS NOT NULL`, [ids]);
    const raiz = path.join(__dirname, "..", "uploads");
    let apagados = 0;
    for (const [sub, lista] of [["task-attachments", f1], ["channel-media", f2]]) {
      for (const f of lista) {
        try { fs.unlinkSync(path.join(raiz, sub, f.stored_name)); apagados++; } catch { /* já não existe */ }
      }
    }
    // projetos/equipas criados por estes utilizadores (cascata apaga tarefas, mensagens, etc.)
    await pool.query(`DELETE FROM gpitrack.projects WHERE created_by = ANY($1)`, [ids]);
    await pool.query(`DELETE FROM gpitrack.teams WHERE created_by = ANY($1)`, [ids]);
    await pool.query(`DELETE FROM gpitrack.users WHERE id = ANY($1)`, [ids]);
    console.log(`  ${ids.length} utilizadores, os seus projetos e ${apagados} ficheiros apagados.`);
  }
  const r1 = await pool.query(`DELETE FROM gpitrack.admin_messages WHERE content LIKE $1`, [PREFIXO + "%"]);
  const r2 = await pool.query(`DELETE FROM gpitrack.feedback WHERE message LIKE $1`, [PREFIXO + "%"]);
  console.log(`  ${r1.rowCount} anúncios e ${r2.rowCount} feedbacks de teste apagados.`);
  console.log("Limpo.");
}

// ---------------------------------------------------------------- relatório
function linhaTabela(k, m) {
  const ok2xx = Object.entries(m.status).filter(([s]) => s < 400).reduce((n, [, c]) => n + c, 0);
  const rej = Object.entries(m.status).filter(([s]) => s >= 400 && s < 500).reduce((n, [, c]) => n + c, 0);
  return `| ${k} | ${m.t.length} | ${percentil(m.t, 50).toFixed(0)} | ${percentil(m.t, 95).toFixed(0)} | ${Math.max(...m.t).toFixed(0)} | ${ok2xx} | ${rej} | ${m.erros} |`;
}
function tabelaMetricas(mapa, ordenar = "p95") {
  const linhas = [...mapa.entries()].sort((a, b) => percentil(b[1].t, 95) - percentil(a[1].t, 95));
  return ["| Endpoint | Pedidos | p50 ms | p95 ms | máx ms | OK | Recusados (4xx) | Erros 5xx |",
    "|---|---:|---:|---:|---:|---:|---:|---:|", ...linhas.map(([k, m]) => linhaTabela(k, m))].join("\n");
}

// ---------------------------------------------------------------- principal
(async () => {
  if (args.limpar) { await limpar(); await pool.end(); return; }

  // O servidor tem de estar a correr
  try {
    const r = await fetch(BASE + "/api/auth/config");
    if (!r.ok) throw new Error("estado " + r.status);
  } catch (e) {
    console.error(`Não consegui falar com o servidor em ${BASE} (${e.message}).\nArranque-o primeiro com "npm start" (noutro terminal) e volte a correr este comando.`);
    process.exit(1);
  }

  const T0 = Date.now();
  const tempos = {};
  const marca = (n) => { tempos[n] = (Date.now() - T0) / 1000; };
  console.log(`\nGPI Track — carga "${escalaNome}": ${E.utilizadores} utilizadores, ${E.projetos} projetos, ~${E.tarefas} tarefas por projeto\n`);

  // 1) Utilizadores (diretos na BD, com hash real; os tokens são assinados com o mesmo segredo da app)
  await limpar().catch(() => {});
  const hash = await bcrypt.hash(PASSWORD, 10);
  const utilizadores = [];
  for (let i = 1; i <= E.utilizadores; i++) {
    const nome = `${NOMES[(i - 1) % NOMES.length]} ${escolher(APELIDOS)}`;
    const email = `carga${String(i).padStart(3, "0")}@${DOMINIO}`;
    const { rows } = await pool.query(
      `INSERT INTO gpitrack.users (name, email, password_hash, avatar_color, role)
       VALUES ($1, $2, $3, $4, 'member') RETURNING id, name, email, avatar_color, role`,
      [nome, email, hash, escolher(CORES)]
    );
    const u = rows[0];
    u.token = assinarToken(u);
    u.primeiroNome = u.name.split(" ")[0];
    utilizadores.push(u);
  }
  const { rows: adm } = await pool.query(`SELECT id, name, email, avatar_color, role FROM gpitrack.users WHERE role = 'admin' ORDER BY created_at LIMIT 1`);
  let admin = null;
  if (adm[0]) { admin = adm[0]; admin.token = assinarToken(admin); } else avisos.push("Não existe nenhum administrador na base de dados: a parte de administração foi saltada.");
  let eu = null;
  if (typeof args.eu === "string") {
    const { rows } = await pool.query(`SELECT id, name, email FROM gpitrack.users WHERE email = $1`, [args.eu]);
    if (rows[0]) eu = rows[0]; else avisos.push(`A conta --eu=${args.eu} não existe; ignorada.`);
  }
  marca("utilizadores");
  console.log(`✔ ${utilizadores.length} utilizadores criados`);

  // 2) Projetos completos
  iniciarFase("escrita");
  const projetos = []; // { id, dono, membros:[u], responsaveis:[u], colunas, tarefas:[], etiquetas, campos, ... }
  const estatLocal = { tarefas: 0, comentarios: 0, mensagens: 0, reacoes: 0, checklist: 0, subtarefas: 0, dependencias: 0, metas: 0, automacoes: 0, anexos: 0, convites: 0, reunioes: 0, movimentos: 0, tempo: 0, valores: 0 };

  async function criarProjeto(idx) {
    const dono = utilizadores[idx % utilizadores.length];
    const nome = `${escolher(TEMAS)} #${idx + 1}`;
    const r = await api(dono, "POST", "/api/projects", { name: nome, description: descricao() });
    if (!r.ok) return;
    const proj = { id: r.dados.id, nome, dono, membros: [dono], responsaveis: [dono], tarefas: [], mensagens: [] };

    const q = (await api(dono, "GET", `/api/projects/${proj.id}/quadro`)).dados;
    proj.colunas = q.colunas;
    const colPor = (n) => proj.colunas.find((c) => c.name === n);

    // colunas extra + uma restrita
    for (const nomeCol of ["Backlog", "Bloqueado"]) {
      const c = await api(dono, "POST", `/api/projects/${proj.id}/colunas`, { name: nomeCol });
      if (c.ok) proj.colunas.push(c.dados);
    }
    if (prob(0.5) && colPor("Em Revisão")) {
      await api(dono, "PATCH", `/api/projects/colunas/${colPor("Em Revisão").id}`, { name: "Em Revisão", is_done: false, restricted: true });
    }
    proj.colunas.sort((a, b) => a.position - b.position);

    // etiquetas e campos personalizados
    proj.etiquetas = [];
    for (const [n, cor] of [["Backend", "#7B68EE"], ["Frontend", "#22C7DD"], ["Urgente", "#E2445C"], ["Documentação", "#A25DDC"], ["Bug", "#FC636B"], ["Sprint 1", "#00C875"], ["Sprint 2", "#FDAB3D"], ["Infra", "#0086C0"]]) {
      const l = await api(dono, "POST", `/api/projects/${proj.id}/etiquetas`, { name: n, color: cor });
      if (l.ok) proj.etiquetas.push(l.dados);
    }
    proj.campos = [];
    for (const [n, t, o] of [["Cliente", "texto"], ["Horas estimadas", "numero"], ["Data de entrega", "data"], ["Fase", "lista", ["Análise", "Desenho", "Código", "Testes", "Entrega"]]]) {
      const c = await api(dono, "POST", `/api/projects/${proj.id}/campos`, { name: n, type: t, options: o });
      if (c.ok) proj.campos.push({ ...c.dados, tipo: t, opcoes: o });
    }

    // membros: convites, aprovações, aceitar/recusar, vários responsáveis
    const outros = utilizadores.filter((u) => u.id !== dono.id);
    const quantos = Math.min(outros.length, entre(E.membros[0], E.membros[1]));
    const convidados = amostra(outros, quantos);
    for (const u of convidados) {
      const viaMembro = proj.membros.length > 2 && prob(0.15);
      let r2;
      if (viaMembro) {
        const proponente = escolher(proj.membros.filter((m) => m.id !== dono.id));
        r2 = await api(proponente || dono, "POST", `/api/projects/${proj.id}/membros`, { email: u.email });
        if (r2.ok && r2.dados.status === "aguarda_aprovacao") {
          await api(dono, "POST", `/api/projects/${proj.id}/membros/${u.id}/aprovar-convite`, { aprovar: true });
        }
      } else {
        r2 = await api(dono, "POST", `/api/projects/${proj.id}/membros`, { email: u.email });
      }
      estatLocal.convites++;
      if (!r2.ok) continue;
      if (prob(0.07)) { await api(u, "POST", `/api/projects/${proj.id}/convite/recusar`); continue; }
      const ac = await api(u, "POST", `/api/projects/${proj.id}/convite/aceitar`);
      if (ac.ok) proj.membros.push(u);
    }
    // 2 a 4 responsáveis no total
    const extraResp = amostra(proj.membros.filter((m) => m.id !== dono.id), entre(1, 3));
    for (const u of extraResp) {
      const r3 = await api(dono, "PATCH", `/api/projects/${proj.id}/membros/${u.id}/responsavel`, { responsavel: true });
      if (r3.ok) proj.responsaveis.push(u);
    }
    // a conta do utilizador real (opcional)
    if (eu) {
      const resp = idx % 2 === 0;
      await pool.query(
        `INSERT INTO gpitrack.project_members (project_id, user_id, role, status) VALUES ($1, $2, $3, 'ativo')
         ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'ativo'`,
        [proj.id, eu.id, resp ? "responsavel" : "membro"]);
    }

    // automações (uma de cada tipo)
    const gatilhoConcluido = proj.colunas.find((c) => c.is_done);
    const emRev = colPor("Em Revisão");
    const bloq = proj.colunas.find((c) => c.name === "Bloqueado");
    const regras = [
      { name: "Avisar o responsável quando concluir", trigger_column_id: gatilhoConcluido?.id, action_type: "notificar", notify_user_id: dono.id },
      { name: "Atribuir revisões", trigger_column_id: emRev?.id, action_type: "atribuir", assign_user_id: escolher(proj.responsaveis).id },
      { name: "Bloqueado = prioridade alta", trigger_column_id: bloq?.id, action_type: "definir_prioridade", set_priority: "alta" },
      { name: "Concluir checklist ao fechar", trigger_column_id: gatilhoConcluido?.id, action_type: "concluir_checklist" },
    ].filter((r) => r.trigger_column_id);
    for (const reg of regras) {
      const a = await api(dono, "POST", `/api/projects/${proj.id}/automacoes`, reg);
      if (a.ok) estatLocal.automacoes++;
    }

    // tarefas
    const nTarefas = Math.max(5, Math.round(E.tarefas * (0.6 + Math.random() * 0.8)));
    const colunasUsaveis = proj.colunas;
    const pesos = (c) => (c.name === "Concluído" ? 3 : c.name === "Bloqueado" ? 1 : c.name === "Backlog" ? 3 : 4);
    const colunasPonderadas = colunasUsaveis.flatMap((c) => Array(pesos(c)).fill(c));
    const ordem = Array.from({ length: nTarefas }, (_, i) => i);
    const criadas = new Array(nTarefas);
    await paralelo(ordem, 6, async (i) => {
      const criador = escolher(proj.membros);
      const prazoDias = entre(-20, 60);
      const comInicio = prob(0.75);
      const corpo = {
        project_id: proj.id, column_id: escolher(colunasPonderadas).id, title: `${titulo()} (${i + 1})`,
        description: prob(0.8) ? descricao() : undefined, priority: escolher(["baixa", "media", "alta"]),
        assignee_id: prob(0.9) ? escolher(proj.membros).id : undefined, due_date: prob(0.9) ? dataISO(prazoDias) : undefined,
        start_date: comInicio ? dataISO(prazoDias - entre(2, 25)) : undefined, visibility: prob(0.08) ? "restrita" : "equipa",
      };
      const t = await api(criador, "POST", "/api/tasks", corpo);
      if (t.ok) { criadas[i] = t.dados; estatLocal.tarefas++; }
    });
    proj.tarefas = criadas.filter(Boolean);

    // enriquecimento de cada tarefa
    await paralelo(proj.tarefas.map((t, i) => ({ t, i })), 6, async ({ t, i }) => {
      const resp = escolher(proj.responsaveis);
      const participantes = [resp];
      if (t.assignee_id) { const a = proj.membros.find((m) => m.id === t.assignee_id); if (a) participantes.push(a); }

      if (prob(0.65) && proj.etiquetas.length) {
        await api(resp, "PUT", `/api/tasks/${t.id}/etiquetas`, { label_ids: amostra(proj.etiquetas, entre(1, 3)).map((l) => l.id) });
      }
      if (prob(0.55)) {
        const itens = [];
        for (let k = 0; k < entre(2, 6); k++) {
          const c = await api(resp, "POST", `/api/tasks/${t.id}/checklist`, { content: `${escolher(VERBOS)} ${escolher(OBJETOS)}` });
          if (c.ok) { itens.push(c.dados); estatLocal.checklist++; }
        }
        for (const it of itens) if (prob(0.45)) await api(resp, "PATCH", `/api/tasks/checklist/${it.id}`, { is_done: true });
      }
      if (prob(0.25)) {
        for (let k = 0; k < entre(1, 4); k++) {
          const s = await api(resp, "POST", `/api/tasks/${t.id}/subtarefas`, { title: `Sub: ${titulo()}` });
          if (s.ok) estatLocal.subtarefas++;
        }
      }
      if (prob(0.25) && i > 0) {
        const dep = proj.tarefas[rnd(i)];
        if (dep) { const d = await api(resp, "POST", `/api/tasks/${t.id}/dependencias`, { depends_on_task_id: dep.id }); if (d.ok) estatLocal.dependencias++; }
      }
      if (prob(0.2)) {
        const extra = escolher(proj.membros);
        if (extra.id !== t.assignee_id) { await api(resp, "POST", `/api/tasks/${t.id}/responsaveis`, { user_id: extra.id }, { tolerar: true }); participantes.push(extra); }
      }
      if (proj.campos.length && prob(0.6)) {
        for (const c of amostra(proj.campos, entre(1, 4))) {
          const valor = c.tipo === "texto" ? escolher(["Unikivi", "Ministério", "Parceiro A", "Interno"])
            : c.tipo === "numero" ? String(entre(1, 120)) : c.tipo === "data" ? dataISO(entre(5, 90)) : escolher(c.opcoes);
          const v = await api(escolher(participantes), "PUT", `/api/tasks/${t.id}/campos/${c.id}`, { value: valor });
          if (v.ok) estatLocal.valores++;
        }
      }
      const nCom = prob(0.7) ? entre(1, 6) : 0;
      for (let k = 0; k < nCom; k++) {
        const autor = escolher(participantes);
        const mencao = prob(0.3) ? ` @${escolher(proj.membros).primeiroNome}` : "";
        const c = await api(autor, "POST", "/api/comments", { task_id: t.id, content: `${escolher(FRASES)}${mencao}` });
        if (c.ok) estatLocal.comentarios++;
      }
      if (prob(0.04)) {
        const f = new FormData();
        f.append("ficheiro", new Blob([("Relatório de carga. ".repeat(entre(50, 4000)))], { type: "text/plain" }), `carga-${i}.txt`);
        const a = await api(escolher(participantes), "POST", `/api/tasks/${t.id}/anexos`, f);
        if (a.ok) estatLocal.anexos++;
      }
      if (prob(0.1)) await api(resp, "PATCH", `/api/tasks/${t.id}`, { title: `${t.title} — revisto`, priority: escolher(["media", "alta"]) });
    });

    // movimentos (dispara as automações) — só responsáveis movem
    const aMover = amostra(proj.tarefas, Math.round(proj.tarefas.length * 0.6));
    await paralelo(aMover, 6, async (t) => {
      for (let k = 0; k < entre(1, 3); k++) {
        const destino = escolher(proj.colunas);
        const m = await api(escolher(proj.responsaveis), "PATCH", `/api/tasks/${t.id}/mover`, { column_id: destino.id, position: rnd(10) });
        if (m.ok) estatLocal.movimentos++;
      }
    });

    // metas ligadas a tarefas
    for (let g = 0; g < 3; g++) {
      const meta = await api(dono, "POST", `/api/projects/${proj.id}/metas`, { name: `Meta ${g + 1}: ${escolher(OBJETOS)}`, description: descricao(), target_date: dataISO(entre(10, 120)) });
      if (!meta.ok) continue;
      estatLocal.metas++;
      for (const t of amostra(proj.tarefas, entre(8, 25))) await api(dono, "PUT", `/api/projects/metas/${meta.dados.id}/tarefas/${t.id}`);
    }

    // reuniões
    for (let k = 0; k < entre(2, 4); k++) {
      const r4 = await api(escolher(proj.responsaveis), "POST", "/api/workspace/reunioes", {
        project_id: proj.id, title: `Reunião ${escolher(["semanal", "de arranque", "de revisão", "de planeamento"])}`,
        description: descricao(), scheduled_at: new Date(Date.now() + entre(1, 40) * 86400000).toISOString(), location: escolher(["Sala 3", "Google Meet", "Laboratório", "Zoom"]),
      });
      if (r4.ok) estatLocal.reunioes++;
    }

    // conversa da equipa: texto, respostas, menções, reações, edições, eliminações, ficheiros
    const nMsg = Math.round(E.mensagens * (0.6 + Math.random() * 0.8));
    for (let k = 0; k < nMsg; k++) {
      const autor = escolher(proj.membros);
      const responde = proj.mensagens.length > 3 && prob(0.15) ? escolher(proj.mensagens) : null;
      const mencao = prob(0.2) ? ` @${escolher(proj.membros).primeiroNome}` : "";
      const m = await api(autor, "POST", `/api/projects/${proj.id}/mensagens`, { content: `${escolher(FRASES)}${mencao}`, reply_to_id: responde?.id });
      if (!m.ok) continue;
      estatLocal.mensagens++;
      proj.mensagens.push({ id: m.dados.id, autor });
      if (prob(0.55)) for (let r = 0; r < entre(1, 3); r++) {
        const rr = await api(escolher(proj.membros), "POST", `/api/projects/mensagens/${m.dados.id}/reacoes`, { emoji: escolher(EMOJIS) });
        if (rr.ok) estatLocal.reacoes++;
      }
      if (prob(0.05)) await api(autor, "PATCH", `/api/projects/mensagens/${m.dados.id}`, { content: `${escolher(FRASES)} (corrigido)` });
      if (prob(0.03)) await api(autor, "DELETE", `/api/projects/mensagens/${m.dados.id}?escopo=todos`);
      else if (prob(0.03)) await api(escolher(proj.membros), "DELETE", `/api/projects/mensagens/${m.dados.id}?escopo=mim`);
    }
    for (const [tipo, mime, nomeF, tam] of [["imagem", "image/png", "captura.png", 4000], ["ficheiro", "application/pdf", "relatorio.pdf", 60000], ["audio", "audio/webm", "voz.webm", 20000]]) {
      const f = new FormData();
      f.append("ficheiro", new Blob([Buffer.alloc(tam, 1)], { type: mime }), `carga-${nomeF}`);
      f.append("tipo", tipo);
      if (tipo === "audio") f.append("duracao", String(entre(3, 40)));
      await api(escolher(proj.membros), "POST", `/api/projects/${proj.id}/mensagens/multimedia`, f);
    }

    // alguns membros saem do projeto (liberdade de sair)
    for (const u of amostra(proj.membros.filter((m) => !proj.responsaveis.includes(m)), prob(0.5) ? 1 : 0)) {
      const s = await api(u, "DELETE", `/api/projects/${proj.id}/membros/${u.id}`);
      if (s.ok) proj.membros = proj.membros.filter((m) => m.id !== u.id);
    }

    // eliminar umas quantas tarefas
    for (const t of amostra(proj.tarefas, Math.round(proj.tarefas.length * 0.03))) {
      await api(escolher(proj.responsaveis), "DELETE", `/api/tasks/${t.id}`);
    }
    return proj;
  }

  const idxs = Array.from({ length: E.projetos }, (_, i) => i);
  let feitos = 0;
  await paralelo(idxs, 3, async (i) => {
    const p = await criarProjeto(i);
    if (p) projetos.push(p);
    process.stdout.write(`\r✔ projetos preenchidos: ${++feitos}/${E.projetos}   `);
  });
  console.log();
  marca("projetos");

  // 3) Cronómetros (um por pessoa de cada vez, como no uso real) + durações realistas
  {
    const porUtilizador = new Map();
    for (const p of projetos) for (const t of amostra(p.tarefas, Math.round(p.tarefas.length * 0.2))) {
      const u = p.membros.find((m) => m.id === t.assignee_id) || p.dono;
      if (!porUtilizador.has(u.id)) porUtilizador.set(u.id, { u, tarefas: [] });
      porUtilizador.get(u.id).tarefas.push(t.id);
    }
    await paralelo([...porUtilizador.values()], 8, async ({ u, tarefas }) => {
      for (const tid of tarefas.slice(0, 8)) {
        const ini = await api(u, "POST", `/api/tasks/${tid}/tempo/iniciar`, undefined, { tolerar: true });
        if (!ini.ok) continue;
        const entrada = ini.dados.id || ini.dados.entrada?.id;
        if (entrada) { const pa = await api(u, "POST", `/api/tasks/tempo/${entrada}/parar`); if (pa.ok) estatLocal.tempo++; }
      }
    });
    // só para os totais fazerem sentido: espalha durações de 5 min a 3 h (ajuste direto na BD)
    await pool.query(
      `UPDATE gpitrack.time_entries te
          SET seconds = v.s, started_at = v.st, ended_at = v.st + make_interval(secs => v.s)
         FROM (SELECT id, (300 + floor(random() * 10500))::int AS s, now() - (random() * interval '20 days') AS st
                 FROM gpitrack.time_entries
                WHERE ended_at IS NOT NULL AND COALESCE(seconds, 0) < 5
                  AND user_id IN (SELECT id FROM gpitrack.users WHERE email LIKE $1)) v
        WHERE te.id = v.id`, [`%@${DOMINIO}`]);
  }
  marca("cronometros");
  console.log(`✔ cronómetros registados: ${estatLocal.tempo}`);

  // 4) Administração: anúncios, feedback, lembretes
  if (admin) {
    for (let k = 0; k < 3; k++) await api(admin, "POST", "/api/admin/mensagens", { content: `${PREFIXO}Anúncio geral ${k + 1}`, audience: "todos" });
    for (const p of projetos.slice(0, 5)) await api(admin, "POST", "/api/admin/mensagens", { content: `${PREFIXO}Aviso ao projeto ${p.nome}`, audience: "projeto", projectId: p.id });
    for (const u of utilizadores.slice(0, 10)) await api(admin, "POST", "/api/admin/mensagens", { content: `${PREFIXO}Mensagem para ${u.name}`, audience: "utilizador", userId: u.id });
    await api(admin, "POST", "/api/admin/lembretes/executar");
  }
  // feedback público: 12 pedidos seguidos (o limite é 10 por 15 min -> 2 devem ser recusados com 429)
  for (let k = 0; k < 12; k++) {
    const r = await fetch(BASE + "/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Teste de carga", message: `${PREFIXO}feedback ${k + 1}`, page: "carga" }) });
    registar("POST /api/feedback", 1, r.status);
  }
  marca("admin");
  faseMetricas = null;

  // ---------------------------------------------------------------- leitura (o que os ecrãs pedem)
  iniciarFase("leitura");
  const utilizadoresComProjeto = utilizadores.filter((u) => projetos.some((p) => p.membros.includes(u)));
  const maior = [...projetos].sort((a, b) => b.tarefas.length - a.tarefas.length)[0];
  const rondas = entre(3, 4);
  await paralelo(utilizadoresComProjeto, 20, async (u) => {
    for (let r = 0; r < rondas; r++) {
      await api(u, "GET", "/api/projects");
      await api(u, "GET", "/api/notifications");
      // O Espaço de Gestão só existe para responsáveis de projeto (e admins)
      if (projetos.some((p) => p.responsaveis.includes(u))) {
        for (const rota of ["dashboard", "tarefas", "membros", "equipas", "atividades", "relatorios", "reunioes"]) {
          await api(u, "GET", `/api/workspace/${rota}`);
        }
      }
      const meus = projetos.filter((p) => p.membros.includes(u));
      for (const p of amostra(meus, 2)) {
        await api(u, "GET", `/api/projects/${p.id}/quadro`);
        await api(u, "GET", `/api/projects/${p.id}/mensagens`);
        await api(u, "GET", `/api/projects/${p.id}/atividade`);
        await api(u, "GET", `/api/projects/${p.id}/metas`);
        await api(u, "GET", `/api/projects/${p.id}/campos`);
        await api(u, "GET", `/api/projects/${p.id}/etiquetas`);
        await api(u, "GET", `/api/projects/${p.id}/automacoes`);
        const t = escolher(p.tarefas);
        if (t) {
          await api(u, "GET", `/api/comments/tarefa/${t.id}`, undefined, { tolerar: true });
          await api(u, "GET", `/api/tasks/${t.id}/checklist`, undefined, { tolerar: true });
          await api(u, "GET", `/api/tasks/${t.id}/subtarefas`, undefined, { tolerar: true });
          await api(u, "GET", `/api/tasks/${t.id}/dependencias`, undefined, { tolerar: true });
          await api(u, "GET", `/api/tasks/${t.id}/tempo`, undefined, { tolerar: true });
          await api(u, "GET", `/api/tasks/${t.id}/campos`, undefined, { tolerar: true });
          await api(u, "GET", `/api/tasks/${t.id}/responsaveis`, undefined, { tolerar: true });
          await api(u, "GET", `/api/tasks/${t.id}/anexos`, undefined, { tolerar: true });
        }
      }
    }
  });
  // exportações do maior projeto
  if (maior) for (let k = 0; k < 3; k++) {
    await api(maior.dono, "GET", `/api/projects/${maior.id}/exportar/pdf`);
    await api(maior.dono, "GET", `/api/projects/${maior.id}/exportar/excel`);
  }
  await api(maior.dono, "GET", "/api/workspace/relatorios/exportar.csv");
  // administração com tudo carregado
  if (admin) for (let k = 0; k < 3; k++) {
    for (const rota of ["/api/admin/utilizadores", "/api/admin/projetos", "/api/admin/dashboard", "/api/admin/estatisticas", "/api/admin/notificacoes", "/api/admin/mensagens", "/api/admin/feedback", "/api/admin/online", "/api/admin/relatorios/dados", "/api/admin/relatorios/csv?tipo=tarefas"]) {
      await api(admin, "GET", rota, undefined, { tolerar: true });
    }
    await api(admin, "GET", "/api/admin/relatorios/pdf", undefined, { tolerar: true });
  }
  marca("leitura");
  faseMetricas = null;
  console.log("✔ leitura/benchmark concluído");

  // ---------------------------------------------------------------- tempo real
  let tempoReal = null;
  const maisGente = [...projetos].sort((a, b) => b.membros.length - a.membros.length)[0];
  if (!args["sem-tempo-real"] && maisGente) {
    try {
      const { io: ioc } = require("socket.io-client");
      const membros = maisGente.membros;
      const sockets = [];
      const recebidas = new Map(); // socket idx -> Set(ids)
      const latencias = [];
      const enviadoEm = new Map();
      await Promise.all(membros.map((u, i) => new Promise((res) => {
        const s = ioc(BASE, { auth: { token: u.token }, transports: ["websocket"], reconnection: false });
        recebidas.set(i, new Set());
        s.on("connect", () => { s.emit("project:entrar", maisGente.id); res(); });
        s.on("connect_error", () => res());
        s.on("channel:message", (m) => {
          recebidas.get(i).add(m.id);
          const t0 = enviadoEm.get(m.content);
          if (t0) latencias.push(performance.now() - t0);
        });
        sockets.push(s);
      })));
      const ligados = sockets.filter((s) => s.connected).length;
      await dorme(500);
      const N = 100;
      const enviados = [];
      // 100 mensagens em rajada, 10 em simultâneo, de vários autores
      await paralelo(Array.from({ length: N }, (_, i) => i), 10, async (i) => {
        const autor = membros[i % membros.length];
        const conteudo = `rt-${i}-${Date.now()}`;
        enviadoEm.set(conteudo, performance.now());
        const r = await api(autor, "POST", `/api/projects/${maisGente.id}/mensagens`, { content: conteudo });
        if (r.ok) enviados.push(r.dados.id);
      });
      await dorme(1500);
      const completos = [...recebidas.values()].filter((set) => enviados.every((id) => set.has(id))).length;
      tempoReal = {
        projeto: maisGente.nome, sockets: ligados, enviadas: enviados.length,
        entregaCompleta: completos, p50: percentil(latencias, 50), p95: percentil(latencias, 95), max: latencias.length ? Math.max(...latencias) : 0,
        entregas: latencias.length, esperadas: enviados.length * ligados,
      };
      sockets.forEach((s) => s.disconnect());
      console.log(`✔ tempo real: ${ligados} ligações, ${enviados.length} mensagens em rajada`);
    } catch (e) { avisos.push("Teste de tempo real falhou: " + e.message); }
  }
  marca("tempo-real");

  // ---------------------------------------------------------------- estado da base de dados
  const { rows: tamBD } = await pool.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS tamanho`);
  const { rows: tabelas } = await pool.query(
    `SELECT relname AS tabela, n_live_tup::bigint AS linhas, pg_size_pretty(pg_total_relation_size(relid)) AS tamanho,
            pg_total_relation_size(relid) AS bytes
     FROM pg_stat_user_tables WHERE schemaname = 'gpitrack' ORDER BY pg_total_relation_size(relid) DESC LIMIT 14`);
  const contar = async (sql) => Number((await pool.query(sql)).rows[0].n);
  const totais = {
    utilizadores: await contar(`SELECT COUNT(*) n FROM gpitrack.users`),
    projetos: await contar(`SELECT COUNT(*) n FROM gpitrack.projects`),
    tarefas: await contar(`SELECT COUNT(*) n FROM gpitrack.tasks`),
    comentarios: await contar(`SELECT COUNT(*) n FROM gpitrack.comments`),
    mensagens_canal: await contar(`SELECT COUNT(*) n FROM gpitrack.channel_messages`),
    reacoes: await contar(`SELECT COUNT(*) n FROM gpitrack.channel_message_reactions`),
    checklist: await contar(`SELECT COUNT(*) n FROM gpitrack.checklist_items`),
    notificacoes: await contar(`SELECT COUNT(*) n FROM gpitrack.notifications`),
    atividade: await contar(`SELECT COUNT(*) n FROM gpitrack.activity_log`),
    metas: await contar(`SELECT COUNT(*) n FROM gpitrack.project_goals`),
    automacoes: await contar(`SELECT COUNT(*) n FROM gpitrack.automations`),
    registos_tempo: await contar(`SELECT COUNT(*) n FROM gpitrack.time_entries`),
    dependencias: await contar(`SELECT COUNT(*) n FROM gpitrack.task_dependencies`).catch(() => 0),
    membros_projeto: await contar(`SELECT COUNT(*) n FROM gpitrack.project_members`),
    responsaveis: await contar(`SELECT COUNT(*) n FROM gpitrack.project_members WHERE role = 'responsavel'`),
  };

  // ---------------------------------------------------------------- relatório
  const dur = ((Date.now() - T0) / 1000).toFixed(0);
  const md = [];
  md.push(`# Relatório de carga — GPI Track`);
  md.push(`\nEscala **${escalaNome}** · duração total ${dur} s · servidor ${BASE} · ${new Date().toLocaleString("pt-PT")}\n`);
  md.push(`## Volume criado\n`);
  md.push(`| Item | Total na BD |\n|---|---:|\n${Object.entries(totais).map(([k, v]) => `| ${k.replace(/_/g, " ")} | ${v} |`).join("\n")}`);
  md.push(`\nBase de dados: **${tamBD[0].tamanho}**\n`);
  md.push(`| Tabela | Linhas | Tamanho (com índices) |\n|---|---:|---:|\n${tabelas.map((t) => `| ${t.tabela} | ${t.linhas} | ${t.tamanho} |`).join("\n")}`);
  md.push(`\n## Fase de escrita (criar dados com a API) — mais lentos primeiro\n\n${tabelaMetricas(fasesMetricas.escrita)}`);
  md.push(`\n## Fase de leitura (o que os ecrãs pedem, ${utilizadoresComProjeto.length} utilizadores em simultâneo, até 20 de cada vez)\n\n${tabelaMetricas(fasesMetricas.leitura)}`);
  if (tempoReal) {
    md.push(`\n## Tempo real (Socket.IO)\n`);
    md.push(`- Projeto: ${tempoReal.projeto} · ${tempoReal.sockets} ligações simultâneas`);
    md.push(`- ${tempoReal.enviadas} mensagens em rajada (10 ao mesmo tempo); entregas recebidas: ${tempoReal.entregas}/${tempoReal.esperadas}`);
    md.push(`- Ligações que receberam **todas** as mensagens: ${tempoReal.entregaCompleta}/${tempoReal.sockets}`);
    md.push(`- Atraso até ao destinatário: p50 ${tempoReal.p50.toFixed(0)} ms · p95 ${tempoReal.p95.toFixed(0)} ms · máx ${tempoReal.max.toFixed(0)} ms`);
  }
  const fb = metricas.get("POST /api/feedback");
  if (fb) md.push(`\n## Limite de feedback\n\n12 pedidos seguidos: ${JSON.stringify(fb.status)} (o limite é 10 por 15 minutos; os restantes têm de ser 429).`);
  if (erros.length) {
    const agrup = {};
    for (const e of erros) agrup[e.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id")] = (agrup[e.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id")] || 0) + 1;
    md.push(`\n## Pedidos recusados ou com erro\n\n${Object.entries(agrup).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([e, n]) => `- ${n}× ${e}`).join("\n")}`);
  }
  if (avisos.length) md.push(`\n## Avisos\n\n${avisos.map((a) => "- " + a).join("\n")}`);
  md.push(`\n## Contas para entrar e ver os dados\n\n- Utilizadores: carga001@${DOMINIO} … carga${String(E.utilizadores).padStart(3, "0")}@${DOMINIO} · password \`${PASSWORD}\``);
  md.push(`- Os projetos preenchidos são os de cada utilizador (carga001 é responsável do projeto #1, etc.). Um administrador vê todos em Administração.`);
  const ficheiro = path.join(process.cwd(), `relatorio-carga-${escalaNome}.md`);
  fs.writeFileSync(ficheiro, md.join("\n") + "\n");
  fs.writeFileSync(path.join(process.cwd(), `relatorio-carga-${escalaNome}.json`), JSON.stringify({
    escala: escalaNome, duracao_s: Number(dur), totais, tamanho_bd: tamBD[0].tamanho, tabelas,
    escrita: Object.fromEntries([...fasesMetricas.escrita].map(([k, m]) => [k, { n: m.t.length, p50: percentil(m.t, 50), p95: percentil(m.t, 95), max: Math.max(...m.t), status: m.status }])),
    leitura: Object.fromEntries([...fasesMetricas.leitura].map(([k, m]) => [k, { n: m.t.length, p50: percentil(m.t, 50), p95: percentil(m.t, 95), max: Math.max(...m.t), status: m.status, bytes_medios: Math.round(m.bytes / m.t.length) }])),
    tempoReal, erros: erros.length, tempos,
  }, null, 2));

  console.log(`\nConcluído em ${dur} s. Totais: ${JSON.stringify(totais)}`);
  console.log(`Erros/recusas: ${erros.length}. Relatório: ${ficheiro}`);
  await pool.end();
  process.exit(0);
})().catch(async (e) => {
  console.error("Falhou:", e);
  try { await pool.end(); } catch { /* ignora */ }
  process.exit(1);
});
