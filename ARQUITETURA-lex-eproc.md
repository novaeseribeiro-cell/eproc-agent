# Arquitetura — peticionamento pelo LEX, conferência e protocolo no eproc

Documento de desenho. Escrito em 11/09/2026, depois do mapeamento das telas do eproc TJMS.
Complementa `HANDOFF-eproc-agent.md` (seção 7.6 em especial). Dono: Roney Ribeiro / NR Soluções Jurídicas.

---

## 1. A premissa que mudou

O plano antigo supunha que o CRM teria que construir a tela de conferência e a fila de protocolo.
Não precisa. O eproc já tem as duas:

- `controlador.php?acao=peticao_inicial_preparada_listar` — "Petições Iniciais pendentes de distribuição"
- checkbox por linha, "Carregar os dados da petição", "Excluir Petição", e um `#btnDistribuir` no rodapé

Quem prepara enche essa fila. Quem distribui é o advogado, dentro do tribunal, com trilha de auditoria do
próprio tribunal. É exatamente o que o art. 12 da Res. 383/2025 desenha.

**Consequência:** o CRM não replica a fila do eproc. O CRM cuida de tudo que acontece ANTES dela.

---

## 2. As duas conferências

O erro de projeto mais provável aqui é imaginar uma conferência só. São duas, em momentos diferentes,
com naturezas diferentes:

| | Conferência de DADOS | Conferência do ATO |
|---|---|---|
| Onde | dentro do LEX | dentro do eproc |
| O quê | o que a IA extraiu da petição bate com a petição? | a ação preparada está correta? |
| Quando | antes de qualquer acesso ao tribunal | depois da preparação |
| Quem | advogado ou secretária | advogado (é ato privativo) |
| Custo | alto no começo, cai com o tempo | baixo, e em lote |
| Se erra | corrige no CRM, zero acesso ao tribunal | Excluir Petição e refaz |

A primeira é onde mora o ganho de escala: **errar no CRM é grátis, errar no eproc custa acesso ao tribunal.**
Toda validação possível tem que acontecer antes de abrir o navegador.

---

## 3. Componentes

```
[ Entrada ]                [ LEX (nuvem) ]                 [ Máquina do escritório ]        [ TJMS ]
WhatsApp/Isabella  ──►  intake + extração IA         ┌──►  Agente Local (daemon)      ──►  eproc
pasta de PDFs      ──►  validação offline (catálogo) │      - lê PDFs do disco             (sessão do
upload no CRM      ──►  conferência de DADOS  ───────┘      - Playwright                    ASSISTENTE)
                        fila `protocolos`         ◄──┐      - cadência, 1 por vez
                        reconciliação             ◄──┘      - prints locais                      │
                                                                                                  ▼
                                                            [ advogado, 1 visita por lote ]  fila de
                                                            confere e clica Distribuir      preparadas
```

**1. LEX (nuvem — Supabase/Vercel).** Intake, extração, validação, conferência de dados, fila, painel de status,
reconciliação. **Nunca guarda PDF.** Guarda manifesto: caminho, tipo, sigilo, sha256, bytes.

**2. Agente Local (daemon na máquina do escritório).** É o `eproc-agent` de hoje, virado do avesso: em vez de
`npm run preparar -- pedido.json`, ele faz *long polling* na fila do LEX. Só conexões de saída, nenhuma porta
aberta. Lê os PDFs do disco, dirige o navegador, devolve status e hashes.

**3. eproc.** Recebe as preparações. Guarda a fila. Registra quem criou e quem distribuiu.

**4. Advogado.** Abre a fila uma vez por lote, confere, seleciona, distribui.

---

## 4. O modelo de sessão (revisado em 11/09/2026)

**O agente nunca faz login. Ele herda a sessão que o advogado abriu.**

Isso não é escolha de arquitetura, é imposição do sistema: a tela de login do eproc afirma que o 2FA é
obrigatório para usuário externo e **não pode ser desativado**. Logo, nenhum login é automatizável — nem o do
advogado, nem o de um assistente. Sempre haverá uma pessoa autenticando no início. É o que o `npm run login`
já faz hoje.

O modelo, então:

- o advogado autentica na própria sessão (certificado com PIN, ou senha + 2FA);
- o Agente Local dirige o navegador **dentro dessa sessão**, na máquina dele;
- nenhuma credencial, certificado ou chave privada sai da máquina, e nenhuma vai para a nuvem;
- ele dispara o lote e vai fazer outra coisa; a sessão fica ocupada naquela máquina até terminar.

Isso deixa de ser "robô com credencial emprestada" e passa a ser "advogado usando uma ferramenta". A
diferença é jurídica e é a diferença que importa.

**Custo aceito:** o agente não pode rodar numa máquina enquanto o advogado trabalha em outra — mesmo usuário,
duas sessões, é o que o TJMS trata como robô. Com cadência de 300 s, 40 ações ocupam ~3h30 de máquina.
Roda à tarde, distribui no dia seguinte.

### 4.0 Por que o certificado não "trafega" até o eproc

Ideia recorrente e que não funciona: o advogado logar no CRM com o certificado e o CRM repassar ao tribunal.

- **A3 (token/cartão):** a chave privada é não-exportável por construção. Nenhum sistema web a recebe. A
  assinatura tem de ocorrer na máquina onde o token está. É exatamente por isso que existem Web Signer,
  PJeOffice e Lacuna Web PKI — pontes locais, porque não há outro caminho.
- **A1 (arquivo):** subir para servidor é entregar a credencial a terceiro. Não construir.

Em qualquer desenho sobra um componente local na máquina do advogado. A pergunta nunca é *se* ele existe, é
*com o que ele conversa do outro lado* — navegador hoje, API se um dia houver (seção 4.3).

### 4.1 O caminho do assistente, e por que foi abandonado (registro)

`controlador.php?acao=usuario_assessor_advogado_listar` — "Gerenciamento de Assistentes". Hoje:
"Não há assistente cadastrado." O botão Novo leva a `usuario_assessor_advogado_cadastrar_1`, que pede
**um único campo: "Login do Assistente"** (`#txtUsuarioSiglaAnalista`), um autocomplete por AJAX sobre
usuários **já existentes** (`#hdnIdUsuarioSiglaAnalista` só é preenchido quando um usuário real é escolhido;
`transportar()` monta a linha e `#sbmAssociarAnalistaAdvogado` grava).

**Ou seja: o advogado não cria o assistente. Ele associa um login que já existe.** O assistente precisa ter
conta própria de usuário externo no eproc — autocadastro, dados próprios, 2FA próprio.

Três razões, em ordem de peso:

1. **Não cura o defeito, transfere.** O art. 10 não fala de *qual* credencial; fala de entregar credencial a
   software. Trocar a do advogado pela do assistente move o risco para um funcionário que não é o
   beneficiário do negócio.
2. **O art. 12 trata de preposto, que é pessoa.** Autoriza delegar a inserção de peças a alguém habilitado.
   Estender isso a software é ponte construída por nós, não pelo texto.
3. **Não resolvia nada de automação.** Com 2FA obrigatório, o assistente também precisaria de um humano
   autenticando. O ganho seria só poder rodar em máquina separada — logística, não direito.

Fica o registro operacional, para não se reabrir a discussão: hoje **não há assistente cadastrado** na conta,
e a tela `usuario_assessor_advogado_cadastrar_1` tem campo único "Login do Assistente"
(`#txtUsuarioSiglaAnalista`, autocomplete AJAX; o oculto `#hdnIdUsuarioSiglaAnalista` só é preenchido ao
escolher um usuário real). **O advogado não cria o assistente: ele associa um login que já existe.** Ou seja,
seria preciso uma pessoa real se autocadastrar, com dados e 2FA próprios, para um robô operar a credencial
dela. Caminho descartado.

### 4.2 A pergunta ao TJMS (reformulada)

Com o modelo da seção 4, a pergunta ao `eprocnegocial@tjms.jus.br` fica mais simples e com muito mais chance
de resposta positiva, porque descreve uma ferramenta e não um robô com credencial de terceiro:

> O advogado, autenticado na própria sessão do eproc, pode utilizar ferramenta local — rodando na máquina do
> escritório, sem compartilhamento de credencial com terceiros — que preencha o formulário de petição inicial
> e a deixe na fila de "Petições Iniciais pendentes de distribuição", permanecendo a distribuição como ato
> manual do próprio advogado? Não há consulta processual em massa: as consultas se limitam às partes de cada
> ação em cadastro.

Texto completo em `EMAIL-eprocnegocial.md`. Enquanto não houver resposta escrita, não vender.

### 4.3 A camada de transporte é trocável

O `Pedido` validado, a fila e o CRM não sabem como a ação chega ao tribunal. Hoje o driver é navegador. Se um
dia houver via oficial de integração, entra outro driver e nada mais muda:

```
nr-protocolo-core/     tipos (Pedido, Parte, Documento), validação, fila,
                       extração, evidência, cadência, reconciliação
  └─ driver-eproc/     Playwright + tribunais/tjms.json
  └─ driver-pje/       a definir (ver projeto separado do agente PJe)
```

O `PerfilTribunal` já é essa ideia aplicada aos seletores. Isto é o mesmo princípio um nível acima.
**Não forkar o repositório por tribunal** — o handoff já registra o custo de cópias divergentes.

---

## 5. Fluxo de uma ação

1. **Intake.** Pasta com os PDFs cai no LEX (ou o WhatsApp da Isabella abre o caso).
2. **Extração.** IA lê a petição e devolve: qualificação completa das partes, comarca, classe, assunto,
   valor da causa, tipo de cada documento — e `pendencias[]` por campo obrigatório ausente.
3. **Validação offline.** Contra `catalogo/tjms.json`. Comarca/rito/área/classe têm que casar EXATO.
   Assunto vira **código CNJ** (ex.: `022003`), não texto. Nada disso toca o tribunal.
4. **Conferência de dados no LEX.** Tela lado a lado: PDF da petição à esquerda, campos extraídos à direita,
   `pendencias` em vermelho no topo. O revisor corrige e aprova. Status vai para `pronto`.
5. **Fila.** O Agente Local puxa uma ação por vez, respeita cadência (padrão 300 s), teto por rodada (40).
6. **Preparação.** As 5 etapas. Para no modal de resumo, tira print, confere que há documentos, confirma.
   Nunca Finalizar, nunca Distribuir.
7. **Evidência.** Prints por etapa + o print do "Resumo das Informações" ficam na máquina local.
   O LEX guarda só o caminho e o hash. Status vira `preparada`.
8. **Conferência do ato.** O advogado abre a fila do eproc, seleciona e distribui.
9. **Reconciliação.** Ver seção 7.

---

## 6. Dados no LEX

```
protocolos
  id, caso_id, tribunal, status, tentativas
  status: rascunho | extraido | pendente_revisao | pronto | preparando
          | preparada | distribuida | erro | abortada
  pedido            jsonb   -- o Pedido validado (comarca, rito, area, classe, assunto_codigo, partes, valor)
  chave_idem        text    -- sha256(cpf_autor|cpf_reu|classe|assunto_codigo|valor) — anti-duplicidade
  id_peticao_eproc  text    -- id_peticao_pendente devolvido pela fila de preparadas
  numero_processo   text    -- preenchido na reconciliação
  erro_codigo, erro_texto, tela_erro_path

protocolo_documentos
  protocolo_id, ordem, caminho_local, tipo_eproc, sigilo, sha256, bytes
  -- nunca o arquivo

protocolo_eventos
  protocolo_id, etapa, ts, ok, mensagem, print_path, print_sha256
  -- trilha completa; é isso que se mostra ao cliente e, se preciso, ao tribunal
```

`chave_idem` é o que impede preparar a mesma ação duas vezes quando o agente cai no meio e reinicia.
Antes de preparar, o agente checa a fila de preparadas do eproc **e** a chave no LEX.

---

## 7. Reconciliação — como o número do processo volta sem consulta em massa

O ponto delicado: descobrir o número do processo distribuído sem varrer o tribunal (art. 10).

A fila de preparadas resolve isso de graça. O agente já a lê no início de cada rodada, para a guarda de
rascunho. Então:

1. Na rodada N, o agente registra os `id_peticao_pendente` presentes na fila.
2. Na rodada N+1, os IDs que **sumiram** foram distribuídos pelo advogado.
3. Só para esses — poucos, identificados, nunca em massa — o agente consulta pelo nome das partes e traz
   o número.

É uma consulta por ação efetivamente ajuizada, disparada por um ato do próprio advogado. Não é varredura.
Alternativa ainda mais limpa, se o volume justificar: o advogado cola os números uma vez, ou o LEX recebe
pelo Domicílio Judicial Eletrônico quando a citação sai.

---

## 8. O que reduz a visita do advogado a uma por lote

- **Preparar em lotes alinhados ao ritmo dele.** 20 por noite, ele distribui de manhã, em bloco, com os
  checkboxes. Não faz sentido preparar 400 de uma vez: 400 linhas para conferir de uma vez é pior que
  20 por dia.
- **Pacote de conferência.** Para cada ação, o LEX gera uma página única com: print do Resumo do eproc,
  os campos extraídos, e o trecho da petição de onde cada campo veio. Ele confere no LEX em segundos e no
  eproc só clica. A conferência do ato vira verificação por amostragem, não leitura.
- **Semáforo.** Ação que passou na validação offline e cujo Resumo bateu com o Pedido entra verde. Ação com
  qualquer divergência entra vermelha e vai para revisão manual. Ele olha as vermelhas.

---

## 9. O experimento que decide tudo (fazer ANTES de escrever código)

Todo este desenho depende de respostas que ainda não temos. Estado em 11/09/2026:

**Passo 0 — PENDENTE, e bloqueia os demais.** Não existe assistente cadastrado, e a tela de associação só
aceita login de usuário **já existente** (seção 4.1). Alguém precisa se autocadastrar como usuário externo
no eproc para que exista um login a associar. Isso é ato pessoal, com dados e 2FA próprios: não é algo que
o agente nem o Claude façam. Decidir **quem** será esse assistente é a primeira decisão de negócio, não de
software — é uma pessoa real assumindo uma credencial pessoal.

Feito o passo 0:

1. Associar o login pelo menu "Associar Assistente ao Advogado".
2. Logar como assistente, em outra máquina/perfil, **ao mesmo tempo** que o advogado (usuários diferentes).
3. O assistente enxerga "Petição Inicial"? Completa as 5 etapas? Tem `#btnSalvarDistribuicao`?
4. **A petição preparada pelo assistente aparece no painel do ADVOGADO**, em "Processos pendentes do advogado"?
   (a coluna "Criado por" na fila sugere fortemente que sim, mas é preciso ver)
5. O assistente enxerga `#btnDistribuir`? Se **não** enxergar, a separação de atos é imposta pelo tribunal e
   não só pelo nosso código — isso é argumento de venda e de defesa.

Se 4 der sim, o produto é exatamente o que o Roney descreveu. Se der não, o agente precisa rodar com a conta
do advogado, e aí volta a restrição de sessão única e a operação passa a ser noturna.

Em paralelo ao passo 0, mandar a pergunta da seção 4.2 ao eprocnegocial. As duas coisas correm juntas: o
teste diz se **funciona**, o e-mail diz se **pode**. Vender antes das duas respostas é assumir um risco que
recai sobre o cliente — um escritório com 400 ações paradas não pode levar bloqueio de usuário.

**Não construir o CRM em cima da hipótese. Testar primeiro.**

---

## 10. Riscos e o que fazer com cada um

| Risco | Mitigação |
|---|---|
| Tela do eproc muda | perfil de tribunal é contrato; `discover` + editar `tribunais/tjms.json`, não o código |
| Agente cai no meio da preparação | `chave_idem` + leitura da fila de preparadas antes de cada ação |
| PDF movido ou alterado no disco | sha256 no manifesto; diverge, aborta e marca `erro` |
| Bloqueio por volume (art. 10) | cadência, teto por rodada, zero consulta especulativa, reconciliação só do que sumiu da fila |
| Extração da IA erra qualificação | `pendencias[]` obrigatória por campo; nada vai para a fila sem revisão humana aprovando |
| Documento errado anexado | validação de `#hdnNumDocumentos` antes do upload + conferência do Resumo antes de confirmar |
| IA nativa do TJMS come o diferencial | reposicionar: o valor é o lote, os documentos locais e a credencial local — não a extração |

---

## 11. Ordem de construção

1. Experimento da seção 9. **Bloqueia tudo.**
2. Tarefas 2 a 8 da fila do Claude Code (ver HANDOFF seção 8) — o agente confiável, ainda por arquivo.
3. Tabelas do LEX + endpoint de fila (`GET /proximo`, `POST /evento`, `POST /resultado`).
4. Agente Local: trocar CLI por long polling. Nada mais muda no núcleo.
5. Tela de conferência de dados no LEX.
6. Reconciliação.
7. Pacote de conferência e semáforo.
8. Intake por WhatsApp.
