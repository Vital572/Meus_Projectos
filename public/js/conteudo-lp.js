// Conteúdo das páginas públicas "Projetos" (exemplos) e "Serviços":
// listas + páginas de detalhe (exemplo.html?id=… e servico.html?id=…).

const LP_EXEMPLOS = [
  {
    id: "migracao-postgresql", tag: "Académico", cor: "var(--cyan)", fundo: "rgba(34,199,221,0.12)",
    titulo: "Migração para PostgreSQL local",
    resumo: "Equipa de 4 estudantes de Engenharia Informática a acompanhar a migração de uma base de dados em regime remoto.",
    progresso: 72, meta: "18 de 25 tarefas concluídas", avatares: [["VM", "#22C7DD"], ["AK", "#E67E22"], ["DM", "#8E7CC3"]],
    contexto: "Quatro estudantes tinham de migrar a base de dados de uma aplicação de gestão escolar para PostgreSQL, a trabalhar cada um em sua casa. O principal problema era saber, em cada momento, quem estava a fazer o quê e o que já tinha sido testado — a coordenação por mensagens soltas deixava tarefas esquecidas.",
    equipa: [["Responsável do projeto", "Coordena o plano, define as colunas do quadro e aprova convites."], ["Membros (3)", "Cada um fica com um conjunto de tabelas a migrar e valida o trabalho dos colegas."]],
    colunas: [["Por fazer", 4, "#8E7CC3"], ["Em curso", 3, "#22C7DD"], ["Em revisão", 2, "#F0B429"], ["Concluído", 16, "#34C77B"]],
    passos: [
      ["Criar o projeto e convidar a equipa", "O responsável criou o projeto no GPI Track e convidou os três colegas por email. Cada um aceitou o convite nas notificações e passou a ver o quadro."],
      ["Montar o quadro com as fases", "Foram criadas as colunas Por fazer, Em curso, Em revisão e Concluído. A coluna Concluído foi protegida: só o responsável arrasta cartões para lá, depois de rever o trabalho."],
      ["Uma tarefa por tabela", "Cada tabela a migrar passou a ser uma tarefa, com responsável, prazo e prioridade. Cada tarefa tem uma checklist: exportar, converter tipos, importar, validar contagens."],
      ["Dependências entre tarefas", "As tabelas com chaves estrangeiras só podiam começar depois das tabelas de que dependem — foi o uso de subtarefas e dependências que evitou migrações fora de ordem."],
      ["Acompanhamento diário", "A vista Lista e o Gantt mostravam o que estava atrasado. Os comentários com menções (@nome) substituíram as dúvidas por mensagem: a resposta fica registada na própria tarefa."],
      ["Reuniões curtas", "Duas reuniões semanais foram marcadas no próprio projeto; todos receberam a notificação e o lembrete."],
    ],
    funcionalidades: ["Quadro Kanban", "Colunas protegidas", "Checklists", "Subtarefas e dependências", "Comentários e menções", "Gantt e calendário", "Reuniões", "Notificações em tempo real"],
    resultados: ["Cada pessoa sabia, sem perguntar, o que lhe cabia e o que estava à espera de revisão.", "Nenhuma tabela passou a «Concluído» sem validação do responsável.", "O relatório de progresso (PDF) foi gerado diretamente do projeto para a entrega final."],
    licoes: "Definir desde o início quem pode concluir tarefas e usar checklists por tarefa foi o que mais reduziu o retrabalho.",
  },
  {
    id: "website-institucional", tag: "Empresarial", cor: "var(--warn)", fundo: "rgba(240,180,41,0.14)",
    titulo: "Lançamento de website institucional",
    resumo: "Equipa de marketing e desenvolvimento a coordenar prazos, aprovações e entregáveis à distância.",
    progresso: 45, meta: "9 de 20 tarefas concluídas", avatares: [["SF", "#34C77B"], ["NP", "#EF6461"]],
    contexto: "Uma pequena empresa precisava de lançar o novo website institucional numa data fixa. O conteúdo vinha do marketing, a implementação do desenvolvimento, e cada texto ou imagem precisava de aprovação antes de ser publicado. O desafio era que as duas áreas trabalhavam em horários e locais diferentes.",
    equipa: [["Responsáveis (2)", "A coordenadora de marketing e o líder técnico partilham a responsabilidade do projeto — o GPI Track permite vários responsáveis."], ["Membros", "Redatores, designers e programadores, cada um só com as tarefas que lhe dizem respeito."]],
    colunas: [["Ideias", 3, "#8E7CC3"], ["Em produção", 5, "#22C7DD"], ["Aguarda aprovação", 3, "#F0B429"], ["Publicado", 9, "#34C77B"]],
    passos: [
      ["Dois responsáveis, uma data", "O projeto foi criado com a data de lançamento como meta. Os dois responsáveis dividiram a aprovação: marketing aprova conteúdo, tecnologia aprova código."],
      ["Quadro com etapa de aprovação", "A coluna «Aguarda aprovação» foi definida como restrita — só os responsáveis movem cartões para «Publicado». Os restantes membros enviam para aprovação."],
      ["Campos personalizados", "Foram acrescentados campos como «Página do site» e «Tipo de entregável», o que permitiu agrupar o quadro por página e ver o que faltava em cada uma."],
      ["Anexos e comentários", "Textos, logótipos e protótipos foram anexados às tarefas. As alterações pedidas ficaram nos comentários, com menção de quem devia corrigir."],
      ["Automação para não esquecer", "Uma regra automática atribui a tarefa ao revisor quando o cartão entra em «Aguarda aprovação», e avisa-o com uma notificação."],
      ["Relatório para a direção", "A direção recebeu o relatório exportado em Excel com o estado de cada entregável."],
    ],
    funcionalidades: ["Vários responsáveis", "Colunas restritas", "Campos personalizados", "Agrupar o quadro", "Anexos", "Automações", "Relatórios e gráficos", "Exportar para PDF ou Excel"],
    resultados: ["O fluxo de aprovação deixou de depender de emails: está tudo no cartão.", "A direção via o progresso real sem pedir reuniões de ponto de situação.", "Metas com data ajudaram a detetar cedo o que ameaçava o lançamento."],
    licoes: "Uma coluna de aprovação restrita e uma automação simples bastaram para tornar o fluxo previsível.",
  },
  {
    id: "estudo-comparativo-tcc", tag: "Investigação", cor: "var(--success)", fundo: "rgba(52,199,123,0.14)",
    titulo: "Estudo comparativo de ferramentas de gestão",
    resumo: "O próprio trabalho de conclusão de curso, com checklist de capítulos, anexos e cronograma partilhado.",
    progresso: 60, meta: "Set. 2026 · em curso", avatares: [["VM", "#0EA5B7"], ["SF", "#E67E22"]],
    contexto: "O trabalho de conclusão de curso «Estudo comparativo de ferramentas para gestão e acompanhamento de projetos em equipa em tempo real em ambientes Home Office» foi também o primeiro projeto a ser acompanhado com o GPI Track: os dois autores trabalhavam em locais diferentes e precisavam de um cronograma partilhado.",
    equipa: [["Responsável do projeto", "Um dos autores organiza o quadro e fecha cada capítulo."], ["Membro", "O outro autor assume capítulos, revê e comenta o texto do colega."]],
    colunas: [["Por escrever", 5, "#8E7CC3"], ["A escrever", 2, "#22C7DD"], ["Em revisão", 2, "#F0B429"], ["Fechado", 6, "#34C77B"]],
    passos: [
      ["Cada capítulo é uma tarefa", "Introdução, revisão da literatura, metodologia, comparação das ferramentas, protótipo e conclusões ficaram como tarefas, com prazo e responsável."],
      ["Checklists por capítulo", "Dentro de cada capítulo, uma checklist com secções, figuras, tabelas e referências. O progresso aparece como percentagem no cartão."],
      ["Metas e cronograma", "As metas do projeto (entrega do relatório, ensaio da defesa) aparecem no calendário e no Gantt, partilhados pelos dois autores."],
      ["Anexos e versões", "Rascunhos, artigos de referência e imagens ficam anexados à tarefa do capítulo correspondente, em vez de perdidos em conversas."],
      ["Registo de tempo", "O cronómetro das tarefas mostrou quanto tempo cada capítulo realmente consumiu — útil para planear o que faltava."],
      ["O protótipo como prova", "O próprio GPI Track foi sendo ajustado ao longo do trabalho, e os testes com o protótipo alimentaram o capítulo de resultados."],
    ],
    funcionalidades: ["Quadro Kanban", "Checklists com progresso", "Metas do projeto", "Calendário e Gantt", "Anexos", "Registo de tempo", "Conversa geral da equipa", "Aplicação instalável (PWA)"],
    resultados: ["Os dois autores viam sempre o mesmo estado do trabalho, mesmo à distância.", "Os prazos intermédios deixaram de ser surpresa graças ao calendário partilhado.", "O protótipo ficou validado em utilização real."],
    licoes: "Usar a ferramenta no próprio trabalho de investigação deu feedback imediato sobre o que realmente faz falta a uma equipa pequena.",
  },
];

const LP_SERVICOS = [
  {
    id: "gestao", icone: "🗂️", titulo: "Gestão de projetos e tarefas",
    resumo: "Organize equipas, projetos, colunas e tarefas com permissões claras — inclusive vários responsáveis por projeto.",
    intro: "É o coração da plataforma: cada projeto tem um quadro Kanban em que as tarefas avançam por colunas que a própria equipa define. Há ainda as vistas Lista, Calendário, Gantt e Metas sobre os mesmos dados.",
    passos: [
      ["Crie o projeto", "Em «Os meus projetos» clique em «Novo projeto», dê-lhe um nome e uma descrição. Quem cria fica como responsável."],
      ["Defina as colunas", "O responsável cria e edita colunas (por exemplo Por fazer, Em curso, Concluído), pode protegê-las e até definir que uma coluna inicia o registo de tempo."],
      ["Crie tarefas", "Cada tarefa tem título, descrição, responsável, prazo, prioridade, etiquetas, checklist, subtarefas e anexos."],
      ["Arraste entre colunas", "Quem tem permissão arrasta a tarefa; todos os membros veem o movimento no mesmo instante."],
      ["Escolha a vista", "Alterne entre Quadro, Lista, Calendário, Gantt e Metas conforme precisar."],
    ],
    permissoes: "Os responsáveis do projeto e os administradores criam tarefas, colunas e metas. Os membros trabalham nas tarefas que lhes são atribuídas e movem-nas nas colunas permitidas.",
    relacionadas: ["Quadro Kanban em tempo real", "Lista, Calendário e Gantt", "Checklists", "Subtarefas e dependências", "Metas do projeto"],
  },
  {
    id: "comunicacao", icone: "💬", titulo: "Comunicação em equipa",
    resumo: "Comentários, menções, conversa geral do projeto e anúncios sincronizados em tempo real.",
    intro: "A conversa fica junto do trabalho: em vez de mensagens espalhadas, cada tarefa tem os seus comentários e cada projeto tem uma conversa geral.",
    passos: [
      ["Comente na tarefa", "Abra uma tarefa e escreva um comentário. Os restantes membros veem-no ao vivo, sem recarregar a página."],
      ["Mencione colegas", "Escreva @ e o nome de um membro: ele recebe uma notificação que o leva diretamente à tarefa."],
      ["Use a conversa geral", "Na vista Conversa, a equipa troca mensagens sobre o projeto como um todo."],
      ["Anúncios", "A administração pode publicar anúncios que chegam a todos como notificação."],
    ],
    permissoes: "Todos os membros do projeto podem comentar e usar a conversa. Os anúncios são enviados pelos administradores.",
    relacionadas: ["Comentários e menções ao vivo", "Conversa geral da equipa", "Anúncios da administração", "Notificações em tempo real"],
  },
  {
    id: "acompanhamento", icone: "📈", titulo: "Acompanhamento & relatórios",
    resumo: "Dashboards com gráficos e relatórios exportáveis para acompanhar o progresso de cada equipa.",
    intro: "Para saber como vai o trabalho sem perguntar a ninguém: indicadores, gráficos e relatórios por projeto, equipa e pessoa.",
    passos: [
      ["Veja os indicadores", "Em «Os meus projetos» há totais de projetos, tarefas, concluídas e em atraso."],
      ["Abra o Espaço de gestão", "Os responsáveis têm um espaço com gráficos de progresso, carga de trabalho e tarefas por estado."],
      ["Acompanhe o prazo", "O Gantt e o calendário mostram o que está atrasado ou a chegar ao prazo."],
      ["Exporte", "Gere o relatório em PDF ou Excel para entregar a um professor, cliente ou direção."],
    ],
    permissoes: "O Espaço de gestão e os relatórios completos são exclusivos dos responsáveis do projeto e dos administradores.",
    relacionadas: ["Relatórios e gráficos", "Exportar para PDF ou Excel", "«Minha semana»", "Metas do projeto"],
  },
  {
    id: "seguranca", icone: "🔐", titulo: "Administração & segurança",
    resumo: "Autenticação JWT, permissões por papel, colunas restritas, e controlo total de utilizadores.",
    intro: "Cada pessoa vê e faz apenas o que o seu papel permite, e a administração tem controlo sobre contas e projetos.",
    passos: [
      ["Entrada segura", "A autenticação usa tokens JWT e as palavras-passe são guardadas com hash. Há ainda autenticação de dois fatores opcional."],
      ["Papéis claros", "Administrador da plataforma; por projeto, responsável ou membro. O servidor valida cada ação — esconder um botão não basta."],
      ["Colunas e tarefas restritas", "Colunas protegidas e tarefas visíveis só aos responsáveis mantêm o trabalho sensível controlado."],
      ["Painel de administração", "Os administradores gerem utilizadores, ativam/desativam contas, publicam anúncios e consultam o histórico."],
    ],
    permissoes: "Painel de administração: apenas administradores. Espaço de gestão de um projeto: responsáveis e administradores. Membros não conseguem aceder, mesmo que abram o endereço diretamente.",
    relacionadas: ["Autenticação de dois fatores", "Colunas e responsáveis configuráveis", "Anúncios da administração"],
  },
  {
    id: "tempo-real", icone: "⚡", titulo: "Colaboração em tempo real",
    resumo: "O que um membro faz aparece de imediato para toda a equipa, e vê-se quem está online.",
    intro: "Usa WebSockets (Socket.IO): em vez de recarregar a página, as alterações chegam sozinhas a todos os que estão no projeto.",
    passos: [
      ["Alterações instantâneas", "Mover uma tarefa, criar uma coluna, comentar ou mudar um responsável atualiza o ecrã dos outros membros imediatamente."],
      ["Presença da equipa", "Um ponto verde indica quem está online agora; a lista de membros mostra também quem esteve online há pouco."],
      ["Notificações ao vivo", "Atribuições, menções, convites e reuniões chegam ao sino 🔔 no momento em que acontecem."],
      ["Em qualquer aparelho", "A aplicação adapta-se ao telemóvel e pode ser instalada como PWA."],
    ],
    permissoes: "Cada pessoa só recebe atualizações dos projetos de que faz parte.",
    relacionadas: ["Presença da equipa", "Notificações em tempo real", "Aplicação instalável (PWA)"],
  },
  {
    id: "reunioes", icone: "🗓️", titulo: "Reuniões e calendário",
    resumo: "Marque reuniões no projeto e todos os membros são avisados.",
    intro: "As reuniões ficam ligadas ao projeto, com data, hora e ligação, e aparecem no calendário.",
    passos: [
      ["Marque a reunião", "O responsável abre «Reuniões» e define título, data, hora e, se houver, a ligação da chamada."],
      ["Aviso a todos", "Os membros recebem uma notificação e, ao clicar, abrem a lista de reuniões do projeto."],
      ["Consulte quando quiser", "Qualquer membro vê as próximas reuniões; o responsável pode alterá-las ou cancelá-las."],
    ],
    permissoes: "Marcar e cancelar reuniões: responsáveis e administradores. Consultar: todos os membros.",
    relacionadas: ["Lista, Calendário e Gantt", "Notificações em tempo real"],
  },
  {
    id: "automacao-tempo", icone: "⏱️", titulo: "Automações e registo de tempo",
    resumo: "Regras que trabalham por si e um cronómetro que mostra quanto tempo cada tarefa consome.",
    intro: "Duas ajudas para poupar trabalho manual: regras «quando … então …» e o registo de tempo por tarefa.",
    passos: [
      ["Crie uma regra", "No quadro, em Automações, escolha o gatilho (ex.: a tarefa entra em «Em revisão») e a ação (ex.: atribuir ao revisor, notificar, iniciar o registo de tempo)."],
      ["Defina colunas que contam tempo", "Ao criar ou editar uma coluna pode ativar «Iniciar o registo de tempo quando uma tarefa entrar nesta coluna»."],
      ["Acompanhe o cronómetro", "O relógio corre em tempo real; pode iniciar, parar ou reiniciar. Em colunas concluídas ou protegidas o tempo não conta."],
      ["Reveja o total", "O tempo acumulado fica na tarefa e ajuda a planear trabalhos futuros."],
    ],
    permissoes: "Regras e colunas com contagem: responsáveis e administradores. O cronómetro corre para quem tem a tarefa atribuída.",
    relacionadas: ["Automações simples", "Registo de tempo", "Colunas e responsáveis configuráveis"],
  },
  {
    id: "equipas-convites", icone: "✉️", titulo: "Equipas e convites",
    resumo: "Convide pessoas para o projeto, aprove pedidos e gira quem faz parte da equipa.",
    intro: "Entrar num projeto é por convite, e há um passo de aprovação quando quem convida não é responsável.",
    passos: [
      ["Convide", "Em «Convidar membros» procure pessoas e selecione várias de uma só vez."],
      ["Aprovação", "Se o convite for proposto por um membro comum, os responsáveis recebem um pedido para aprovar ou rejeitar."],
      ["Responda nas notificações", "Quem é convidado vê o convite no sino 🔔, com os botões Aceitar, Rejeitar e Ver convite."],
      ["Perfil da equipa", "Cada membro tem um perfil com email, nível na equipa, tarefas atribuídas e última vez online; o responsável pode removê-lo do projeto ou torná-lo responsável."],
    ],
    permissoes: "Qualquer membro pode propor convites; só responsáveis e administradores aprovam, removem membros e atribuem responsabilidade.",
    relacionadas: ["Convites e equipas", "Presença da equipa"],
  },
];

const lpEsc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function lpRenderizarListaExemplos(el) {
  el.innerHTML = LP_EXEMPLOS.map((e) => `
    <a class="lp-showcase-card lp-link-card" href="/exemplo.html?id=${e.id}">
      <span class="tag" style="background:${e.fundo};color:${e.cor}">${e.tag}</span>
      <h3>${e.titulo}</h3>
      <p>${e.resumo}</p>
      <div class="lp-showcase-progress"><div style="width:${e.progresso}%"></div></div>
      <div class="lp-showcase-meta">
        <span>${e.meta}</span>
        <div class="lp-avatars">${e.avatares.map(([i, c]) => `<span style="background:${c}">${i}</span>`).join("")}</div>
      </div>
      <span class="lp-ver-mais">Ver como foi feito <i class="bi bi-arrow-right"></i></span>
    </a>`).join("");
}

function lpRenderizarListaServicos(el) {
  el.innerHTML = LP_SERVICOS.map((s) => `
    <a class="lp-service-card lp-link-card" href="/servico.html?id=${s.id}">
      <span class="icon">${s.icone}</span>
      <h3>${s.titulo}</h3>
      <p>${s.resumo}</p>
      <span class="lp-ver-mais">Ver como funciona <i class="bi bi-arrow-right"></i></span>
    </a>`).join("");
}

function lpRenderizarExemplo(el) {
  const id = new URLSearchParams(location.search).get("id");
  const e = LP_EXEMPLOS.find((x) => x.id === id);
  if (!e) { el.innerHTML = `<div class="lp-detalhe-vazio"><h2>Exemplo não encontrado</h2><p><a href="/exemplos.html">Ver todos os projetos</a></p></div>`; return; }
  document.title = `${e.titulo} — GPI Track`;
  const total = e.colunas.reduce((n, c) => n + c[1], 0);
  el.innerHTML = `
    <div class="lp-detalhe-topo">
      <span class="tag" style="background:${e.fundo};color:${e.cor}">${e.tag}</span>
      <h1>${e.titulo}</h1>
      <p>${e.resumo}</p>
      <small class="lp-nota">Caso ilustrativo do tipo de trabalho que o GPI Track ajuda a acompanhar.</small>
    </div>
    <div class="lp-detalhe-bloco"><h2>O ponto de partida</h2><p>${e.contexto}</p></div>
    <div class="lp-detalhe-bloco"><h2>A equipa</h2>
      <div class="lp-detalhe-lista">${e.equipa.map(([a, b]) => `<div><b>${a}</b><span>${b}</span></div>`).join("")}</div></div>
    <div class="lp-detalhe-bloco"><h2>O quadro do projeto</h2>
      <p>Assim ficou o quadro no GPI Track (${total} tarefas no total):</p>
      <div class="lp-mini-quadro">${e.colunas.map(([n, q, c]) => `
        <div class="lp-mini-col" style="border-top-color:${c}"><b>${n}</b><span>${q}</span>
          <div class="lp-mini-cartoes">${"<i></i>".repeat(Math.min(q, 4))}</div></div>`).join("")}</div></div>
    <div class="lp-detalhe-bloco"><h2>Como foi feito, passo a passo</h2>
      <ol class="lp-passos">${e.passos.map(([t, d]) => `<li><b>${t}</b><span>${d}</span></li>`).join("")}</ol></div>
    <div class="lp-detalhe-bloco"><h2>Funcionalidades usadas</h2>
      <div class="lp-chips">${e.funcionalidades.map((f) => `<span>${f}</span>`).join("")}</div>
      <p style="margin-top:12px"><a href="/funcionalidades.html">Ver os tutoriais animados de cada funcionalidade →</a></p></div>
    <div class="lp-detalhe-bloco"><h2>O que a equipa ganhou</h2>
      <ul class="lp-resultados">${e.resultados.map((r) => `<li>${r}</li>`).join("")}</ul>
      <p class="lp-licao"><b>Lição principal:</b> ${e.licoes}</p></div>
    <div class="lp-detalhe-nav">
      ${LP_EXEMPLOS.filter((x) => x.id !== e.id).map((x) => `<a href="/exemplo.html?id=${x.id}">${x.titulo} <i class="bi bi-arrow-right"></i></a>`).join("")}
    </div>`;
}

function lpRenderizarServico(el) {
  const id = new URLSearchParams(location.search).get("id");
  const s = LP_SERVICOS.find((x) => x.id === id);
  if (!s) { el.innerHTML = `<div class="lp-detalhe-vazio"><h2>Serviço não encontrado</h2><p><a href="/servicos.html">Ver todos os serviços</a></p></div>`; return; }
  document.title = `${s.titulo} — GPI Track`;
  el.innerHTML = `
    <div class="lp-detalhe-topo">
      <span class="lp-detalhe-icone">${s.icone}</span>
      <h1>${s.titulo}</h1>
      <p>${s.resumo}</p>
    </div>
    <div class="lp-detalhe-bloco"><h2>O que é</h2><p>${s.intro}</p></div>
    <div class="lp-detalhe-bloco"><h2>Como funciona</h2>
      <ol class="lp-passos">${s.passos.map(([t, d]) => `<li><b>${t}</b><span>${d}</span></li>`).join("")}</ol></div>
    <div class="lp-detalhe-bloco"><h2>Quem pode fazer o quê</h2><p>${s.permissoes}</p></div>
    <div class="lp-detalhe-bloco"><h2>Funcionalidades relacionadas</h2>
      <div class="lp-chips">${s.relacionadas.map((f) => `<span>${f}</span>`).join("")}</div>
      <p style="margin-top:12px"><a href="/funcionalidades.html">Ver os tutoriais animados →</a></p></div>
    <div class="lp-detalhe-nav">
      ${LP_SERVICOS.filter((x) => x.id !== s.id).slice(0, 3).map((x) => `<a href="/servico.html?id=${x.id}">${x.icone} ${x.titulo} <i class="bi bi-arrow-right"></i></a>`).join("")}
    </div>`;
}
