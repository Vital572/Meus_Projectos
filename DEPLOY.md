# Colocar o GPI Track online (GitHub + Supabase + Render)

| Serviço | Para quê | Custo |
|---|---|---|
| **GitHub** | Guarda o código. O Render lê daqui. | Grátis |
| **Supabase** | Base de dados PostgreSQL **e** armazenamento dos ficheiros enviados | Grátis |
| **Render** | Corre o servidor Node.js (site + API + tempo real) | Grátis |

Ordem: **1. Supabase (base de dados)** → **2. Supabase (ficheiros)** → **3. GitHub** → **4. Render** → **5. Google** → **6. Testar**.

> Guarde num bloco de notas, à medida que avança: a password da base de dados, a `DATABASE_URL`,
> o `SUPABASE_URL` e o `SUPABASE_SECRET_KEY`. Vai precisar deles no passo 4.

> **Esta versão do guia já inclui** a autenticação em dois passos (2FA), as subtarefas, o Gantt, o registo de tempo,
> a exportação Excel e a app instalável (PWA). O `db/schema.sql` já traz **todas as tabelas até à migração v15**:
> numa base nova basta executar o `schema.sql` (não execute os `migration_vXX.sql` um a um).

---

## O que mudou no código para funcionar online

| Problema ao sair do seu PC | Solução já feita no projeto |
|---|---|
| O disco do Render é **apagado a cada deploy** (os anexos e áudios desapareciam) | Ficheiros guardados no **Supabase Storage** (bucket privado, criado sozinho) |
| O Render só tem **IPv4** e o Supabase "direto" é só IPv6 | A app aceita a `DATABASE_URL` da **Session pooler** do Supabase (IPv4) |
| O Render grátis **bloqueia SMTP** (portas 25/465/587) | E-mails enviados pela **Gmail API (HTTPS)** |
| O Render corre em UTC | Lembretes das 08:00 fixados na hora de Angola (`Africa/Luanda`) |
| Segredo de login de desenvolvimento seria público | A app **recusa arrancar** online sem `JWT_SECRET` forte |
| `npm run seed` apagava tudo | O seed **recusa** correr contra uma base remota (pede confirmação) |
| O Render precisa de saber se a app está viva | Endereço `/api/saude` |
| O login com Google não pedia o código do **2FA** | Agora pede (o Google não dispensa o 2FA de quem o ativou) |
| O código de 6 dígitos do 2FA podia ser testado sem limite | Limite de tentativas no endpoint do código |
| Eliminar uma tarefa deixava os anexos das **subtarefas** no armazenamento | A limpeza inclui as subtarefas |

---

## Passo 1 — Supabase: a base de dados

1. Entre em **supabase.com** → **Start your project** (pode entrar com o GitHub).
2. **New project**:
   - *Name*: `gpi-track`
   - *Database Password*: crie uma password e **guarde-a**. Use **só letras e números** (sem `@ # / : ?`), para não haver problemas na ligação.
   - *Region*: **Central EU (Frankfurt)**.
   - *Plan*: Free. Clique **Create new project** e espere ~2 minutos.
3. Menu da esquerda → **SQL Editor** → **New query**.
   Abra o ficheiro `db/schema.sql` deste projeto, copie **todo** o conteúdo, cole no editor e clique **Run**.
   Deve aparecer *Success. No rows returned*.
4. Confirmar: **Table Editor** → no seletor de schema (por cima da lista, diz `public`) escolha **`gpitrack`**. Devem aparecer as tabelas (`users`, `projects`, `tasks`…).
5. Obter a ligação: clique no botão **Connect** (barra de topo) → separador **Session pooler** → copie o endereço (*URI*). É assim:

   ```
   postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
   ```
   Substitua `[YOUR-PASSWORD]` pela sua password **(sem os parênteses retos)**. Esta é a sua **`DATABASE_URL`**.

   > ⚠️ Tem de ser a **Session pooler** (`...pooler.supabase.com:5432`, utilizador `postgres.<ref>`).
   > A ligação "Direct connection" (`db.xxx.supabase.co`) **não funciona no Render** (só IPv6).

> **Não corra `npm run seed` contra esta base.** O primeiro utilizador que se registar no site passa a ser o **administrador**.

## Passo 2 — Supabase: o armazenamento de ficheiros

1. **Project Settings** (ícone de roda dentada, em baixo à esquerda):
   - Em **Data API** (ou **General**), copie o **Project URL** → `https://abcdefghijkl.supabase.co` → é o **`SUPABASE_URL`**.
   - Em **API Keys**, copie a chave **secret** (`sb_secret_…`; em projetos mais antigos, a `service_role` no separador *Legacy API keys*) → é o **`SUPABASE_SECRET_KEY`**.
2. ⚠️ Esta chave dá acesso total ao seu projeto: **nunca** a ponha no GitHub nem no código — só nas variáveis do Render. **Não** use a chave `anon`/`publishable` (não funciona aqui).
3. Não precisa de criar o bucket: a app cria sozinha o bucket **privado** `gpi-track-ficheiros` no primeiro arranque. (Limite do plano grátis: 1 GB no total.)

## Passo 3 — GitHub: guardar o código

**3.1 Criar o repositório** — em **github.com** → **+** → **New repository**:
*Repository name*: `gpi-track` · **Private** (recomendado) · **não** marque *Add a README*, *.gitignore* nem *license* → **Create repository**.

**3.2 Enviar os ficheiros** (escolha UMA das formas):

**Forma A — com Git** (recomendada). Dentro da pasta do projeto (a que tem o `server.js` e o `package.json`):

```bash
git init
git add .
git commit -m "GPI Track online"
git branch -M main
git remote add origin https://github.com/O_SEU_UTILIZADOR/gpi-track.git
git push -u origin main
```
O GitHub não aceita a password normal no `git push`: quando pedir, use um **Personal Access Token**
(GitHub → *Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token*, com a permissão **`repo`**),
ou use o programa **GitHub Desktop**, que trata do login por si.

**Forma B — pelo navegador.** No repositório vazio clique em **uploading an existing file** e arraste
**o conteúdo** da pasta do projeto (não o `.zip`, e não a pasta `node_modules` nem o ficheiro `.env`) → **Commit changes**.

✅ **Confirme** que, na página inicial do repositório, se vê logo `server.js`, `package.json`, `public/`, `src/`, `db/`
(e **não** uma pasta `gpi-track` por fora). Se estiver numa subpasta, o Render não encontra o projeto.

## Passo 4 — Render: publicar o site

1. **render.com** → **Get Started** → entre com o GitHub.
2. **New +** → **Web Service** → autorize o GitHub se pedir → escolha o repositório **`gpi-track`** → **Connect**.
3. Preencha:

   | Campo | Valor |
   |---|---|
   | Name | `gpi-track` (o endereço será `https://gpi-track.onrender.com`; se o nome estiver ocupado, o Render acrescenta letras) |
   | Region | **Frankfurt (EU Central)** |
   | Branch | `main` |
   | Root Directory | *(deixar vazio)* |
   | Runtime / Language | **Node** |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Instance Type | **Free** |

4. Em **Advanced** → **Health Check Path**: `/api/saude`.
5. Em **Environment Variables** → **Add Environment Variable** (uma a uma):

   | Nome | Valor |
   |---|---|
   | `NODE_ENV` | `production` |
   | `TZ` | `Africa/Luanda` |
   | `DATABASE_URL` | a ligação do Passo 1 (com a password) |
   | `JWT_SECRET` | um texto aleatório com 32+ caracteres (veja abaixo) |
   | `SUPABASE_URL` | do Passo 2 |
   | `SUPABASE_SECRET_KEY` | do Passo 2 |
   | `APP_URL` | `https://gpi-track.onrender.com` (o endereço real do seu serviço; pode acrescentar depois) |
   | `GOOGLE_CLIENT_ID` | Passo 5 (opcional) |
   | `GOOGLE_CLIENT_SECRET` | Passo 5 (opcional) |
   | `GMAIL_USER` | Passo 5 (opcional) |
   | `GMAIL_REFRESH_TOKEN` | Passo 5 (opcional) |

   Para gerar o `JWT_SECRET`: no PowerShell do Windows
   `[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))`
   · em Linux/macOS: `openssl rand -base64 32`.
   **Não** defina `PORT` (o Render trata disso) e **não** use `SMTP_*` (o Render grátis bloqueia).

6. **Create Web Service**. Abra o separador **Logs**. Quando tudo estiver certo, aparecem estas linhas:

   ```
   [email] modo de envio: gmail-api
   GPI Track a correr na porta 10000 — https://gpi-track.onrender.com
   [bd] ligação ao PostgreSQL OK.
   [ficheiros] modo: Supabase Storage — bucket "gpi-track-ficheiros" criado.
   ```
   O primeiro deploy demora 2–5 minutos. Depois abra o endereço do serviço.

7. **Crie a sua conta primeiro** (Criar conta): como é o primeiro utilizador, fica **administrador**.

*(Alternativa: o ficheiro `render.yaml` deste projeto faz o passo 3–5 automaticamente — Render → New + → Blueprint.)*

## Passo 5 — Google (login e e-mails) em modo online

Se já seguiu o guia do README para o Google no seu PC, só precisa de **acrescentar o endereço online**:

1. **console.cloud.google.com** → o seu projeto → **Credenciais** → o cliente OAuth → **Origens JavaScript autorizadas** → **Adicionar URI**:
   `https://gpi-track.onrender.com` (exatamente o endereço do Render, sem `/` no fim) → **Guardar**.
   O Google pode demorar de alguns minutos a algumas horas a aplicar a alteração.
2. **Gmail API**: ative-a em *APIs e serviços → Biblioteca → Gmail API → Ativar*.
3. **Refresh token** — em [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground): roda dentada →
   *Use your own OAuth credentials* (cole o ID e o segredo do cliente) → no Passo 1 escreva o âmbito
   `https://www.googleapis.com/auth/gmail.send` → *Authorize APIs* (com o Gmail que vai enviar) →
   *Exchange authorization code for tokens* → copie o **Refresh token** (`1//…`).
   (O URI `https://developers.google.com/oauthplayground` tem de estar nos *URIs de redirecionamento autorizados* do cliente.)
4. No Render, preencha `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_USER` (o Gmail que autorizou) e `GMAIL_REFRESH_TOKEN` → o Render reinicia sozinho.
5. Para o refresh token **não expirar ao fim de 7 dias**: *Google Auth Platform → Público-alvo → Publicar aplicação*.

## Passo 6 — Testar tudo online

1. Criar conta (a barra de segurança da password) e entrar.
2. Criar um projeto, uma tarefa, e abrir o site noutro navegador/telemóvel com outra conta: o tempo real funciona.
3. **Ficheiros**: anexe um ficheiro a uma tarefa e grave uma mensagem de áudio no chat. Depois, no Render → **Manual Deploy → Deploy latest commit**: quando terminar, os ficheiros **continuam a abrir** (prova de que estão no Supabase).
4. **Recuperar conta**: "Esqueceu a password?" → o e-mail chega (veja também o spam).
5. **Notificações por e-mail**: atribua uma tarefa a outra conta com um Gmail real.
6. **Entrar com o Google**.

---

## Limitações do plano gratuito (importante saber)

- **Render grátis adormece** após ~15 minutos sem visitas; o primeiro acesso depois disso demora cerca de 30–60 segundos a "acordar" e as ligações em tempo real reconectam-se sozinhas.
  Para o manter acordado (útil numa apresentação ou para o lembrete das 08:00 correr), crie um monitor grátis em **uptimerobot.com** ou **cron-job.org** a visitar `https://o-seu-servico.onrender.com/api/saude` a cada 5–10 minutos.
- **Supabase grátis pausa** o projeto após cerca de 1 semana sem atividade: entre no painel e clique **Restore project**.
- Limites grátis: base de dados ~500 MB, ficheiros 1 GB.
- Faça uma **cópia de segurança** antes de apresentar (Supabase → *Database → Backups*, se disponível no seu plano, ou exporte as tabelas).

## Notas sobre as funcionalidades novas

- **2FA (autenticador)**: funciona online como no seu PC. O código depende da hora; o Render tem a hora certa, mas o telemóvel também tem de ter a hora automática.
- **App instalável (PWA)**: só funciona em **HTTPS**, e o endereço `onrender.com` já o tem. No telemóvel (Chrome): menu ⋮ → *Instalar aplicação*. Depois de cada deploy a app atualiza-se sozinha (rede primeiro; a cache só serve se estiver sem internet).
- **Entrar com o Google numa conta que já existia com password**: a conta fica associada ao Google e a password antiga é **anulada** (para ninguém poder ficar com acesso a uma conta registando-se antes com o e-mail de outra pessoa). A pessoa entra com o Google, ou define uma password nova em "Esqueceu a password?".
- **Exportar para Excel / PDF**: geram-se no servidor, em memória — não precisam de disco.

## ⚠️ Segredos: o `.env` nunca vai para o GitHub

O ficheiro `.env` (o do seu PC) tem passwords e chaves. O projeto traz um `.gitignore` que o impede de ir para o GitHub **se usar o Git**.
Se enviar os ficheiros **pelo navegador** (Forma B do Passo 3), não arraste o `.env`. Se alguma vez um `.env` com dados reais foi enviado para
um sítio público (GitHub público, grupo, e-mail), troque essas chaves: nova palavra-passe de aplicação / novo segredo do cliente Google, e novo `JWT_SECRET`.
Online, as variáveis ficam **só** no painel do Render.

## Atualizar o site mais tarde

Altere os ficheiros e envie: `git add . && git commit -m "mensagem" && git push`. O Render publica sozinho (auto-deploy).
Se a alteração incluir um novo ficheiro `db/migration_vXX.sql`, execute-o também no **SQL Editor** do Supabase.

## Se algo correr mal

Veja sempre o separador **Logs** do Render: a app escreve ali o motivo, com a dica do que fazer.

| O que aparece | Causa e solução |
|---|---|
| `ERRO: defina a variável JWT_SECRET` | Falta o `JWT_SECRET` (ou é curto/igual ao exemplo). Defina um texto aleatório de 32+ caracteres. |
| `[bd] NÃO foi possível ligar… ENETUNREACH` | Está a usar a ligação "Direct". Use a **Session pooler** (`…pooler.supabase.com:5432`). |
| `…Tenant or user not found` | O utilizador tem de ser `postgres.<ref>` (copie a string da Session pooler outra vez). |
| `…password authentication failed` / `28P01` | Password da base de dados errada na `DATABASE_URL`. Pode repô-la em *Supabase → Project Settings → Database → Reset database password*. |
| `[bd] …as tabelas NÃO existem` | Falta correr o `db/schema.sql` no SQL Editor (Passo 1.3). |
| `[ficheiros] … respondeu 401/403` ou erro ao enviar anexos | `SUPABASE_URL` ou `SUPABASE_SECRET_KEY` errados (use a chave **secret**, não a `anon`). |
| `[ficheiros] modo: disco local` no Render | Faltam `SUPABASE_URL`/`SUPABASE_SECRET_KEY`. Os ficheiros perder-se-iam em cada deploy. |
| Botão Google não aparece / `origin_mismatch` | Falta o endereço do Render nas *Origens JavaScript autorizadas* (Passo 5.1), ou o Google ainda não aplicou. |
| `[email] erro ao enviar… invalid_grant` | O refresh token expirou. Gere outro (Passo 5.3) e publique a app Google (Passo 5.5). |
| `[email] erro ao enviar… 403` | A **Gmail API** não está ativada no projeto Google (Passo 5.2). |
| O link do e-mail aponta para `localhost` | Falta `APP_URL` com o endereço real. |
| O site demora ~1 minuto a abrir | É o plano grátis a acordar (veja "Limitações"). |
