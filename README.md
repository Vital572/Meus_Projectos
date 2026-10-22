# GPI Track

Protótipo de ferramenta de gestão de projetos colaborativa em tempo real, desenvolvido
no âmbito do trabalho de **Gestão de Projetos Informáticos (GPI)** — *Estudo de
Ferramentas para Acompanhamento de Projetos em Equipa em Tempo Real (Home Office)*.

Quadro Kanban com atualizações instantâneas entre todos os membros da equipa,
comentários em tempo real, indicador de "a escrever...", presença online e
registo de atividade — implementado com **Node.js + Express + PostgreSQL + Socket.IO**.

## Arquitetura

```
Browser (HTML/CSS/JS) ── HTTP (REST) ──► Express API ──► PostgreSQL
        │                                     │
        └──────── WebSocket (Socket.IO) ──────┘
                (eventos em tempo real)
```

- **Frontend**: HTML, CSS e JavaScript puro (sem framework), com quadro Kanban
  arrastável (drag-and-drop nativo) e cliente Socket.IO.
- **Backend**: Node.js + Express, expõe uma API REST (`/api/...`) e um servidor
  Socket.IO no mesmo processo.
- **Base de dados**: PostgreSQL (schema `gpitrack`) — local (pgAdmin) em desenvolvimento, **Supabase** online.
- **Ficheiros** (anexos, áudio do chat): pasta `/uploads` em desenvolvimento, **Supabase Storage** (bucket privado) online.
- **E-mail**: Gmail API (HTTPS) online; SMTP opcional no seu PC.
- **Tempo real**: qualquer alteração (criar/mover tarefa, comentar) é gravada na
  base de dados e, de seguida, difundida via Socket.IO a todos os utilizadores
  ligados ao mesmo projeto (sala `project:<id>`).

## Pré-requisitos

- Node.js 18 ou superior
- PostgreSQL já instalado localmente (sem necessidade de Docker)
- pgAdmin (opcional, mas recomendado para inspecionar a base de dados)

## Instalação

### 1. Criar a base de dados

No pgAdmin (ou via `psql`), crie uma base de dados chamada `gpitrack`:

```sql
CREATE DATABASE gpitrack;
```

Depois, execute o esquema fornecido em `db/schema.sql` dentro dessa base de dados
(no pgAdmin: botão direito sobre `gpitrack` → Query Tool → colar o conteúdo do
ficheiro → Executar).

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Edite o `.env` com as credenciais do seu PostgreSQL local (utilizador `postgres`
e a password que definiu na instalação).

### 3. Instalar dependências

```bash
npm install
```

### 4. Popular a base de dados com dados de demonstração (opcional)

```bash
npm run seed
```

Isto cria 3 utilizadores de teste (password `123456` para todos):

- `vital@ukv.ao`
- `ana@ukv.ao`
- `domingos@ukv.ao`

... uma equipa, um projeto com 4 colunas Kanban e 7 tarefas de exemplo.

### 5. Iniciar o servidor

```bash
npm start
```

A aplicação fica disponível em **http://localhost:3000**.

## Como testar o tempo real

A melhor forma de comprovar a colaboração em tempo real é abrir o mesmo projeto
em **duas janelas do navegador** (ou uma janela normal e uma anónima), com dois
utilizadores diferentes (ex: `vital@ukv.ao` numa e `ana@ukv.ao` noutra). Ao
criar, mover ou comentar uma tarefa numa janela, a alteração aparece
instantaneamente na outra, sem recarregar a página — replicando o cenário de
uma equipa a trabalhar em regime de home office.

**Sessões isoladas por separador**: cada separador do navegador guarda a sua
própria sessão (via `sessionStorage`, não por cookie partilhado). Isto significa
que pode abrir `vital@ukv.ao` num separador e `ana@ukv.ao` noutro **do mesmo
navegador**, e cada um mantém a sua própria identidade — sem um login "empurrar"
o outro. É por isso que a aplicação usa separadores em vez de apenas janelas
diferentes: dois separadores da mesma janela funcionam tão bem quanto duas
janelas distintas.

> Nota técnica: isto resolve uma limitação comum em protótipos web — cookies
> `httpOnly` são partilhados por todos os separadores do mesmo browser, pelo
> que fazer login numa conta substituiria a sessão em todos os separadores
> abertos. Guardando o token em `sessionStorage` (que é isolado por separador)
> e enviando-o em cada pedido através do cabeçalho `Authorization: Bearer`,
> cada separador passa a ter uma sessão verdadeiramente independente.

## Estrutura de pastas

```
prototipo/
├── server.js                 # Ponto de entrada: Express + Socket.IO
├── db/
│   ├── schema.sql             # Esquema completo da base de dados (instalação nova)
│   ├── migration_v2.sql       # Migração incremental (quem já tinha a v1 instalada)
│   ├── seed.js                 # Dados de demonstração
│   └── pool.js                # Ligação à base de dados
├── src/
│   ├── routes/                # Rotas REST (auth, projects, tasks, comments, notifications, admin)
│   ├── middleware/auth.js     # Autenticação JWT + verificação de administrador
│   ├── lib/notify.js          # Helper para criar e emitir notificações em tempo real
│   └── sockets/index.js       # Lógica de tempo real (Socket.IO) + presença global
└── public/                    # Frontend (HTML, CSS, JS)
    ├── index.html              # Página inicial pública
    ├── entrar.html / esqueci-senha.html / redefinir-senha.html   # Entrar, criar conta e recuperar conta
    ├── projetos.html           # Lista de projetos
    ├── board.html               # Quadro Kanban em tempo real
    ├── admin.html                # Painel de administração
    ├── css/styles.css
    └── js/ (api.js, board.js, admin.js, notifications.js)
```

## Funcionalidades implementadas

**Colaboração em tempo real**
- Registo e autenticação de utilizadores (JWT), com **Entrar com o Google**, **recuperação de password** e **barra de segurança da password** (ver secção abaixo)
- Criação de projetos com colunas Kanban padrão (Por Fazer, Em Curso, Em Revisão, Concluído)
- Criação, edição e movimentação de tarefas (drag-and-drop) com sincronização em tempo real
- Comentários em tempo real por tarefa, com indicador de "a escrever…" e menções (`@Nome`)
- Indicador de presença: quem está online a ver o projeto agora
- Registo de atividade (histórico) por projeto

**Funcionalidades adicionais de gestão de projetos**
- **Etiquetas (labels)**: criação e atribuição de etiquetas coloridas às tarefas, com filtro no quadro
- **Checklist (subtarefas)**: lista de verificação dentro de cada tarefa, com barra de progresso
- **Notificações em tempo real**: sino com contador de não lidas, disparado quando alguém lhe atribui uma tarefa, comenta ou o(a) menciona
- **Convite de membros**: adicionar utilizadores já registados a um projeto pelo e-mail
- **Pesquisa e filtros** no quadro: por texto, responsável e etiqueta
- **Destaque de prazos em atraso** (tarefas com `due_date` ultrapassado ficam assinaladas a vermelho)

**Sessão única por conta**
- Uma conta só pode estar autenticada num separador/navegador/dispositivo de cada vez
- Se tentar iniciar sessão com uma conta que já está ligada noutro lado, a aplicação recusa o pedido e mostra uma mensagem clara a explicar a situação
- Assim que a sessão anterior é encerrada (logout, ou o separador/navegador é fechado), a conta fica livre para uma nova sessão automaticamente — não é preciso nenhuma ação manual
- Isto é diferente de contas diferentes: `vital@ukv.ao` num separador e `ana@ukv.ao` noutro continuam a funcionar em simultâneo sem qualquer problema

**Formulário de edição de tarefas com Bootstrap**
- Os campos do formulário de edição de tarefas (título, descrição, prioridade, responsável, prazo) usam agora componentes do Bootstrap 5, estilizados para a paleta da plataforma
- Autocompletar e correção ortográfica do navegador desativados nesses campos, para deixarem de mostrar sugestões nativas do Chrome por cima da interface
- O resto da aplicação (login, novo projeto, nova tarefa, etc.) mantém-se exatamente como estava

**CRUD completo e permissões**
- **Projetos**: criar, ler, **editar (nome/descrição)** e **eliminar** — apenas quem criou o projeto ou um administrador da plataforma
- **Colunas do quadro**: criar, renomear e eliminar (só coluna vazia) — apenas o dono do projeto ou administrador
- **Tarefas**: criar (qualquer membro), ler, **editar** e **eliminar** — quem criou a tarefa, o dono do projeto, ou um administrador
- **Etiquetas**: criar (qualquer membro), eliminar — apenas o dono do projeto ou administrador
- **Comentários**: criar (qualquer membro), eliminar — autor do comentário, dono do projeto, ou administrador
- **Membros**: convidar (dono do projeto ou admin), remover (dono/admin, ou o próprio a sair do projeto)
  - Quando um membro sai do projeto por iniciativa própria, o **responsável (criador) do projeto** recebe uma notificação em tempo real — e só ele, ninguém mais

> Todas estas regras são validadas **no servidor**, não apenas escondidas na interface — mesmo que alguém edite o HTML/JS no navegador, o backend recusa o pedido com erro 403 se a pessoa não tiver permissão.

**Relatórios administrativos** (dentro do painel de administração → separador "Relatórios")
- **Consulta direta na plataforma**: tabelas de pré-visualização com projetos, tarefas por projeto (com responsáveis e etiquetas) e utilizadores, sem sair da aplicação
- **Relatório Geral**: números consolidados + lista de projetos + lista de utilizadores
- **Relatório de Projetos e Tarefas**: detalhe de todas as tarefas por projeto (coluna, prioridade, responsável, etiquetas, progresso da checklist) — com filtro opcional para um único projeto
- **Relatório de Utilizadores**: atividade por conta (tarefas atribuídas/criadas, comentários, projetos)
- Todos os relatórios podem ser **gerados em PDF** (design profissional com cores da plataforma, cabeçalho, rodapé com paginação) — o PDF abre numa nova aba, de onde pode ser impresso ou guardado através do próprio visualizador do navegador
- **Exportação de dados em CSV** (compatível com Excel/Google Sheets) para projetos, tarefas ou utilizadores

**Painel de administração** (`/admin.html`, apenas para utilizadores com papel `admin`)
- Visão geral com estatísticas da plataforma (utilizadores, projetos, tarefas, utilizadores online)
- Gestão de utilizadores: promover/despromover administrador, ativar/desativar conta, eliminar conta
- **Desativar uma conta força imediatamente o encerramento de todas as sessões ativas desse utilizador**, em tempo real (via Socket.IO)
- Lista de utilizadores online agora, atualizada ao vivo sem recarregar a página
- Lista de todos os projetos da plataforma, com equipa, criador, nº de membros e de tarefas
- **Notificações**: estatísticas (total, por ler, por tipo) e lista das 100 notificações mais recentes da plataforma, com destinatário e projeto — útil para confirmar que o sistema de notificações está a funcionar
- **Mensagens**: envio de anúncios em tempo real a todos os utilizadores, a um projeto específico, ou a um único utilizador — cada destinatário recebe uma notificação instantânea (🔔) — com histórico de tudo o que já foi enviado

> O primeiro utilizador alguma vez registado na plataforma torna-se automaticamente administrador.
> Nos dados de demonstração (`npm run seed`), esse utilizador é `vital@ukv.ao`.

## Se atualizar os ficheiros do protótipo (ex: substituir por uma nova versão)

O servidor já está configurado para impedir que o navegador guarde os
ficheiros HTML/CSS/JS em cache (ver `server.js`), por isso normalmente basta
recarregar a página. Mesmo assim, se notar comportamento "antigo" depois de
substituir os ficheiros por uma nova versão:

1. Pare o servidor (Ctrl+C no terminal) e arranque-o de novo com `npm start`
2. Force um recarregamento completo no navegador em cada separador aberto:
   **Ctrl+Shift+R** (Windows/Linux) ou **Cmd+Shift+R** (Mac)
3. Se a dúvida persistir, abra as Ferramentas de Programador (F12) → separador
   **Application** → **Session Storage** → confirme que a chave
   `gpitrack_token` tem um valor diferente em cada separador com uma conta
   diferente ligada

## Se já tinha instalado uma versão anterior deste protótipo

Se já tinha criado a base de dados `gpitrack` antes desta atualização (sem etiquetas,
checklist, notificações ou administração), não precisa de recriar tudo — basta aplicar
a migração incremental:

1. No pgAdmin, abra o Query Tool sobre a base de dados `gpitrack`.
2. Copie e execute o conteúdo de `db/migration_v2.sql`.

Este script adiciona as novas tabelas e colunas sem apagar os dados já existentes, e
promove automaticamente o utilizador mais antigo a administrador.

Se já tinha a versão com etiquetas/checklist/notificações mas ainda não tinha os
separadores "Notificações" e "Mensagens" da administração, basta aplicar
adicionalmente o `db/migration_v3.sql` (cria apenas a tabela `admin_messages`).

Se já tinha os anexos de tarefas mas ainda não tinha o **Espaço de Gestão** do
membro (equipas, minhas tarefas, membros, relatórios e reuniões), aplique também
o `db/migration_v5.sql` (cria apenas a tabela `meetings`).

Se já tinha o Espaço de Gestão mas ainda não tinha a **Conversa da equipa** nem
as **Automações**, aplique também o `db/migration_v6.sql` (cria as tabelas
`channel_messages` e `automations`).

Se já tinha a Conversa da equipa e as Automações mas ainda não tinha a opção de
**escolher qual coluna representa "tarefa concluída"**, aplique também o
`db/migration_v7.sql` (adiciona a coluna `is_done` a `board_columns`).

Se já tinha essa opção mas ainda não tinha **vários responsáveis por projeto**,
**colunas restritas** e a **caixa de feedback**, aplique também o
`db/migration_v8.sql`.

Se já tinha isso mas ainda não tinha os **convites com aceitar/recusar**, os
**ficheiros/áudio na conversa**, os **lembretes de prazo** nem as **novas
automações**, aplique também o `db/migration_v9.sql`.

Se já tinha isso mas ainda não tinha **vários responsáveis por tarefa**, aplique
também o `db/migration_v10.sql`. E se as notificações de pedido de convite
alguma vez falharam com erro 500, aplique o `db/migration_v11.sql` (corrige o
tamanho da coluna que guarda o tipo da notificação).

Se já tinha tudo isso mas ainda não tinha a **visibilidade de tarefas** (opção,
ao criar uma tarefa, de a tornar visível a toda a equipa ou só aos
responsáveis), aplique também o `db/migration_v12.sql`.

Se já tinha isso mas ainda não tinha **editar/eliminar mensagens da conversa
da equipa**, aplique também o `db/migration_v14.sql` (adiciona `edited_at`,
`deleted_at`/`deleted_by` a `channel_messages` e a tabela
`channel_message_hidden`).

Se já tinha isso mas ainda não tinha o **Gantt, subtarefas, dependências,
campos personalizados, registo de tempo, metas, reações/respostas/menções no
canal nem a autenticação de dois fatores**, aplique também o
`db/migration_v15.sql` (ver a secção seguinte para o que cada coisa é).

## Novidades inspiradas nas 5 ferramentas estudadas

Depois de comparar o GPI Track com as 5 ferramentas do trabalho (Slack,
Asana, ClickUp, Monday.com, Smartsheet), acrescentei a cada uma pelo menos
uma funcionalidade de destaque, para o protótipo cobrir um pouco de cada
abordagem:

**Monday.com / Smartsheet**
- **Gráfico de Gantt** — nova vista no quadro (`/board.html`) que desenha
  cada tarefa como uma barra entre a data de início e o prazo, agrupada por
  coluna; dá para perceber de relance onde as datas se sobrepõem.
- **Campos personalizados por projeto** — o responsável do projeto define
  colunas extra (texto, número, data ou lista de opções) que passam a
  aparecer no detalhe de cada tarefa, tal como no Monday/Smartsheet.
- **Agrupar e ordenar tarefas** no quadro por responsável, prioridade ou
  etiqueta, além da vista por coluna.

**Asana**
- **"Minha semana"** — no Espaço de Gestão, um separador com as tarefas de
  todos os projetos da pessoa que têm prazo nos próximos 7 dias.
- **Subtarefas reais** — uma tarefa pode ter tarefas-filhas, cada uma com o
  seu próprio responsável, prazo e estado, para além da checklist simples.
- **Dependências entre tarefas** — marcar que uma tarefa só pode começar
  depois de outra terminar; aparece como aviso no detalhe da tarefa e como
  ligação no Gantt.

**ClickUp**
- **Registo de tempo** — cronómetro em cada tarefa (iniciar/parar), com o
  total por tarefa, por pessoa e por projeto nos relatórios.
- **Metas/objetivos do projeto** — criar uma meta com data-alvo e ligar
  tarefas a ela; o progresso é calculado automaticamente a partir de quantas
  dessas tarefas já estão concluídas.

**Slack**
- **Reações de emoji** nas mensagens da Conversa da equipa.
- **Responder a uma mensagem específica** (um "thread" simples: a resposta
  mostra um resumo da mensagem original por cima).
- **Menções `@nome`** no canal, que notificam a pessoa mencionada.
- **Pesquisar** no histórico de mensagens do canal.

**Transversais às 5 ferramentas**
- **Autenticação de dois fatores (2FA/TOTP)** — ativa-se no Espaço de
  Gestão → Visão geral → Segurança: mostra um QR code para ler numa app como
  Google Authenticator; a partir daí, o login passa a pedir sempre o código
  de 6 dígitos além da password (ou da conta Google). Pode ser desativada a
  qualquer momento com um código válido ou a password atual.
- **Exportar o projeto para PDF ou Excel** — em `/board.html`, exporta o
  quadro completo (tarefas, responsáveis, prazos, estado) no formato
  escolhido, para imprimir ou enviar a alguém fora da plataforma.
- **Aplicação instalável e com funcionamento parcial offline (PWA)** — o
  navegador (Chrome, Edge, Safari no iPhone/Android) oferece "Instalar
  aplicação" ou "Adicionar ao ecrã principal"; depois de instalada, abre
  como uma app normal. As páginas já visitadas antes continuam a abrir sem
  ligação à internet (não mostra o ecrã em branco do navegador), mas os
  dados em si — quadro, mensagens, notificações — continuam a precisar de
  ligação para atualizar.

## Tutoriais animados, detalhe de tarefa responsivo e novo visual

- **Tutoriais por funcionalidade** — em `/funcionalidades.html` cada uma das 22
  funcionalidades é um cartão clicável que abre um tutorial animado, passo a
  passo (demonstração desenhada em HTML/CSS, sem imagens), com avanço
  automático, pontos de navegação, setas do teclado e botão "Experimentar
  agora". Os filtros por ferramenta (Slack, Asana, ClickUp, Monday.com,
  Smartsheet, Transversais) funcionam. Os tutoriais estão em
  `public/js/tutoriais.js` (lista `TUTORIAIS`): para acrescentar um, basta
  juntar um objeto com os seus passos.
- **Detalhe da tarefa responsivo** — no computador abre em duas colunas (edição,
  subtarefas, checklist e comentários à esquerda; tempo, responsáveis extra,
  campos, dependências e anexos à direita); no tablet passa a uma coluna; no
  telemóvel ocupa o ecrã inteiro, com cabeçalho fixo, botões grandes e campos
  que não provocam zoom no iPhone.
- **Visual com mais Bootstrap** — faixa de boas-vindas e indicadores em "Os meus
  projetos", cartões de projeto com barra de progresso, membros e atrasos,
  faixa-resumo no quadro (tarefas, concluídas, em atraso, membros, progresso),
  estados vazios com ilustração e colunas com "Arraste tarefas para aqui".
  Não há migração de base de dados nova nesta versão; só é preciso substituir os
  ficheiros e reiniciar (`npm start`).

## Liberdade para sair de um projeto — correção importante

Corrigi um bug real: a saída/remoção de um projeto ainda estava presa ao
conceito antigo de "um único dono" (`created_by`), incompatível com o sistema
de vários responsáveis. Na prática, isto impedia às vezes que o criador
original saísse do projeto mesmo depois de deixar de ser responsável, e não
protegia corretamente contra um projeto ficar sem nenhum responsável.

Agora: **qualquer membro é livre de sair de um projeto quando quiser** — a
única exceção é não poder haver zero responsáveis; se for o único
responsável, tem primeiro de tornar outra pessoa responsável (ou pedir a um
administrador). O mesmo se aplica ao envio de anexos e ao cancelamento de
reuniões, que agora notificam/consideram todos os responsáveis atuais, não
apenas quem criou o projeto originalmente.

## Trocar de projeto sem sair do quadro

No topo da barra lateral do quadro (`/board.html`) há agora um seletor rápido
com o nome do projeto atual — clicar nele mostra a lista dos outros projetos
da pessoa, para saltar diretamente para outro sem ter de voltar a "Os meus
projetos" (que continua acessível no fundo da lista, "Ver todos os
projetos →").

## Tarefas visíveis a toda a equipa: ver não é o mesmo que interagir

Uma tarefa marcada como visível "a toda a equipa" pode ser vista por
qualquer membro do projeto, mas **só pode ser comentada ou receber anexos
por quem está diretamente envolvido nela**: o atribuído, um responsável
extra dessa tarefa, um responsável do projeto, ou um administrador. Um
membro que só a vê (sem fazer parte dela) fica em modo só-leitura — vê
título, descrição, checklist, etiquetas e comentários já existentes, mas o
formulário de comentar e o de enviar ficheiros ficam escondidos, com um
aviso a explicar porquê. Isto é verificado também no servidor (não só
escondido na interface), por isso um pedido direto à API é recusado da
mesma forma.

## Editar, eliminar e copiar mensagens da conversa da equipa

Cada mensagem de texto na Conversa da equipa tem agora um menu "⋯" (visível
ao passar o rato, ou sempre em ecrãs táteis) com até três ações:

- **Copiar** — copia o texto da mensagem para a área de transferência.
- **Editar** (só a própria pessoa, só mensagens de texto) — mostra um campo
  para alterar o texto; depois de guardar, a mensagem passa a ter a marca
  "(editada)" junto da data, visível para todos.
- **Eliminar** — pergunta sempre se é **"para todos"** ou **"só para mim"**:
  - **Para todos**: só o autor da mensagem ou um responsável do
    projeto/administrador pode fazer isto. O conteúdo deixa de ser mostrado
    a toda a gente, e passa a aparecer "Mensagem eliminada" no lugar.
  - **Só para mim**: qualquer pessoa pode ocultar qualquer mensagem da sua
    própria vista — os restantes continuam a ver a mensagem normalmente, sem
    saber que alguém a ocultou.

Mensagens com ficheiro/imagem/áudio só têm a opção de eliminar (copiar e
editar não se aplicam a esse tipo).

## Indicador "a escrever…" na conversa da equipa

Enquanto alguém escreve no campo de mensagem da Conversa da equipa, as
outras pessoas que estiverem a ver essa conversa no mesmo projeto veem, por
baixo do histórico, "Fulano está a escrever…" com três pontinhos animados
(como no WhatsApp/Messenger). O aviso desaparece sozinho ao fim de pouco
tempo sem nova atividade de escrita.

## Anexos e ficheiros do canal — correção importante

Os links de download (anexos de tarefas, ficheiros/imagens/áudio do canal de
conversa) agora incluem o token de sessão no próprio URL. Isto foi necessário
porque um clique direto num link (`<a>`, `<img>`, `<audio>`) não envia o
cabeçalho de autenticação da aplicação — sem isto, dava sempre "não
autenticado" ao tentar abrir um ficheiro.

## Vários responsáveis por tarefa

Além do responsável principal (o campo "Responsável" já existente), o
responsável do projeto ou um administrador pode agora adicionar mais pessoas
como responsáveis de uma tarefa específica, na secção "Responsáveis extra"
do detalhe da tarefa. Essas pessoas também aparecem em "Minhas tarefas" no
Espaço de Gestão, e recebem os lembretes de prazo.

## Convites em duas etapas

- Se quem convida já for **responsável do projeto (ou administrador)**, o
  convite segue diretamente para a pessoa convidada, como antes.
- Se quem convida for um **membro comum**, o pedido primeiro tem de ser
  aprovado por um responsável do projeto (visível em "Os meus projetos" →
  "Pedidos de convite para aprovar"). Só depois de aprovado é que a pessoa
  convidada recebe o convite para aceitar ou recusar.
- Em qualquer aceitação/recusa final, tanto quem propôs o convite como os
  responsáveis do projeto são notificados.

## Configurar o envio de feedback por e-mail (SMTP)

> **Online (Render grátis) o SMTP está bloqueado.** Use a Gmail API (secção "Conta: Google…" mais abaixo e `DEPLOY.md`). Este método SMTP serve para o seu PC.

O feedback fica **sempre** guardado e visível na Administração, mesmo sem
configurar nada. Para também chegar ao seu e-mail, preencha no `.env`:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=o-seu-email@gmail.com
SMTP_PASS=a-sua-palavra-passe-de-aplicação
FEEDBACK_EMAIL_TO=vitajoao143@gmail.com
```

**Se usar Gmail** (o caminho mais simples para um protótipo):
1. Ative a verificação em 2 passos na conta Google que vai usar para enviar (`myaccount.google.com/security`)
2. Em "Palavras-passe de aplicação" (`myaccount.google.com/apppasswords`), crie uma nova — vai receber 16 letras
3. Use essa conta em `SMTP_USER` e as 16 letras (sem espaços) em `SMTP_PASS` — **nunca** a palavra-passe normal da conta, o Gmail bloqueia isso
4. `SMTP_HOST=smtp.gmail.com` e `SMTP_PORT=587` ficam sempre iguais

Se preferir não usar a sua conta pessoal, serviços como Brevo (ex-Sendinblue)
ou Mailtrap oferecem SMTP gratuito para testes, com as suas próprias
credenciais — o resto da configuração é igual.

Depois de preencher o `.env`, reinicie o servidor. Se algo correr mal, o
erro aparece na consola do servidor (o feedback continua a ser guardado na
mesma).

## Convites de projeto

Convidar alguém já não a adiciona diretamente — cria um convite pendente,
que a pessoa recebe como notificação e vê com todos os detalhes do projeto
(descrição, equipa, nº de membros/tarefas, quem convidou) em "Os meus
projetos", com botões para aceitar ou recusar. O modal de convite tem
pesquisa (nome/e-mail) e ordenação (nome A–Z, Z–A, mais recentes).

## Pesquisa nas listas

Todos os separadores do Espaço de Gestão e da Administração têm uma caixa
de pesquisa — exceto "Relatórios", como pedido.

## Conversa da equipa

Além de texto, agora também é possível enviar ficheiros, imagens/GIF, e
gravar mensagens de áudio diretamente do navegador (like WhatsApp).

## Lembretes automáticos de prazo

Todos os dias às 08:00 (`node-cron`), quem tem uma tarefa atribuída é
notificado se o prazo for amanhã ou hoje — cada aviso só é enviado uma vez.
Para testar sem esperar, um administrador pode disparar manualmente em
`POST /api/admin/lembretes/executar`.

## Automações

Além de notificar, uma automação agora também pode: atribuir a tarefa
automaticamente a alguém, mudar a prioridade, ou marcar toda a checklist
como concluída.

## Checklist

Só responsáveis do projeto (ou administradores) podem criar itens de
checklist — inclusive já ao criar uma tarefa nova.

## Feedback por e-mail

O feedback continua sempre a ficar guardado e visível na Administração.
Para além disso, o sistema tenta também enviá-lo por e-mail para
`vitajoao143@gmail.com` — mas isso só funciona depois de preencher
`SMTP_HOST`, `SMTP_USER` e `SMTP_PASS` no seu `.env` (ver `.env.example`
para instruções, incluindo um exemplo para Gmail). Sem essas credenciais,
o feedback continua a funcionar normalmente, só não chega por e-mail.

## Permissões: responsáveis vs. membros

- **Só responsáveis do projeto (pode haver mais do que um) ou administradores**
  conseguem: mover tarefas entre colunas, criar/editar/eliminar colunas, e
  marcar/desmarcar outros membros como responsáveis
- **Membros comuns** só trabalham nas tarefas atribuídas a si (comentar,
  checklist, anexar ficheiros) — não arrastam tarefas nem gerem colunas
- Uma coluna pode ser marcada como **restrita** (🔒) — só responsáveis e
  administradores a veem no quadro; útil para uma coluna como "Em Revisão"
- Na lista de membros do quadro, quem já é responsável (ou admin) vê um
  checkbox "Responsável" para tornar qualquer colega também responsável —
  nunca pode ficar um projeto sem pelo menos um

## Feedback

Há uma caixa de feedback na página inicial pública e no Espaço de Gestão
(separador "💬 Feedback"). As mensagens ficam guardadas na base de dados e
são vistas na Administração (separador "💬 Feedback") — a plataforma ainda
não tem um serviço de e-mail configurado, por isso não são enviadas por
e-mail automaticamente.

## Página inicial em várias páginas

O menu da página inicial (`/`) já não usa âncoras — cada opção leva a uma
página própria: `/funcionalidades.html`, `/exemplos.html`, `/servicos.html`
e `/sobre.html`. O cabeçalho e rodapé são partilhados por todas através de
`public/js/lp-partials.js`.

## Colunas do quadro

Ao criar ou editar uma coluna, pode escolher um nome sugerido (Por Fazer, Em
Curso, Em Teste, Em Revisão, Bloqueado, Backlog, Concluído) ou escrever o seu
próprio, e marcar **qual coluna representa "tarefa concluída"** — usada em
todos os relatórios e gráficos da plataforma. Só pode haver uma por projeto;
marcar uma nova desmarca automaticamente a anterior.

Uma coluna também pode ser marcada como **restrita** (visível só para
responsáveis/admin) — útil, por exemplo, numa coluna "Em Revisão" ou mesmo na
própria coluna "Concluído". Correção importante: se uma pessoa já estava a
trabalhar numa tarefa sua (por ser o atribuído ou um responsável extra) e essa
tarefa é movida para uma coluna restrita, ela **não perde o acesso a essa
tarefa** — continua a vê-la e a conseguir comentar/anexar ficheiros nela,
apenas deixa de ver as restantes tarefas dessa coluna.

## Dashboards com gráficos

Além do separador "Visão Geral" da Administração, agora há gráficos (Chart.js)
também em:
- **Administração → Relatórios** — mesma estrutura da Visão Geral
- **Espaço de Gestão → Relatórios** — os mesmos gráficos, mas com o âmbito
  limitado aos projetos da própria pessoa

## Vista de Calendário

Clicar num dia com tarefas abre uma lista com todas elas (não só as 3 primeiras
mostradas no quadradinho do dia).

## Vistas do quadro (`/board.html`)

Além do quadro Kanban, cada projeto tem agora 4 vistas adicionais, acessíveis
pelo seletor no topo:

- **Lista** — todas as tarefas do projeto numa tabela (título, coluna, prioridade, responsável, prazo)
- **Calendário** — tarefas organizadas pelo prazo, num calendário mensal navegável
- **Conversa da equipa** — canal de conversa geral do projeto, em tempo real, à parte dos comentários por tarefa (inspirado no Slack)
- **Automações** — regras simples: "quando uma tarefa entra nesta coluna, notifica X" (inspirado no Monday.com); só o responsável do projeto (ou administrador) pode criar/gerir

## Preparado para produção

Foram adicionadas três camadas de robustez para quando o protótipo for colocado
num servidor real ("na nuvem"):

- **helmet** — cabeçalhos de segurança HTTP (o CSP vem desativado por defeito,
  porque a aplicação carrega vários recursos de CDNs — Bootstrap, Chart.js,
  Socket.IO, ícones; configure-o com as origens exatas antes de um lançamento sério)
- **compression** — comprime as respostas HTTP, reduzindo o tempo de carregamento
- **express-rate-limit** — limita tentativas de login/registo, dificultando ataques de força bruta

## Colocar online (GitHub + Supabase + Render)

O protótipo está pronto para ser publicado: código no **GitHub**, base de dados e ficheiros no
**Supabase**, servidor no **Render**. O passo a passo completo — com todos os valores a preencher,
os testes finais e a resolução de problemas — está em **[DEPLOY.md](DEPLOY.md)**.

Resumo do que muda online (e já está feito no código):

- `DATABASE_URL` (Session pooler do Supabase) substitui as variáveis `PG*`; o SSL liga-se sozinho.
- Os ficheiros enviados vão para o **Supabase Storage** (o disco do Render é apagado a cada deploy).
  Ficheiros que não sejam imagem/áudio/vídeo/PDF são sempre descarregados, nunca abertos no site.
  Eliminar uma tarefa, um projeto, ou uma mensagem "para todos" apaga também os ficheiros.
- E-mails pela **Gmail API (HTTPS)** — o Render grátis bloqueia SMTP.
- Lembretes de prazo às 08:00 na hora de Angola (`TZ_LEMBRETES`, por defeito `Africa/Luanda`).
- A app **não arranca** online sem `JWT_SECRET`; o `npm run seed` **recusa** apagar uma base remota;
  a "conta de demonstração" só aparece com `MOSTRAR_CONTA_DEMO=true` (desenvolvimento local).
- `/api/saude` para o Render e para serviços de *keep-alive*; arranque com diagnóstico da base de dados nos registos.

Em desenvolvimento local nada muda: sem `DATABASE_URL` nem `SUPABASE_*`, continua a usar o PostgreSQL
local e a pasta `/uploads`.

## Espaço de Gestão (`/workspace.html`)

Além da Administração da plataforma (só para administradores), qualquer membro
tem agora acesso a um espaço próprio, com o âmbito limitado ao que lhe pertence:

- **Equipas** — só as equipas ligadas aos projetos de que faz parte
- **Projetos** — os seus projetos, com atalho direto para o quadro
- **Minhas tarefas** — todas as tarefas atribuídas a si, em todos os projetos, com link direto para cada uma
- **Membros** — colegas de equipa, agrupados por projeto
- **Relatórios** — resumo pessoal (concluídas, atrasadas, por prioridade) e exportação em CSV
- **Reuniões** — marcar reuniões num projeto (todos os membros são notificados automaticamente), com lista de próximas e já realizadas

## Conta: Google, recuperação de password e força da password

**Se já tinha uma versão anterior instalada**, aplique `db/migration_v13.sql` no pgAdmin
(adiciona `google_id`, a preferência de e-mail e a tabela `password_resets`) e execute
`npm install` (nova dependência: `google-auth-library`). Instalações novas só precisam do `schema.sql`.

### Barra de segurança da password (criar conta e redefinir password)
Ao escrever a password, uma barra de progressão mostra o nível — *Muito fraca, Fraca,
Razoável, Forte, Muito forte* — com base no tamanho (8+ e 12+), maiúsculas e minúsculas,
números e símbolos, e penaliza passwords comuns (`123456`, `password`…) ou repetitivas.
Uma lista de requisitos vai ficando marcada a verde. O botão "Criar conta" só ativa a partir
de **Razoável**, e o servidor repete a mesma validação (a regra está num único ficheiro,
`public/js/password-strength.js`, usado pelo navegador e pelo servidor). As contas já
existentes (ex.: `123456` do seed) continuam a entrar normalmente — a regra aplica-se ao
criar conta e ao redefinir a password.

### Recuperação de conta ("Esqueceu a password?")
1. No ecrã de entrada, "Esqueceu a password?" → `/esqueci-senha.html` → indica o e-mail.
2. A plataforma envia um e-mail com uma ligação para `/redefinir-senha.html?token=…`
   (válida **60 minutos**, **uso único**; na base de dados guarda-se só o hash do token).
3. A pessoa escolhe a nova password (com a mesma barra de segurança) e volta a entrar.

A resposta é sempre a mesma exista a conta ou não (não revela que e-mails estão registados),
e há limite de pedidos. **Sem Gmail/SMTP configurado**, o e-mail não sai, mas a ligação de
recuperação é escrita na consola do servidor — útil para testar. Quem criou a conta só com
o Google pode usar o mesmo fluxo para definir uma password.

### Configurar o Google (login + e-mails)
Tudo é opcional: sem estas variáveis a aplicação funciona como antes (o botão do Google
simplesmente não aparece).

**A) Entrar com o Google**
1. Em [console.cloud.google.com](https://console.cloud.google.com) crie um projeto.
2. *APIs e serviços → Ecrã de consentimento OAuth*: tipo **Externo**; enquanto estiver em
   "Teste", adicione os e-mails que vão experimentar em *Utilizadores de teste*.
3. *Credenciais → Criar credenciais → ID de cliente OAuth → Aplicação Web*.
   Em **Origens JavaScript autorizadas** adicione `http://localhost:3000` (e o endereço
   público quando publicar).
4. Copie o **ID de cliente** para `GOOGLE_CLIENT_ID` no `.env` (o segredo vai em `GOOGLE_CLIENT_SECRET`).

Quem entra com o Google pela primeira vez fica com conta criada automaticamente (o e-mail
tem de estar verificado pelo Google). Se já existir uma conta com o mesmo e-mail, é associada ao Google e a password antiga é anulada (evita que alguém que se registou antes com o e-mail de outra pessoa fique com acesso à conta dela); a pessoa pode definir uma nova em "Esqueceu a password?". Contas com 2FA ativo continuam a pedir o código da app autenticadora também no login com o Google.
A regra de "sessão única por conta" também se aplica.

**B) Enviar e-mails pelo Gmail (recuperação de conta + notificações de projeto)**

O envio usa a **Gmail API por HTTPS**. (O plano gratuito do Render bloqueia as portas SMTP, por isso
o SMTP só serve para testar no seu PC.)

1. No mesmo projeto Google, ative a **Gmail API** (*APIs e serviços → Biblioteca → Gmail API → Ativar*).
2. No cliente OAuth do passo A, adicione o URI de redirecionamento
   `https://developers.google.com/oauthplayground`.
3. Em [OAuth Playground](https://developers.google.com/oauthplayground): roda dentada →
   *Use your own OAuth credentials* (ID e segredo do cliente) → no Passo 1 escreva o âmbito
   `https://www.googleapis.com/auth/gmail.send` → *Authorize APIs* com a conta Gmail que vai enviar →
   *Exchange authorization code for tokens* → copie o **Refresh token**.
4. No `.env` (ou nas variáveis do Render): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `GMAIL_USER` (a conta que autorizou) e `GMAIL_REFRESH_TOKEN`.
   > Com o ecrã de consentimento em modo "Teste", o Google expira o refresh token ao fim de
   > 7 dias; para o manter, passe a aplicação a "Em produção" (para uso próprio basta).
5. Defina `APP_URL` com o endereço real da aplicação (entra nas ligações dos e-mails).

*Alternativa só para o seu PC:* SMTP com "palavra-passe de aplicação" (`SMTP_HOST`, `SMTP_USER`,
`SMTP_PASS`; ver "Configurar o envio de feedback por e-mail"). Se a Gmail API estiver configurada, tem prioridade.

### Notificações de projeto por e-mail
Cada notificação que aparece no sino (tarefa atribuída, comentário, menção, convite,
reunião, prazo, anúncio…) segue também por e-mail para o endereço da conta, com um botão que
abre direto o projeto/tarefa. Cada pessoa pode desligar isto em **Espaço de Gestão → Visão
geral → "Notificações por e-mail"**. Com `EMAIL_APENAS_OFFLINE=true` só recebe e-mail quem
não está online nesse momento. O envio corre em segundo plano — se o e-mail falhar, a
notificação em tempo real não é afetada.

## Possíveis extensões futuras

- Sincronização de dados em segundo plano quando a app volta a ficar online
  (o modo offline atual só mantém as páginas já visitadas acessíveis, não
  sincroniza ações feitas sem ligação)
- Vista de "Mapa Mental" para organizar tarefas (ClickUp)
- Integração com calendários externos (Google Calendar/Outlook)
