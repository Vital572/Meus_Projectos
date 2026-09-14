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
- **Base de dados**: PostgreSQL local (schema `gpitrack`), gerida através do pgAdmin.
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
    ├── index.html              # Login / Registo
    ├── projetos.html           # Lista de projetos
    ├── board.html               # Quadro Kanban em tempo real
    ├── admin.html                # Painel de administração
    ├── css/styles.css
    └── js/ (api.js, board.js, admin.js, notifications.js)
```

## Funcionalidades implementadas

**Colaboração em tempo real**
- Registo e autenticação de utilizadores (JWT em cookie httpOnly)
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

## Espaço de Gestão (`/workspace.html`)

Além da Administração da plataforma (só para administradores), qualquer membro
tem agora acesso a um espaço próprio, com o âmbito limitado ao que lhe pertence:

- **Equipas** — só as equipas ligadas aos projetos de que faz parte
- **Projetos** — os seus projetos, com atalho direto para o quadro
- **Minhas tarefas** — todas as tarefas atribuídas a si, em todos os projetos, com link direto para cada uma
- **Membros** — colegas de equipa, agrupados por projeto
- **Relatórios** — resumo pessoal (concluídas, atrasadas, por prioridade) e exportação em CSV
- **Reuniões** — marcar reuniões num projeto (todos os membros são notificados automaticamente), com lista de próximas e já realizadas

## Possíveis extensões futuras

- Autenticação multifator e recuperação de password
- Vista de linha do tempo (Gantt) e calendário
- Notificações por e-mail
- Relatórios de produtividade por membro da equipa
- Anexos de ficheiros nas tarefas
