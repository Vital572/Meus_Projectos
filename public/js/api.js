/**
 * Sessão por separador do navegador (sessionStorage), e não por cookie
 * partilhado. Isto permite que várias contas fiquem ligadas em
 * simultâneo em separadores diferentes do mesmo browser — cada
 * separador guarda o seu próprio token, isolado dos restantes.
 */
const sessao = {
  obterToken() { return sessionStorage.getItem("gpitrack_token"); },
  guardarToken(token) { sessionStorage.setItem("gpitrack_token", token); },
  limpar() { sessionStorage.removeItem("gpitrack_token"); },
};

const api = {
  async _req(method, url, body) {
    const headers = { "Content-Type": "application/json" };
    const token = sessao.obterToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(url, {
      method,
      headers,
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const erro = new Error(data.erro || "Erro no pedido.");
      erro.status = res.status;
      throw erro;
    }
    return data;
  },
  get(url) { return this._req("GET", url); },
  post(url, body) { return this._req("POST", url, body); },
  put(url, body) { return this._req("PUT", url, body); },
  patch(url, body) { return this._req("PATCH", url, body); },
  del(url) { return this._req("DELETE", url); },
  async upload(url, formData) {
    const headers = {};
    const token = sessao.obterToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(url, { method: "POST", headers, credentials: "include", body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const erro = new Error(data.erro || "Erro no pedido.");
      erro.status = res.status;
      throw erro;
    }
    return data;
  },
};

// Mantido por compatibilidade (já não é a fonte principal do token,
// que agora vem de sessionStorage através de sessao.obterToken()).
function getCookie(name) {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? match[2] : null;
}

function iniciais(nome) {
  return nome.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function formatarData(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-PT", { day: "2-digit", month: "short" });
}

function formatarTamanhoFicheiro(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mostrarToast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// Liga uma caixa de pesquisa a um contentor: esconde os filhos diretos cujo
// texto não contenha o termo pesquisado. Reutilizado em várias listas do
// Espaço de Gestão e da Administração (exceto Relatórios).
function ligarPesquisaLista(inputId, containerId) {
  const input = document.getElementById(inputId);
  const container = document.getElementById(containerId);
  if (!input || !container) return;
  input.addEventListener("input", () => {
    const termo = input.value.trim().toLowerCase();
    [...container.children].forEach((el) => {
      const corresponde = !termo || el.textContent.toLowerCase().includes(termo);
      el.style.display = corresponde ? "" : "none";
    });
  });
}
