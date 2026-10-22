// Tutoriais animados das funcionalidades do GPI Track (página /funcionalidades.html).
// Cada funcionalidade tem passos; cada passo tem uma "cena" desenhada em HTML/CSS
// (sem imagens externas) que se anima quando o passo aparece.

const Z = {
  win(titulo, corpo, extra = "") {
    return `<div class="tz-win ${extra}"><div class="tz-bar"><i></i><i></i><i></i><span>${titulo}</span></div><div class="tz-content">${corpo}</div></div>`;
  },
  cur(x0, y0, x1, y1, d = 0.4) {
    return `<i class="bi bi-cursor-fill tz-cursor" style="--x0:${x0};--y0:${y0};--x1:${x1};--y1:${y1};--d:${d}s"></i>`;
  },
  av(n, c = "#22C7DD") { return `<span class="tz-av" style="background:${c}">${n}</span>`; },
  chip(t, c = "var(--cyan)", d = 0) { return `<span class="tz-chip tz-in" style="--c:${c};--d:${d}s">${t}</span>`; },
  card(t, o = {}) {
    return `<div class="tz-card ${o.cls || ""} tz-in" style="--d:${o.d || 0}s;${o.prio ? `border-left-color:${o.prio}` : ""}">${t}${o.sub ? `<small>${o.sub}</small>` : ""}</div>`;
  },
  kb(o = {}) {
    const col = (n, cards) => `<div class="tz-col"><b>${n}</b>${cards}</div>`;
    const c1 = Z.card("Desenhar ecrã de login", { prio: "#E2445C" }) + (o.move ? Z.card("Criar API de tarefas", { cls: "tz-sai", prio: "#FFCB00", d: 0.2 }) : Z.card("Criar API de tarefas", { prio: "#FFCB00" }));
    const c2 = Z.card("Configurar base de dados", { prio: "#00C875" }) + (o.move ? Z.card("Criar API de tarefas", { cls: "tz-chega", prio: "#FFCB00" }) : "");
    const c3 = o.vazia ? "" : Z.card("Escrever relatório", { prio: "#00C875" });
    const corpo = `<div class="tz-kb">${col("Por fazer", c1)}${col("Em curso", c2)}${col("Concluído ✓", c3)}</div>${o.move ? Z.cur("18%", "30%", "52%", "34%", 0.5) : ""}${o.toast ? `<div class="tz-toast tz-in" style="--d:1.6s"><i class="bi bi-lightning-charge-fill"></i> ${o.toast}</div>` : ""}`;
    return o.raw ? corpo : Z.win("Quadro · Projeto CurriculumIA", corpo);
  },
  abas(ativa) {
    const a = ["🗂️ Quadro", "📋 Lista", "📅 Calendário", "📊 Gantt", "🎯 Metas", "💬 Conversa"];
    return `<div class="tz-tabs">${a.map((t, i) => `<span class="${i === ativa ? "on" : ""}">${t}</span>`).join("")}</div>`;
  },
  lista() {
    const r = [["Desenhar ecrã de login", "Por fazer", "Alta", "AN", "12 Nov"], ["Criar API de tarefas", "Em curso", "Média", "VM", "15 Nov"], ["Configurar base de dados", "Em curso", "Baixa", "DO", "18 Nov"], ["Escrever relatório", "Concluído", "Baixa", "VM", "20 Nov"]];
    return `<table class="tz-tabela"><tr><th>Tarefa</th><th>Coluna</th><th>Prio.</th><th>Resp.</th><th>Prazo</th></tr>${r.map((x, i) => `<tr class="tz-in" style="--d:${0.15 * i}s">${x.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`;
  },
  cal() {
    let d = "";
    for (let i = 1; i <= 21; i++) {
      const t = { 4: ["Entrega A", "#22C7DD"], 9: ["Reunião", "#7B68EE"], 12: ["Login", "#E2445C"], 17: ["Relatório", "#00C875"] }[i];
      d += `<div class="tz-dia ${t ? "has" : ""}"><span>${i}</span>${t ? `<em class="tz-in" style="--c:${t[1]};--d:${0.1 * i}s">${t[0]}</em>` : ""}</div>`;
    }
    return `<div class="tz-cal">${d}</div>`;
  },
  gantt() {
    const r = [["Análise", 0, 28, "#22C7DD"], ["Desenho", 18, 30, "#7B68EE"], ["Código", 40, 40, "#00C875"], ["Testes", 66, 26, "#FDAB3D"]];
    return `<div class="tz-gantt">${r.map(([n, l, w, c], i) => `<div class="tz-gl"><b>${n}</b><div class="tz-gt"><i class="tz-barra" style="left:${l}%;--w:${w}%;background:${c};--d:${0.2 * i}s"></i></div></div>`).join("")}<svg class="tz-seta" viewBox="0 0 100 20"><path d="M30 2 C 36 2, 34 12, 40 12" fill="none" stroke="var(--ink-faint)" stroke-width="1.2" stroke-dasharray="3 2"/></svg></div>`;
  },
  tarefa(extra = "", cursor = "") {
    return Z.win("Detalhe da tarefa", `<div class="tz-tarefa"><div class="tz-t-main"><h5>Criar API de tarefas</h5><div class="tz-lin">Prazo 15 Nov · Responsável Vital</div>${extra}</div><div class="tz-t-side"><div class="tz-mini">⏱️ Registo de tempo</div><div class="tz-mini">🔗 Dependências</div><div class="tz-mini">📎 Anexos</div></div></div>${cursor}`);
  },
  chat(msgs) {
    return Z.win("Conversa da equipa", `<div class="tz-chat">${msgs.map((m, i) => `<div class="tz-msg tz-in ${m.eu ? "eu" : ""}" style="--d:${0.5 * i + 0.1}s">${m.eu ? "" : Z.av(m.n, m.c)}<div class="tz-bolha">${m.reply ? `<div class="tz-reply">${m.reply}</div>` : ""}${m.t}${m.re ? `<div class="tz-re">${m.re}</div>` : ""}</div></div>`).join("")}</div>`);
  },
  form(campos, botao, extra = "") {
    return `<div class="tz-form">${campos.map(([l, v], i) => `<label>${l}</label><div class="tz-campo"><span class="tz-type" style="--d:${0.3 + i * 0.6}s">${v}</span></div>`).join("")}<button class="tz-btn tz-in" style="--d:${0.3 + campos.length * 0.6}s">${botao}</button>${extra}</div>`;
  },
  check(itens, pct) {
    return `<div class="tz-check">${itens.map(([t, ok], i) => `<div class="tz-ci"><i class="bi ${ok ? "bi-check-square-fill tz-tick" : "bi-square"}" style="--d:${0.4 + i * 0.5}s"></i><span>${t}</span></div>`).join("")}<div class="tz-prog"><i style="--w:${pct}%"></i></div><small>${pct}% concluído</small></div>`;
  },
  barras(v, cores) {
    return `<div class="tz-barras">${v.map((n, i) => `<div><i class="tz-grow" style="--h:${n}%;--d:${i * 0.15}s;background:${cores[i % cores.length]}"></i><small>${["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][i] || ""}</small></div>`).join("")}</div>`;
  },
  sino(itens) {
    return Z.win("Notificações", `<div class="tz-sino"><div class="tz-sino-ico tz-pulse"><i class="bi bi-bell-fill"></i><b>${itens.length}</b></div>${itens.map((t, i) => `<div class="tz-notif tz-in" style="--d:${0.3 + i * 0.4}s"><i class="bi ${t[0]}"></i><span>${t[1]}</span></div>`).join("")}</div>`);
  },
  regra(a, b, c) {
    return `<div class="tz-regra"><div class="tz-bloco tz-in" style="--d:.1s"><small>QUANDO</small>${a}</div><i class="bi bi-arrow-right tz-in" style="--d:.5s"></i><div class="tz-bloco tz-in" style="--d:.9s"><small>ENTÃO</small>${b}</div>${c ? `<div class="tz-resultado tz-in" style="--d:1.6s">${c}</div>` : ""}</div>`;
  },
  cena(icone, titulo, texto, cor = "var(--cyan)") {
    return `<div class="tz-big tz-in"><div class="tz-big-ico" style="color:${cor}"><i class="bi ${icone}"></i></div><b>${titulo}</b><span>${texto}</span></div>`;
  },
};

const TUTORIAIS = [
  {
    id: "kanban", icone: "🗂️", titulo: "Quadro Kanban em tempo real", ferramentas: ["asana", "clickup"],
    desc: "Arraste tarefas entre colunas e veja as mudanças a acontecer instantaneamente para toda a equipa.",
    passos: [
      { t: "Abra um projeto", d: "Em “Os meus projetos” escolha um projeto — ou crie um novo com o botão “Novo projeto”. Cada cartão mostra o progresso e os prazos em atraso.", s: () => Z.win("Os meus projetos", `<div class="tz-grid2">${["CurriculumIA", "Site da Unikivi"].map((n, i) => `<div class="tz-pc tz-in" style="--d:${i * 0.2}s"><b>${n}</b><div class="tz-prog"><i style="--w:${i ? 35 : 70}%"></i></div><small>${i ? "35" : "70"}% concluído</small></div>`).join("")}</div>${Z.cur("70%", "75%", "26%", "40%", 0.6)}`) },
      { t: "Veja as colunas", d: "O quadro tem colunas como Por fazer, Em curso e Concluído. A cor na lateral de cada cartão mostra a prioridade.", s: () => Z.kb() },
      { t: "Arraste uma tarefa", d: "Pegue num cartão e largue-o na coluna seguinte. Só os responsáveis do projeto e os administradores movem tarefas.", s: () => Z.kb({ move: true }) },
      { t: "Toda a equipa vê na hora", d: "Sem recarregar a página, os colegas veem o cartão a mudar de coluna e recebem um aviso.", s: () => Z.kb({ move: true, toast: "Vital moveu “Criar API de tarefas” para Em curso" }) },
    ],
  },
  {
    id: "vistas", icone: "📋", titulo: "Lista, Calendário e Gantt", ferramentas: ["asana", "clickup", "monday", "smartsheet"],
    desc: "As mesmas tarefas em vários formatos: lista ordenável, calendário mensal e gráfico de Gantt.",
    passos: [
      { t: "Escolha a vista", d: "No topo do quadro há separadores para alternar entre Quadro, Lista, Calendário, Gantt, Metas e Conversa.", s: () => Z.win("Vistas do projeto", Z.abas(0) + Z.kb({ raw: true })) },
      { t: "Lista", d: "Todas as tarefas numa tabela com coluna, prioridade, responsável e prazo.", s: () => Z.win("Vista · Lista", Z.abas(1) + Z.lista()) },
      { t: "Calendário", d: "Tarefas organizadas pelo prazo. Clique num dia para ver todas as tarefas desse dia.", s: () => Z.win("Vista · Calendário", Z.abas(2) + Z.cal() + Z.cur("20%", "70%", "46%", "52%", 0.8)) },
      { t: "Gantt", d: "Cada tarefa é uma barra entre a data de início e o prazo, com ligação às dependências.", s: () => Z.win("Vista · Gantt", Z.abas(3) + Z.gantt()) },
    ],
  },
  {
    id: "prioridades", icone: "🟢", titulo: "Estados e prioridades coloridas", ferramentas: ["monday"],
    desc: "Etiquetas e níveis de prioridade visuais para identificar rapidamente o que precisa de atenção.",
    passos: [
      { t: "Defina a prioridade", d: "Ao criar ou editar uma tarefa escolha Baixa, Média ou Alta. A cor aparece na lateral do cartão.", s: () => Z.win("Nova tarefa", Z.form([["Título", "Criar API de tarefas"], ["Prioridade", "Alta 🔴"]], "Criar tarefa")) },
      { t: "Junte etiquetas", d: "O responsável do projeto cria etiquetas coloridas (Backend, Urgente…) e qualquer tarefa pode ter várias.", s: () => Z.tarefa(`<div class="tz-chips">${Z.chip("Backend", "#7B68EE")}${Z.chip("Urgente", "#E2445C", 0.3)}${Z.chip("Sprint 2", "#00C875", 0.6)}</div>`) },
      { t: "Filtre o quadro", d: "Use a pesquisa e os filtros de responsável e etiqueta para ver só o que interessa.", s: () => Z.win("Filtros", `<div class="tz-filtros"><span class="tz-input">🔍 api</span><span class="tz-input">Todos os responsáveis ▾</span><span class="tz-input on">Etiqueta: Urgente ▾</span></div>${Z.kb({ raw: true })}`) },
    ],
  },
  {
    id: "automacoes", icone: "⚡", titulo: "Automações simples", ferramentas: ["monday"],
    desc: "“Quando uma tarefa entrar nesta coluna, faz X” — notifica, atribui, muda a prioridade ou fecha a checklist.",
    passos: [
      { t: "Abra Automações", d: "No separador ⚡ Automações (só responsáveis e administradores) veja e crie regras.", s: () => Z.win("Vista · Automações", Z.abas(5).replace("💬 Conversa", "⚡ Automações") + Z.cena("bi-lightning-charge", "Nenhuma regra ainda", "Crie a primeira com “Nova automação”.", "var(--monday-yellow)")) },
      { t: "Escolha o gatilho", d: "Selecione a coluna que dispara a regra, por exemplo “Em revisão”.", s: () => Z.win("Nova automação", Z.regra("Tarefa entra em <b>Em revisão</b>", "<i>escolher ação…</i>")) },
      { t: "Escolha a ação", d: "Notificar alguém, atribuir a tarefa, mudar a prioridade ou marcar toda a checklist como concluída.", s: () => Z.win("Nova automação", Z.regra("Tarefa entra em <b>Em revisão</b>", "Notificar <b>Ana</b>")) },
      { t: "A regra trabalha por si", d: "Quando alguém mover uma tarefa para essa coluna, a ação acontece sozinha e fica registada.", s: () => Z.win("Automação a correr", Z.regra("Tarefa entra em <b>Em revisão</b>", "Notificar <b>Ana</b>", "🔔 Ana recebeu: “Criar API de tarefas está em revisão”")) },
    ],
  },
  {
    id: "comentarios", icone: "💬", titulo: "Comentários e menções ao vivo", ferramentas: ["slack"],
    desc: "Discuta cada tarefa em tempo real, com indicador de “a escrever…” e menções @nome.",
    passos: [
      { t: "Abra uma tarefa", d: "Clique num cartão. No detalhe estão os comentários em tempo real.", s: () => Z.tarefa("", Z.cur("60%", "80%", "30%", "28%", 0.3)) },
      { t: "Escreva e mencione", d: "Escreva o comentário e use @ seguido do nome para mencionar alguém da equipa.", s: () => Z.chat([{ n: "VM", t: "Já acabei a API, vê isto @Ana" , eu: true }]) },
      { t: "“A escrever…”", d: "Os colegas veem em direto que está a escrever, tal como no Slack ou no WhatsApp.", s: () => Z.chat([{ n: "VM", t: "Já acabei a API, vê isto @Ana", eu: true }, { n: "AN", t: "A escrever<span class='tz-dots'><i></i><i></i><i></i></span>", c: "#7B68EE" }]) },
      { t: "A pessoa é avisada", d: "Quem foi mencionado recebe uma notificação que o leva direto à tarefa.", s: () => Z.sino([["bi-at", "Vital mencionou-a em “Criar API de tarefas”"]]) },
    ],
  },
  {
    id: "canal", icone: "📣", titulo: "Conversa geral da equipa", ferramentas: ["slack"],
    desc: "Um canal por projeto com ficheiros, áudio, reações, respostas, menções e pesquisa.",
    passos: [
      { t: "Abra a Conversa", d: "O separador 💬 Conversa da equipa é o canal geral do projeto, à parte dos comentários das tarefas.", s: () => Z.chat([{ n: "AN", t: "Bom dia equipa! 👋", c: "#7B68EE" }, { n: "DO", t: "Bom dia! Reunião às 15h?", c: "#FDAB3D" }]) },
      { t: "Envie texto, ficheiros e áudio", d: "Além de texto pode enviar imagens, GIFs, documentos e gravar mensagens de áudio.", s: () => Z.chat([{ n: "VM", t: "📎 relatorio-v2.pdf", eu: true }, { n: "VM", t: "🎙️ Áudio · 0:14", eu: true }]) },
      { t: "Reaja e responda", d: "Passe o rato numa mensagem para reagir com emoji ou responder a essa mensagem específica.", s: () => Z.chat([{ n: "DO", t: "Reunião às 15h?", c: "#FDAB3D", re: "👍 3 &nbsp; 🎉 1" }, { n: "VM", t: "Sim, às 15h!", eu: true, reply: "↩ Domingos: Reunião às 15h?" }]) },
      { t: "Pesquise o histórico", d: "A caixa de pesquisa no topo do canal encontra qualquer mensagem antiga.", s: () => Z.win("Conversa da equipa", `<div class="tz-filtros"><span class="tz-input on">🔍 relatório</span></div><div class="tz-chat"><div class="tz-msg tz-in" style="--d:.3s">${Z.av("VM")}<div class="tz-bolha">📎 <mark>relatório</mark>-v2.pdf</div></div></div>`) },
    ],
  },
  {
    id: "anexos", icone: "📎", titulo: "Anexos enviados ao responsável", ferramentas: ["smartsheet"],
    desc: "Envie ficheiros diretamente ao responsável do projeto, com notificação instantânea.",
    passos: [
      { t: "Abra a tarefa", d: "No detalhe da tarefa, na coluna lateral, está a secção Anexos.", s: () => Z.tarefa("", Z.cur("70%", "85%", "74%", "55%", 0.3)) },
      { t: "Escolha o ficheiro", d: "Selecione o documento no seu computador ou telemóvel.", s: () => Z.win("Anexos", `<div class="tz-anexo tz-in"><i class="bi bi-file-earmark-pdf"></i><div><b>relatorio-v2.pdf</b><small>1,2 MB</small></div></div>${Z.form([], "Enviar ao responsável")}`) },
      { t: "O responsável é avisado", d: "O responsável do projeto recebe logo uma notificação e pode abrir o ficheiro.", s: () => Z.sino([["bi-paperclip", "Vital enviou “relatorio-v2.pdf” em “Criar API de tarefas”"]]) },
    ],
  },
  {
    id: "checklist", icone: "✔️", titulo: "Checklists com progresso", ferramentas: ["clickup"],
    desc: "Divida tarefas em subitens e acompanhe a percentagem de conclusão em tempo real.",
    passos: [
      { t: "Crie os itens", d: "Os responsáveis do projeto adicionam itens à checklist (também ao criar a tarefa).", s: () => Z.win("Checklist", Z.check([["Modelar tabelas", false], ["Criar rotas", false], ["Testar com Postman", false]], 0)) },
      { t: "Marque o que está feito", d: "Quem trabalha na tarefa marca os itens concluídos.", s: () => Z.win("Checklist", Z.check([["Modelar tabelas", true], ["Criar rotas", true], ["Testar com Postman", false]], 66)) },
      { t: "Veja o progresso", d: "A barra sobe e todos veem a percentagem atualizada no cartão e no detalhe.", s: () => Z.win("Checklist", Z.check([["Modelar tabelas", true], ["Criar rotas", true], ["Testar com Postman", true]], 100)) },
    ],
  },
  {
    id: "notificacoes", icone: "🔔", titulo: "Notificações em tempo real", ferramentas: ["slack", "asana"],
    desc: "Fique a par de atribuições, comentários, convites, prazos e anúncios assim que acontecem.",
    passos: [
      { t: "O sino acende", d: "Qualquer evento relevante faz o sino mostrar um contador de não lidas, sem recarregar a página.", s: () => Z.sino([["bi-person-check", "Foi-lhe atribuída “Criar API de tarefas”"], ["bi-alarm", "“Escrever relatório” termina amanhã"]]) },
      { t: "Clique e vá ao local", d: "Cada notificação leva diretamente ao projeto e à tarefa em causa.", s: () => Z.kb({ move: true }).replace("tz-kb", "tz-kb tz-realce") },
      { t: "Escolha também o e-mail", d: "No Espaço de Gestão pode ligar ou desligar o envio das notificações para o seu e-mail.", s: () => Z.win("Preferências", `<div class="tz-switch"><span>Notificações por e-mail</span><i class="tz-sw on"></i></div>`) },
    ],
  },
  {
    id: "presenca", icone: "👥", titulo: "Presença da equipa", ferramentas: ["slack"],
    desc: "Veja quem está a ver o projeto agora — útil para coordenar o trabalho em home office.",
    passos: [
      { t: "Quem está online", d: "No topo do quadro aparecem os avatares de quem está a ver o projeto neste momento.", s: () => Z.win("Quadro", `<div class="tz-presenca">${Z.av("VM")}${Z.av("AN", "#7B68EE")}${Z.av("DO", "#FDAB3D")}<span class="tz-ponto"></span><small>3 online agora</small></div>${Z.kb({ vazia: true, raw: true })}`) },
      { t: "Atualização instantânea", d: "Quando alguém entra ou sai, a lista muda sozinha.", s: () => Z.cena("bi-people-fill", "Ana entrou no projeto", "A lista de presença atualiza em direto.", "var(--success)") },
    ],
  },
  {
    id: "relatorios", icone: "📊", titulo: "Relatórios e gráficos", ferramentas: ["smartsheet"],
    desc: "Dashboards com gráficos, relatórios em PDF e exportação em CSV.",
    passos: [
      { t: "Abra os relatórios", d: "No Espaço de Gestão (e na Administração) o separador Relatórios resume tudo com gráficos.", s: () => Z.win("Relatórios", Z.barras([40, 70, 55, 90, 65, 30], ["#22C7DD", "#7B68EE", "#00C875"])) },
      { t: "Consulte os números", d: "Concluídas, em atraso, por prioridade e por pessoa — tudo calculado automaticamente.", s: () => Z.win("Relatórios", `<div class="tz-kpis"><div><b>24</b><small>Tarefas</small></div><div><b>17</b><small>Concluídas</small></div><div><b style="color:var(--danger)">3</b><small>Em atraso</small></div></div>`) },
      { t: "Exporte", d: "Gere um PDF profissional ou descarregue CSV compatível com Excel e Google Sheets.", s: () => Z.cena("bi-file-earmark-arrow-down", "relatorio-geral.pdf", "Pronto a imprimir ou enviar.", "var(--danger)") },
    ],
  },
  {
    id: "anuncios", icone: "📢", titulo: "Anúncios da administração", ferramentas: ["slack", "monday"],
    desc: "A administração envia comunicados a toda a plataforma, a um projeto ou a uma pessoa.",
    passos: [
      { t: "Escreva o anúncio", d: "Em Administração → Mensagens escreva o título e o texto.", s: () => Z.win("Administração · Mensagens", Z.form([["Assunto", "Manutenção sábado"], ["Mensagem", "O sistema reinicia às 22h."]], "Enviar")) },
      { t: "Escolha o destinatário", d: "Todos os utilizadores, um projeto específico ou uma única pessoa.", s: () => Z.win("Destinatário", `<div class="tz-radios"><span class="on">🌍 Toda a plataforma</span><span>📁 Um projeto</span><span>👤 Uma pessoa</span></div>`) },
      { t: "Chega como notificação", d: "Cada destinatário recebe o anúncio no sino, na hora.", s: () => Z.sino([["bi-megaphone", "Anúncio: Manutenção sábado"]]) },
    ],
  },
  {
    id: "colunas", icone: "🔒", titulo: "Colunas e responsáveis configuráveis", ferramentas: ["monday", "asana"],
    desc: "Escolha as colunas, qual representa “concluído”, quais são restritas e quem são os responsáveis.",
    passos: [
      { t: "Crie ou edite colunas", d: "Escolha um nome sugerido (Em teste, Bloqueado…) ou escreva o seu.", s: () => Z.win("Nova coluna", Z.form([["Nome", "Em teste"]], "Guardar coluna")) },
      { t: "Marque a coluna “concluída”", d: "É a que conta nos relatórios e gráficos. Só pode haver uma por projeto.", s: () => Z.win("Coluna", `<div class="tz-switch"><span>✓ Representa “tarefa concluída”</span><i class="tz-sw on"></i></div><div class="tz-switch"><span>🔒 Restrita a responsáveis</span><i class="tz-sw"></i></div>`) },
      { t: "Vários responsáveis", d: "Na lista de membros, quem já é responsável pode tornar outro colega responsável também.", s: () => Z.win("Membros", `<div class="tz-membros">${[["VM", "Vital", true], ["AN", "Ana", true], ["DO", "Domingos", false]].map(([a, n, r], i) => `<div class="tz-mem tz-in" style="--d:${i * 0.2}s">${Z.av(a)}<span>${n}</span><label><i class="bi ${r ? "bi-check-square-fill" : "bi-square"}"></i> Responsável</label></div>`).join("")}</div>`) },
    ],
  },
  {
    id: "convites", icone: "✉️", titulo: "Convites e equipas", ferramentas: ["asana"],
    desc: "Convide colegas por e-mail; eles aceitam ou recusam, e podem sair do projeto quando quiserem.",
    passos: [
      { t: "Convide alguém", d: "Procure por nome ou e-mail. Se for membro comum, o responsável aprova primeiro.", s: () => Z.win("Convidar membro", `<div class="tz-filtros"><span class="tz-input on">🔍 ana@ukv.ao</span></div><div class="tz-mem tz-in" style="--d:.4s">${Z.av("AN", "#7B68EE")}<span>Ana Silva</span><button class="tz-btn mini">Convidar</button></div>`) },
      { t: "Aceitar ou recusar", d: "A pessoa recebe o convite com todos os detalhes do projeto e decide.", s: () => Z.win("Convite", `<div class="tz-pc tz-in"><b>✉️ CurriculumIA</b><small>5 membros · 24 tarefas · convidado por Vital</small><div class="tz-bts"><button class="tz-btn mini">Aceitar</button><button class="tz-btn mini ghost">Recusar</button></div></div>`) },
      { t: "Liberdade para sair", d: "Qualquer membro pode sair; o responsável é avisado. Só não pode ficar sem nenhum responsável.", s: () => Z.cena("bi-box-arrow-right", "Saiu do projeto", "O responsável recebeu uma notificação.", "var(--warn)") },
    ],
  },
  {
    id: "campos", icone: "🧩", titulo: "Campos personalizados e agrupar", ferramentas: ["monday", "smartsheet"],
    desc: "Crie colunas extra (texto, número, data, lista) e agrupe o quadro por responsável, prioridade ou etiqueta.",
    passos: [
      { t: "Defina os campos", d: "O responsável cria campos como “Cliente” ou “Horas estimadas” na barra lateral.", s: () => Z.win("Campos personalizados", Z.form([["Nome", "Horas estimadas"], ["Tipo", "Número"]], "Criar campo")) },
      { t: "Preencha na tarefa", d: "Os campos aparecem no detalhe de cada tarefa.", s: () => Z.tarefa(`<div class="tz-mini">Horas estimadas: <b>8</b></div>`) },
      { t: "Agrupe o quadro", d: "Escolha “Agrupar: Responsável” (ou Prioridade/Etiqueta) para ver o trabalho por pessoa.", s: () => Z.win("Agrupar", `<div class="tz-filtros"><span class="tz-input on">Agrupar: Responsável ▾</span></div><div class="tz-kb"><div class="tz-col"><b>Vital</b>${Z.card("API")}${Z.card("Testes", { d: 0.2 })}</div><div class="tz-col"><b>Ana</b>${Z.card("Login", { d: 0.1 })}</div><div class="tz-col"><b>Domingos</b>${Z.card("Relatório", { d: 0.3 })}</div></div>`) },
    ],
  },
  {
    id: "subtarefas", icone: "🧱", titulo: "Subtarefas e dependências", ferramentas: ["asana"],
    desc: "Divida em tarefas-filhas com dono e prazo, e marque o que só pode começar depois de outra terminar.",
    passos: [
      { t: "Crie subtarefas", d: "Cada subtarefa tem o seu estado e responsável, para além da checklist simples.", s: () => Z.win("Subtarefas", Z.check([["Modelar dados", true], ["Escrever rotas", false]], 50)) },
      { t: "Marque dependências", d: "Escolha a tarefa que tem de terminar primeiro. Se ainda não terminou, aparece um aviso.", s: () => Z.tarefa(`<div class="tz-chips">${Z.chip("⛔ Depois de: Desenhar login", "var(--warn)")}</div>`) },
      { t: "Veja no Gantt", d: "As dependências aparecem como ligações entre as barras.", s: () => Z.win("Gantt", Z.gantt()) },
    ],
  },
  {
    id: "semana", icone: "🗓️", titulo: "“Minha semana”", ferramentas: ["asana"],
    desc: "Todas as tarefas de todos os projetos que têm prazo nos próximos 7 dias, num só sítio.",
    passos: [
      { t: "Abra o Espaço de Gestão", d: "No separador “Minha semana” veja só o que vence nos próximos dias.", s: () => Z.win("Minha semana", `${["Hoje · Escrever relatório", "Amanhã · Criar API", "Sexta · Entrega A"].map((t, i) => `<div class="tz-notif tz-in" style="--d:${i * 0.3}s"><i class="bi bi-calendar-check"></i><span>${t}</span></div>`).join("")}`) },
      { t: "Clique para abrir", d: "Cada linha leva direto à tarefa no projeto certo.", s: () => Z.kb({ move: true }).replace("tz-kb", "tz-kb tz-realce") },
    ],
  },
  {
    id: "tempo", icone: "⏱️", titulo: "Registo de tempo", ferramentas: ["clickup"],
    desc: "Cronómetro em cada tarefa, com o total por tarefa, por pessoa e por projeto.",
    passos: [
      { t: "Inicie o cronómetro", d: "No detalhe da tarefa carregue em ▶ Iniciar quando começar a trabalhar.", s: () => Z.win("Registo de tempo", `<div class="tz-timer"><b class="tz-tick-num">00:12:48</b><button class="tz-btn mini">⏸ Parar</button></div>`) },
      { t: "Pare e acumule", d: "Ao parar, o tempo é somado ao total da tarefa.", s: () => Z.win("Registo de tempo", `<div class="tz-timer"><b>1h 05m</b><small>total desta tarefa</small></div>`) },
      { t: "Veja nos relatórios", d: "Os totais por pessoa e por projeto aparecem nos relatórios.", s: () => Z.win("Tempo por pessoa", Z.barras([80, 45, 60], ["#7B68EE", "#22C7DD", "#FDAB3D"])) },
    ],
  },
  {
    id: "metas", icone: "🎯", titulo: "Metas do projeto", ferramentas: ["clickup"],
    desc: "Crie uma meta com data-alvo, ligue tarefas e veja o progresso calculado automaticamente.",
    passos: [
      { t: "Crie a meta", d: "No separador 🎯 Metas defina o nome e a data-alvo.", s: () => Z.win("Nova meta", Z.form([["Meta", "Lançar versão 1.0"], ["Data-alvo", "30/11/2026"]], "Criar meta")) },
      { t: "Ligue tarefas", d: "Escolha as tarefas que contam para essa meta.", s: () => Z.win("Meta", Z.check([["Login", true], ["API", true], ["Relatórios", false], ["Testes", false]], 50)) },
      { t: "Acompanhe", d: "O progresso sobe sozinho à medida que as tarefas ligadas ficam concluídas.", s: () => Z.win("Metas", `<div class="tz-pc"><b>🎯 Lançar versão 1.0</b><div class="tz-prog"><i style="--w:75%"></i></div><small>75% · faltam 12 dias</small></div>`) },
    ],
  },
  {
    id: "mfa", icone: "🔐", titulo: "Autenticação de dois fatores", ferramentas: ["transversal"],
    desc: "Proteja a conta com um código de 6 dígitos gerado numa app como o Google Authenticator.",
    passos: [
      { t: "Ative a segurança", d: "Espaço de Gestão → Visão geral → Segurança → “Ativar 2FA”.", s: () => Z.win("Segurança", `<div class="tz-switch"><span>🔐 Autenticação de dois fatores</span><i class="tz-sw"></i></div>${Z.cur("70%", "70%", "80%", "28%", 0.5)}`) },
      { t: "Leia o QR code", d: "Abra a app de autenticação no telemóvel e leia o código QR.", s: () => Z.win("Configurar 2FA", `<div class="tz-qr tz-in">${Array.from({ length: 49 }, (_, i) => `<i class="${(i * 7 + (i >> 2)) % 3 ? "on" : ""}"></i>`).join("")}</div>`) },
      { t: "Confirme com o código", d: "Escreva o código de 6 dígitos que a app mostra para concluir a ativação.", s: () => Z.win("Confirmar", Z.form([["Código", "4 8 2 1 9 7"]], "Ativar")) },
      { t: "No próximo login", d: "Depois da password, a plataforma pede sempre o código. Pode desativar quando quiser.", s: () => Z.win("Entrar", Z.form([["Password", "••••••••"], ["Código de 6 dígitos", "482197"]], "Entrar")) },
    ],
  },
  {
    id: "exportar", icone: "⬇️", titulo: "Exportar para PDF ou Excel", ferramentas: ["transversal"],
    desc: "Leve o quadro completo (tarefas, responsáveis, prazos e estado) para fora da plataforma.",
    passos: [
      { t: "Abra o menu Exportar", d: "No topo do quadro, carregue em ⬇️ Exportar.", s: () => Z.win("Quadro", `<div class="tz-menu tz-in"><div>📄 Exportar como PDF</div><div>📊 Exportar como Excel</div></div>${Z.cur("80%", "10%", "68%", "42%", 0.5)}`) },
      { t: "Escolha o formato", d: "PDF para imprimir ou apresentar; Excel para continuar a trabalhar os dados.", s: () => Z.cena("bi-file-earmark-spreadsheet", "quadro-projeto.xlsx", "Tarefas, responsáveis, prazos e estado.", "var(--success)") },
    ],
  },
  {
    id: "pwa", icone: "📱", titulo: "Aplicação instalável (PWA)", ferramentas: ["transversal"],
    desc: "Instale o GPI Track como uma app no computador ou telemóvel; páginas visitadas abrem mesmo sem internet.",
    passos: [
      { t: "Instale", d: "No Chrome/Edge escolha “Instalar aplicação”; no iPhone use “Adicionar ao ecrã principal”.", s: () => Z.cena("bi-download", "Instalar GPI Track", "Um clique e fica no seu ecrã principal.", "var(--cyan)") },
      { t: "Abra como app", d: "Abre em janela própria, sem barra do navegador.", s: () => Z.cena("bi-phone", "GPI Track", "Ícone no ecrã inicial, como qualquer app.", "var(--clickup-violet)") },
      { t: "Sem ligação", d: "As páginas já visitadas continuam a abrir offline. Os dados em tempo real voltam quando houver internet.", s: () => Z.cena("bi-wifi-off", "Modo offline", "Páginas guardadas continuam acessíveis.", "var(--warn)") },
    ],
  },
];

const TZ_FERRAMENTAS = {
  todas: "Todas", slack: "💬 Slack", asana: "✅ Asana", clickup: "📋 ClickUp", monday: "🟣 Monday.com", smartsheet: "📊 Smartsheet", transversal: "🧰 Transversais",
};
const TZ_NOMES = { slack: "Slack", asana: "Asana", clickup: "ClickUp", monday: "Monday.com", smartsheet: "Smartsheet", transversal: "Transversal" };

function tzRenderizarPagina() {
  const filtros = document.getElementById("tz-filtros");
  const grelha = document.getElementById("tz-grelha");
  if (!filtros || !grelha) return;
  let filtroAtual = "todas";

  const desenharCartoes = () => {
    grelha.innerHTML = TUTORIAIS.filter((f) => filtroAtual === "todas" || f.ferramentas.includes(filtroAtual)).map((f) => `
      <button type="button" class="lp-feature-card tz-card-func" data-id="${f.id}">
        <span class="icon">${f.icone}</span>
        <h3>${f.titulo}</h3>
        <p>${f.desc}</p>
        <div class="tz-rodape">
          <div class="inspired">${f.ferramentas.map((t) => `<b>${TZ_NOMES[t]}</b>`).join(" &amp; ")}</div>
          <span class="tz-ver"><i class="bi bi-play-circle-fill"></i> Ver tutorial · ${f.passos.length} passos</span>
        </div>
      </button>`).join("");
    grelha.querySelectorAll(".tz-card-func").forEach((el) => el.addEventListener("click", () => tzAbrir(el.dataset.id)));
  };

  filtros.innerHTML = Object.entries(TZ_FERRAMENTAS).map(([k, v]) => `<button type="button" class="tz-filtro ${k === "todas" ? "on" : ""}" data-f="${k}">${v}</button>`).join("");
  filtros.querySelectorAll(".tz-filtro").forEach((b) => b.addEventListener("click", () => {
    filtroAtual = b.dataset.f;
    filtros.querySelectorAll(".tz-filtro").forEach((x) => x.classList.toggle("on", x === b));
    desenharCartoes();
  }));
  desenharCartoes();

  const contador = document.getElementById("tz-total");
  if (contador) contador.textContent = TUTORIAIS.length;

  // Abre diretamente se vier com #tutorial-id
  const alvo = (location.hash || "").replace("#", "");
  if (alvo && TUTORIAIS.some((f) => f.id === alvo)) tzAbrir(alvo);
}

// ---------------- Modal do tutorial ----------------
let tzEstado = { f: null, i: 0, auto: true, timer: null };

function tzAbrir(id) {
  const f = TUTORIAIS.find((x) => x.id === id);
  if (!f) return;
  tzEstado = { f, i: 0, auto: true, timer: null };
  let ov = document.getElementById("tz-overlay");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "tz-overlay";
    ov.className = "tz-overlay";
    ov.innerHTML = `
      <div class="tz-modal" role="dialog" aria-modal="true" aria-labelledby="tz-titulo">
        <div class="tz-head">
          <span class="tz-head-ico" id="tz-ico"></span>
          <div class="tz-head-txt"><h3 id="tz-titulo"></h3><small id="tz-insp"></small></div>
          <button type="button" class="tz-x" id="tz-fechar" aria-label="Fechar"><i class="bi bi-x-lg"></i></button>
        </div>
        <div class="tz-stage" id="tz-stage"></div>
        <div class="tz-autobar"><i id="tz-autobar"></i></div>
        <div class="tz-info">
          <div class="tz-passo-n" id="tz-n"></div>
          <h4 id="tz-t"></h4>
          <p id="tz-d"></p>
        </div>
        <div class="tz-pontos" id="tz-pontos"></div>
        <div class="tz-nav">
          <button type="button" class="btn btn-ghost" id="tz-ant"><i class="bi bi-chevron-left"></i> Anterior</button>
          <button type="button" class="tz-play" id="tz-play" title="Pausar / continuar"><i class="bi bi-pause-fill"></i></button>
          <button type="button" class="btn btn-primary" id="tz-seg">Seguinte <i class="bi bi-chevron-right"></i></button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => { if (e.target === ov) tzFechar(); });
    document.getElementById("tz-fechar").addEventListener("click", tzFechar);
    document.getElementById("tz-ant").addEventListener("click", () => { tzEstado.auto = false; tzIr(tzEstado.i - 1); });
    document.getElementById("tz-seg").addEventListener("click", () => {
      tzEstado.auto = false;
      if (tzEstado.i >= tzEstado.f.passos.length - 1) { location.href = "/entrar.html?criar=1"; return; }
      tzIr(tzEstado.i + 1);
    });
    document.getElementById("tz-play").addEventListener("click", () => { tzEstado.auto = !tzEstado.auto; tzIr(tzEstado.i, true); });
    document.addEventListener("keydown", (e) => {
      if (!document.getElementById("tz-overlay")?.classList.contains("open")) return;
      if (e.key === "Escape") tzFechar();
      if (e.key === "ArrowRight") { tzEstado.auto = false; if (tzEstado.i < tzEstado.f.passos.length - 1) tzIr(tzEstado.i + 1); }
      if (e.key === "ArrowLeft") { tzEstado.auto = false; tzIr(tzEstado.i - 1); }
    });
  }
  document.getElementById("tz-ico").textContent = f.icone;
  document.getElementById("tz-titulo").textContent = f.titulo;
  document.getElementById("tz-insp").textContent = "Inspirado em " + f.ferramentas.map((t) => TZ_NOMES[t]).join(" e ");
  ov.classList.add("open");
  document.body.classList.add("tz-sem-scroll");
  history.replaceState(null, "", "#" + id);
  tzIr(0);
}

function tzFechar() {
  clearTimeout(tzEstado.timer);
  document.getElementById("tz-overlay")?.classList.remove("open");
  document.body.classList.remove("tz-sem-scroll");
  history.replaceState(null, "", location.pathname + location.search);
}

function tzIr(i, soAtualizarPlay) {
  const { f } = tzEstado;
  clearTimeout(tzEstado.timer);
  i = Math.max(0, Math.min(f.passos.length - 1, i));
  tzEstado.i = i;
  const p = f.passos[i];
  const ultimo = i === f.passos.length - 1;

  if (!soAtualizarPlay) {
    const st = document.getElementById("tz-stage");
    st.innerHTML = `<div class="tz-cena">${p.s()}</div>`;
    document.getElementById("tz-n").textContent = `Passo ${i + 1} de ${f.passos.length}`;
    document.getElementById("tz-t").textContent = p.t;
    document.getElementById("tz-d").textContent = p.d;
    document.getElementById("tz-pontos").innerHTML = f.passos.map((_, k) => `<button type="button" class="tz-ponto-nav ${k === i ? "on" : ""} ${k < i ? "feito" : ""}" data-k="${k}" aria-label="Passo ${k + 1}"></button>`).join("");
    document.querySelectorAll("#tz-pontos .tz-ponto-nav").forEach((b) => b.addEventListener("click", () => { tzEstado.auto = false; tzIr(Number(b.dataset.k)); }));
    document.getElementById("tz-ant").style.visibility = i === 0 ? "hidden" : "visible";
    document.getElementById("tz-seg").innerHTML = ultimo ? 'Experimentar agora <i class="bi bi-rocket-takeoff"></i>' : 'Seguinte <i class="bi bi-chevron-right"></i>';
  }
  document.getElementById("tz-play").innerHTML = `<i class="bi ${tzEstado.auto ? "bi-pause-fill" : "bi-play-fill"}"></i>`;

  const barra = document.getElementById("tz-autobar");
  barra.style.transition = "none";
  barra.style.width = "0%";
  if (tzEstado.auto && !ultimo) {
    void barra.offsetWidth;
    barra.style.transition = "width 5.5s linear";
    barra.style.width = "100%";
    tzEstado.timer = setTimeout(() => tzIr(tzEstado.i + 1), 5500);
  }
}
