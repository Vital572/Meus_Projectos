const rotulosNotificacao = {
  "task.assigned": "📌",
  "comment.new": "💬",
  "mention": "📣",
  "project.invited": "👥",
  "project.invite": "✉️",
  "project.invite_approval_request": "🙋",
  "project.invite_approved": "✅",
  "project.invite_rejected": "❌",
  "project.invite_accepted": "🎉",
  "project.invite_declined": "🚫",
  "project.left": "🚪",
  "admin.announcement": "📢",
  "task.file_sent": "📎",
  "meeting.scheduled": "🗓️",
  "meeting.cancelled": "🚫",
  "project.made_responsible": "👑",
  "automation.triggered": "⚡",
  "task.due_tomorrow": "⏰",
  "task.due_today": "🚨",
  "task.made_responsible": "👑",
};

function montarSino() {
  const wrap = document.createElement("div");
  wrap.style.position = "relative";
  wrap.innerHTML = `
    <div id="botao-sino" style="cursor:pointer;position:relative;display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;background:var(--navy-900);border:1px solid var(--border)">
      🔔
      <span id="badge-sino" style="display:none;position:absolute;top:-5px;right:-5px;background:var(--danger);color:#fff;font-size:10px;font-weight:700;border-radius:20px;padding:1px 5px;min-width:16px;text-align:center">0</span>
    </div>
    <div id="painel-notificacoes" style="display:none;position:absolute;top:42px;right:0;width:320px;max-height:380px;overflow-y:auto;background:var(--navy-800);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow);z-index:60;padding:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px 10px">
        <strong style="font-size:13px">Notificações</strong>
        <span style="font-size:11.5px;color:var(--cyan);cursor:pointer" id="marcar-todas-lidas">Marcar todas como lidas</span>
      </div>
      <div id="lista-notificacoes"></div>
    </div>
  `;
  return wrap;
}

async function carregarNotificacoes() {
  const notificacoes = await api.get("/api/notifications");
  renderizarNotificacoes(notificacoes);
  atualizarBadge(notificacoes.filter((n) => !n.is_read).length);
}

function renderizarNotificacoes(lista) {
  const container = document.getElementById("lista-notificacoes");
  if (!container) return;
  if (lista.length === 0) {
    container.innerHTML = `<div style="padding:20px;text-align:center;color:var(--ink-faint);font-size:13px">Sem notificações por agora.</div>`;
    return;
  }
  container.innerHTML = lista.map((n) => `
    <div class="notif-item" data-id="${n.id}" data-type="${n.type}" data-project-id="${n.project_id || ""}" data-task-id="${n.task_id || ""}"
         style="display:flex;gap:10px;padding:10px 8px;border-radius:8px;cursor:pointer;${n.is_read ? "" : "background:rgba(34,199,221,0.06)"}">
      <div style="font-size:16px">${rotulosNotificacao[n.type] || "🔔"}</div>
      <div style="flex:1">
        <div style="font-size:12.5px;line-height:1.4">${n.content}</div>
        <div style="font-size:10.5px;color:var(--ink-faint);margin-top:3px">${new Date(n.created_at).toLocaleString("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
      </div>
      ${n.project_id ? `<div style="font-size:14px;color:var(--ink-faint);align-self:center">→</div>` : ""}
    </div>
  `).join("");

  container.querySelectorAll(".notif-item").forEach((el) => {
    el.addEventListener("click", async () => {
      await api.patch(`/api/notifications/${el.dataset.id}/lida`, {});

      // Leva ao sítio exato relacionado com a notificação: a tarefa (se houver),
      // a aba de reuniões do Espaço de Gestão (se for sobre uma reunião),
      // senão o quadro do projeto — em vez de só marcar como lida e ficar parado.
      const tipo = el.dataset.type;
      const projetoId = el.dataset.projectId;
      const tarefaId = el.dataset.taskId;
      if (projetoId) {
        let destino;
        if (tipo === "project.invite" || tipo === "project.invite_approval_request") {
          destino = `/projetos.html`;
        } else if (tipo === "meeting.scheduled" || tipo === "meeting.cancelled") {
          destino = `/workspace.html?projeto=${projetoId}&aba=reunioes`;
        } else if (tarefaId) {
          destino = `/board.html?projeto=${projetoId}&tarefa=${tarefaId}`;
        } else {
          destino = `/board.html?projeto=${projetoId}`;
        }
        window.location.href = destino;
        return;
      }

      el.style.background = "transparent";
      const restantes = document.querySelectorAll("#lista-notificacoes .notif-item[style*='rgba(34']").length;
      atualizarBadge(restantes);
    });
  });
}

function atualizarBadge(n) {
  const badge = document.getElementById("badge-sino");
  if (!badge) return;
  badge.textContent = n > 9 ? "9+" : n;
  badge.style.display = n > 0 ? "block" : "none";
}

function iniciarNotificacoes(socket) {
  const sinoContainer = document.getElementById("ancora-sino");
  if (sinoContainer) sinoContainer.appendChild(montarSino());

  document.getElementById("botao-sino")?.addEventListener("click", () => {
    const painel = document.getElementById("painel-notificacoes");
    painel.style.display = painel.style.display === "none" ? "block" : "none";
  });

  document.getElementById("marcar-todas-lidas")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    await api.patch("/api/notifications/lidas", {});
    document.querySelectorAll(".notif-item").forEach((el) => (el.style.background = "transparent"));
    atualizarBadge(0);
  });

  document.addEventListener("click", (e) => {
    const painel = document.getElementById("painel-notificacoes");
    const sino = document.getElementById("botao-sino");
    if (painel && !painel.contains(e.target) && e.target !== sino && !sino?.contains(e.target)) {
      painel.style.display = "none";
    }
  });

  carregarNotificacoes();

  socket.on("notification:new", (n) => {
    mostrarToast(n.content);
    const lista = document.getElementById("lista-notificacoes");
    if (lista) carregarNotificacoes();
  });

  // Se um administrador desativar/eliminar a conta, a sessão é terminada de imediato
  socket.on("conta:desativada", ({ motivo }) => {
    alert(motivo || "A sua conta foi desativada.");
    api.post("/api/auth/logout").finally(() => (window.location.href = "/entrar.html"));
  });
}
