// Avaliação da força de uma password. Este MESMO ficheiro corre no navegador
// (barra de progressão) e no servidor (validação no registo e na redefinição),
// para que as duas regras nunca fiquem diferentes.
(function (raiz) {
  const COMUNS = ["123456", "12345678", "123456789", "password", "qwerty", "abc123", "111111", "123123", "admin", "senha", "senha123", "password1", "iloveyou", "angola"];

  const NIVEIS = [
    { rotulo: "Escreva uma password", cor: "#5E6A8A" },
    { rotulo: "Muito fraca", cor: "#EF6461" },
    { rotulo: "Fraca", cor: "#F0883E" },
    { rotulo: "Razoável", cor: "#F0B429" },
    { rotulo: "Forte", cor: "#8BC34A" },
    { rotulo: "Muito forte", cor: "#34C77B" },
  ];

  // Nível mínimo aceite ao criar conta / redefinir password (3 = "Razoável").
  const NIVEL_MINIMO = 3;
  const TAMANHO_MINIMO = 8;

  function avaliarSenha(senha) {
    senha = senha || "";
    const requisitos = {
      tamanho: senha.length >= TAMANHO_MINIMO,
      longa: senha.length >= 12,
      maiusculaMinuscula: /[a-z]/.test(senha) && /[A-Z]/.test(senha),
      numero: /\d/.test(senha),
      simbolo: /[^A-Za-z0-9]/.test(senha),
    };

    let nivel = 0;
    if (senha.length > 0) {
      let pontos = 0;
      if (requisitos.tamanho) pontos++;
      if (requisitos.longa) pontos++;
      if (requisitos.maiusculaMinuscula) pontos++;
      if (requisitos.numero) pontos++;
      if (requisitos.simbolo) pontos++;

      // Penalizações: password muito comum ou com muitos caracteres repetidos.
      const comum = COMUNS.includes(senha.toLowerCase());
      const repetida = new Set(senha).size <= Math.max(2, Math.floor(senha.length / 4));
      if (comum || repetida) pontos = Math.min(pontos, 1);
      // Abaixo do tamanho mínimo nunca passa de "Fraca".
      if (!requisitos.tamanho) pontos = Math.min(pontos, 2);

      nivel = Math.max(1, Math.min(5, pontos));
    }

    return {
      nivel,
      percentagem: nivel * 20,
      rotulo: NIVEIS[nivel].rotulo,
      cor: NIVEIS[nivel].cor,
      requisitos,
      aceite: nivel >= NIVEL_MINIMO && requisitos.tamanho,
    };
  }

  // ---------- Parte do navegador: liga um input a uma barra de progressão ----------
  function ligarMedidorSenha(inputId, medidorId, aoMudar) {
    const input = document.getElementById(inputId);
    const medidor = document.getElementById(medidorId);
    if (!input || !medidor) return;
    medidor.innerHTML = `
      <div class="senha-barra"><div class="senha-barra-preenchida"></div></div>
      <div class="senha-nivel"></div>
      <ul class="senha-requisitos">
        <li data-req="tamanho">Pelo menos ${TAMANHO_MINIMO} caracteres</li>
        <li data-req="maiusculaMinuscula">Letras maiúsculas e minúsculas</li>
        <li data-req="numero">Pelo menos um número</li>
        <li data-req="simbolo">Pelo menos um símbolo (ex.: ! @ # ?)</li>
        <li data-req="longa">12 ou mais caracteres (bónus)</li>
      </ul>`;
    const barra = medidor.querySelector(".senha-barra-preenchida");
    const texto = medidor.querySelector(".senha-nivel");
    const atualizar = () => {
      const r = avaliarSenha(input.value);
      barra.style.width = r.percentagem + "%";
      barra.style.background = r.cor;
      texto.textContent = input.value ? `Segurança: ${r.rotulo}` : r.rotulo;
      texto.style.color = r.cor;
      medidor.querySelectorAll("li").forEach((li) => li.classList.toggle("ok", !!r.requisitos[li.dataset.req]));
      if (aoMudar) aoMudar(r);
    };
    input.addEventListener("input", atualizar);
    atualizar();
  }

  const api = { avaliarSenha, ligarMedidorSenha, NIVEL_MINIMO, TAMANHO_MINIMO };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(raiz, api);
})(typeof window !== "undefined" ? window : globalThis);
