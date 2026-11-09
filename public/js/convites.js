/**
 * Listas de convites com seleção múltipla.
 *  - Convites.listaRecebidos(el, convites, aoMudar): convites que EU recebi (aceitar / recusar)
 *  - Convites.listaAprovar(el, pedidos, aoMudar): pedidos de convite que EU posso aprovar (aprovar / rejeitar)
 * Cada item tem uma caixa de seleção; "Selecionar todos" + ações em lote sobre os marcados.
 */
(function () {
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function montar(el, itens, cfg, aoMudar) {
    if (!itens.length) { el.innerHTML = cfg.vazio ? `<div class="sub" style="padding:8px 0">${cfg.vazio}</div>` : ""; return; }
    el.innerHTML = `
      <div class="cvt-barra">
        <label class="cvt-todos"><input type="checkbox" class="cvt-todos-cb" /> <span>Selecionar todos</span></label>
        <span class="cvt-contagem">Nenhum selecionado</span>
        <div class="cvt-acoes">
          <button type="button" class="btn btn-primary cvt-ok" disabled>${cfg.sim}</button>
          <button type="button" class="btn btn-ghost cvt-nao" disabled>${cfg.nao}</button>
        </div>
      </div>
      <div class="cvt-lista">
        ${itens.map((i, n) => `
          <label class="cvt-item" data-n="${n}">
            <input type="checkbox" class="cvt-cb" />
            <div style="min-width:0;flex:1">${cfg.corpo(i)}</div>
            <span class="cvt-um">
              <button type="button" class="mini-btn cvt-um-ok" title="${cfg.sim}">✔</button>
              <button type="button" class="mini-btn cvt-um-nao" title="${cfg.nao}">✕</button>
            </span>
          </label>`).join("")}
      </div>`;

    const cbs = [...el.querySelectorAll(".cvt-cb")];
    const todos = el.querySelector(".cvt-todos-cb");
    const marcados = () => cbs.map((cb, n) => (cb.checked ? itens[n] : null)).filter(Boolean);
    const atualizar = () => {
      const m = marcados().length;
      el.querySelector(".cvt-contagem").textContent = m === 0 ? "Nenhum selecionado" : m === 1 ? "1 selecionado" : `${m} selecionados`;
      el.querySelector(".cvt-ok").disabled = el.querySelector(".cvt-nao").disabled = m === 0;
      todos.checked = m === cbs.length; todos.indeterminate = m > 0 && m < cbs.length;
      cbs.forEach((cb) => cb.closest(".cvt-item").classList.toggle("sel", cb.checked));
    };
    cbs.forEach((cb) => cb.addEventListener("change", atualizar));
    todos.addEventListener("change", () => { cbs.forEach((cb) => (cb.checked = todos.checked)); atualizar(); });

    async function executar(lista, sim) {
      el.querySelectorAll("button").forEach((b) => (b.disabled = true));
      let feitos = 0; const falhas = [];
      for (const i of lista) {
        try { await cfg.acao(i, sim); feitos++; } catch (err) { falhas.push(err.message); }
      }
      if (feitos) mostrarToast(cfg.msg(feitos, sim));
      if (falhas.length) mostrarToast(falhas[0]);
      await aoMudar();
    }
    el.querySelector(".cvt-ok").addEventListener("click", () => executar(marcados(), true));
    el.querySelector(".cvt-nao").addEventListener("click", () => executar(marcados(), false));
    el.querySelectorAll(".cvt-item").forEach((li) => {
      const i = itens[Number(li.dataset.n)];
      li.querySelector(".cvt-um-ok").addEventListener("click", (e) => { e.preventDefault(); executar([i], true); });
      li.querySelector(".cvt-um-nao").addEventListener("click", (e) => { e.preventDefault(); executar([i], false); });
    });
    atualizar();
  }

  window.Convites = {
    listaRecebidos(el, convites, aoMudar, vazio) {
      montar(el, convites, {
        vazio, sim: "Aceitar selecionados", nao: "Recusar selecionados",
        corpo: (c) => `<div class="cvt-titulo">✉️ ${esc(c.projeto_nome)}</div>
          <div class="cvt-sub">${esc(c.descricao || "Sem descrição.")}</div>
          <div class="cvt-sub">Equipa: ${esc(c.equipa_nome || "—")} · ${c.total_membros} membro${c.total_membros === 1 ? "" : "s"} · ${c.total_tarefas} tarefa${c.total_tarefas === 1 ? "" : "s"} · convidado(a) por ${esc(c.convidado_por || "—")}</div>`,
        acao: (c, sim) => api.post(`/api/projects/${c.projeto_id}/convite/${sim ? "aceitar" : "recusar"}`),
        msg: (n, sim) => sim ? (n === 1 ? "Convite aceite! Já faz parte do projeto." : `${n} convites aceites.`) : (n === 1 ? "Convite recusado." : `${n} convites recusados.`),
      }, aoMudar);
    },
    listaAprovar(el, pedidos, aoMudar, vazio) {
      montar(el, pedidos, {
        vazio, sim: "Aprovar selecionados", nao: "Rejeitar selecionados",
        corpo: (p) => `<div class="cvt-titulo">🙋 ${esc(p.utilizador_nome)}</div>
          <div class="cvt-sub">${esc(p.utilizador_email)}</div>
          <div class="cvt-sub">Proposto por ${esc(p.proposto_por || "—")} para o projeto "${esc(p.projeto_nome)}"</div>`,
        acao: (p, sim) => api.post(`/api/projects/${p.projeto_id}/membros/${p.utilizador_id}/aprovar-convite`, { aprovar: sim }),
        msg: (n, sim) => sim ? (n === 1 ? "Convite aprovado e enviado ao convidado." : `${n} convites aprovados e enviados.`) : (n === 1 ? "Pedido de convite rejeitado." : `${n} pedidos rejeitados.`),
      }, aoMudar);
    },
  };
})();
