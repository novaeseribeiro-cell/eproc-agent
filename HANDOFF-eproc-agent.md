# HANDOFF — Agente de protocolo eproc (TJMS)

LER ESTE ARQUIVO ANTES DE QUALQUER COISA. Vale para Claude (chat ou Cowork) e para Claude Code.
Ultima atualizacao: 11/09/2026 (sessao de mapeamento no navegador). Dono: Roney Ribeiro (NR Solucoes Juridicas).

---

## 1. O que e este projeto, em tres linhas

Agente que cadastra uma acao nova no eproc do TJMS, pelo navegador (Playwright), a partir de uma pasta de PDFs,
e para antes do botao Finalizar. O advogado confere e finaliza. Primeiro cliente: uma colega advogada com
cerca de 400 acoes bancarias praticamente iguais, documentacao completa, paradas por falta de tempo para cadastrar.

O produto comercial e o LEX Legal Hub (CRM do Roney) entregue inteiro, com este agente dentro, em venda unica
mais suporte, sem assinatura. Preco cogitado: R$ 50 mil por tudo, vendido como resultado (400 acoes destravadas).

---

## 2. Regras que nao se negociam

1. O agente NUNCA clica em Finalizar (`#btnSalvar[name=sbmProcessoEtapa4]`) nem em Distribuir
   (`#btnDistribuir` na lista de preparadas). Os dois atos sao do advogado.
2. Nos campos que definem competencia (comarca, rito, area, classe) so correspondencia EXATA. Sem "mais parecido".
   Duas heuristicas de aproximacao escolheram area errada e custaram acessos ao tribunal.
3. Nunca navegar para URL interna do eproc sem `hash` de sessao. Responde "Link sem assinatura" e derruba a sessao.
   Sempre ler o href do menu e navegar por ele. A URL base `/eproc/` (sem `acao=`) e segura.
4. Documentos ficam no computador do advogado. Nada de PDF em Supabase/nuvem. O LEX guarda caminho, tipo, sigilo e hash.
5. **O agente nunca faz login. Ele herda a sessao que o advogado abriu.** Esta e uma ESCOLHA DE PRODUTO,
   nao uma limitacao tecnica — ver a correcao abaixo. O modelo e: o advogado autentica (certificado ou
   senha + 2FA), a ferramenta preenche formulario dentro da sessao dele, e ele finaliza.

   **CORRECAO TECNICA, 11/09/2026.** A versao anterior desta regra afirmava que "o 2FA obriga um humano no
   inicio de qualquer sessao, entao nenhum login e automatizavel". **ISSO ESTA ERRADO.** TOTP e HMAC sobre
   uma semente e o tempo: quem detem a semente gera codigos indefinidamente, sem pessoa nenhuma. O Roney
   ja opera assim numa VPS (A1 + semente sincronizada) para outras finalidades. Login desatendido no eproc
   e tecnicamente possivel.

   **A decisao de nao usar isso no produto foi tomada de propria vontade, em 11/09/2026, e os motivos sao
   estes — leia antes de "melhorar" o agente com login automatico:**
   - Guardar A1 + semente TOTP num servidor e exatamente a forma que o art. 10 descreve como uso inadequado
     (fornecimento de credencial a software). Nao importa de quem e o servidor.
   - O 2FA obrigatorio vem da Portaria 140/2024 do CNJ e existe para amarrar o acesso a uma PESSOA.
     Replicar a semente num servidor nao burla nada tecnicamente, mas esvazia o controle.
   - **Colapsa o diferencial comercial.** Projuris, N3, Legis e NewLex guardam certificado em nuvem e
     submetem pelo cliente. O nosso argumento de venda e ser o oposto: documentos locais, credencial local,
     ato final na fila do proprio tribunal. Com credencial em servidor viramos mais um deles, sem a escala
     deles.
   - Uma coisa e o Roney decidir o risco da propria inscricao. Outra e pedir que a cliente ponha o A1 e a
     semente dela num servidor: se der errado, o art. 10 preve bloqueio TOTAL do usuario, e quem tem 400
     acoes em curso e ela.

   **REGRA ANTERIOR TAMBEM REVOGADA:** a versao mais antiga mandava usar credencial de assistente
   habilitado. Nao usar. Motivos: (a) o art. 10 nao fala de qual credencial, fala de entregar credencial a
   software — trocar de credencial so transfere o defeito para um funcionario que nao e o beneficiario;
   (b) o art. 12 trata de preposto, que e pessoa, e usar isso para autorizar software e ponte construida
   por nos.

   O que se perde com a escolha: o agente nao pode rodar numa maquina enquanto o advogado trabalha em
   outra (mesmo usuario, duas sessoes) e a maquina fica ocupada durante a rodada. Aceitavel: abre a sessao,
   dispara o lote, vai fazer outra coisa.

6. Cadencia: uma acao por vez, pausas entre acoes (padrao 300 s), no maximo 40 por rodada. Sem rajadas.
7. NUNCA duas sessoes do mesmo usuario abertas ao mesmo tempo. A propria tela de login do TJMS avisa que acesso
   simultaneo do mesmo usuario em varias maquinas e tratado como robo e pode bloquear o usuario. Se o advogado
   estiver logado no navegador dele, o agente nao roda.
8. Antes de cada execucao: verificar pendencias (secao 7.6) e limpar a tabela de documentos da etapa 5.
9. Nunca inventar seletor. Se a tela mudou, rodar `discover` e calibrar `tribunais/tjms.json`.

---

## 3. Estado real hoje (11/09/2026)

### Funciona (validado por execucao no TJMS)
- Login manual com certificado, sessao reaproveitada pelo perfil persistente do Chromium.
- Entrada na Peticao Inicial pelo href do menu.
- Etapa 1 (comarca, rito, area, classe, sigilo, valor) com espera dos selects encadeados.
- Etapa 2 (assunto) — agora por ID de no da arvore, deterministico (secao 7.2).
- Etapas 3 e 4 (autor e reu por CPF/CNPJ, principal, qualificacao, justica gratuita).
- Etapa 5: marcacoes e upload com tipo selecionado por teclado (ArrowDown + Enter).
- Catalogo offline por comarca e validacao sem acessar o tribunal.
- Captura da tela "Erro" do tribunal nas trocas de etapa.

### RESOLVIDO nesta sessao
- **Rascunho preso (relatorio-16.pdf).** Era server-side, preso a conta, nao ao perfil do navegador
  (confirmado: navegador novo, cadastro novo, e a tabela ja nasceu com os dois arquivos).
  Causa do X nao funcionar: `excluirDocumento()` chama `confirm()`, e o Playwright dispensa dialogos por padrao,
  entao o confirm retornava `false`. **Correcao: `page.on('dialog', d => d.accept())` antes de clicar.**
  Os dois arquivos (relatorio-16.pdf de 07/09 e procuracao.pdf de 08/09) foram excluidos a mao em 11/09.
  A conta esta limpa.
- **Erro de competencia ("combinacao entre LOCALIDADE, CLASSE, ASSUNTO e COMPETENCIA nao pode resultar em mais
  do que uma ocorrencia"). NAO se repetiu.** A mesma combinacao (Bonito / Juizado Especial Estadual /
  Juizado Especial Civel / PROCEDIMENTO DO JUIZADO ESPECIAL CIVEL / assunto 022003 / R$ 5.000,00) passou
  etapa 1 -> 2 -> 3 -> 4 -> 5 sem erro, feita a mao. **Nao e regra do tribunal, e estado.** Hipotese mais
  provavel: o agente selecionou o no errado da arvore de assunto (existem tres "Indenizacao por Dano Moral",
  em Direito Administrativo, Direito Civil e Direito do Consumidor) e a combinacao resultante era ambigua.
  A correcao da secao 7.2 (selecao por codigo CNJ) elimina essa classe de erro.
- **Tela "Novo" (cadastro de parte inexistente) mapeada.** Secao 7.4.
- **"Salvar para Distribuicao Futura" executado pela primeira vez, ponta a ponta.** Secao 7.5 e 7.6.

### VALIDADO EM EXECUCAO REAL — 10/09/2026, noite (horario de MS)

Os sete pacotes de `PACOTES-claude-code.md` foram implementados E exercitados contra o TJMS, um a um.
Rodar exige macOS (Terminal do Roney): o Playwright do projeto tem browsers de macOS; o shell do Cowork
e uma VM Linux e falha com "Executable doesn't exist".

| Pacote | Como foi provado |
|---|---|
| P0 assuntoCodigo | `validar` passa; pedido sem o campo e com 5 digitos sao rejeitados pelo zod |
| P1 aceitar dialogo | `[dialogo aceito] confirm: Confirma exclusao do Documento "..."` disparado pelo AGENTE, no caminho automatico |
| P2 assunto por codigo CNJ | saiu `022003 - INDENIZACAO POR DANO MORAL, RESPONSABILIDADE CIVIL, DIREITO CIVIL`, ramo certo |
| P3 guarda de residuais | leu `2 (peticao-inicial.pdf, procuracao.pdf)`, abortou com `limparResiduais:false`; limpou e seguiu com `true` |
| P4 erro do tribunal | rodou apos cada consulta sem falso positivo; pegou a recusa real do upload |
| P5 cadastrarParteNova | **NAO exercitado** — as duas partes de teste ja existem na base |
| P6 distribuicao futura | `alert: O processo foi salvo com sucesso`; resumo capturado inteiro em `resumoConfirmacao` |
| P7 fila de preparadas | listou as 2 preparadas com id limpo, partes, assunto, data e criador |

**Erro de competencia nao voltou em nenhuma das rodadas.** Confirma o diagnostico: era o no errado da
arvore de assunto, nao regra do tribunal.

**Regra 1 respeitada em todas as rodadas.** Nunca clicou em Finalizar nem em Distribuir.

#### Bugs encontrados e corrigidos nesta bateria
1. `cli.ts` abria o navegador no topo de `main()`, entao `validar` — que imprime "nenhum acesso ao tribunal
   foi feito" — subia Chromium com o perfil de sessao. Agora abre sob demanda.
2. Guarda de residuais lia `#hdnNumDocumentos` (client-side, vem zerado) e lia antes do AJAX montar a tela.
   Ver secao 7.5. Sintoma: o tribunal barrando com `Ja foi inserido um documento com o tipo 'Peticao Inicial'`.
3. `alert()` de recusa era aceito em silencio pelo handler e o agente seguia como se tivesse enviado.
   Agora vira `EtapaError` com o texto do tribunal dentro.
4. Mensagem final do `preparar` mandava clicar em Finalizar mesmo quando a acao ja tinha sido preparada.
   Agora e por status.

### Sessao de 11/09/2026, manha — lote pronto para receber as 400

O `lote.ts` tinha ficado para tras das mudancas de schema e quebraria em TODA linha (o `PedidoSchema`
passou a exigir `assuntoCodigo` e o `montarPedido` nao mandava esse campo). Corrigido, com quatro
mudancas que valem registro:

1. **`assuntoCodigo` virou coluna da planilha**, preenchida a partir do modelo durante a varredura.
   O advogado ve, linha a linha, qual no da arvore sera marcado, e pode trocar uma linha sem bifurcar
   o modelo. Linha sem codigo para no `montarPedido` com mensagem dizendo como descobrir o codigo —
   adivinhar assunto por texto foi exatamente o que gerou o erro de competencia.
2. **`assunto_declarado`**: a extracao passou a devolver como a PROPRIA peticao se nomeia. Se a peticao
   diz uma coisa e o modelo cadastra outra (comparacao por prefixo de 5 letras, para "Contratos
   Bancarios" casar com "contrato bancario" sem casar com "dano moral"), a linha e marcada CONFERIR.
   Barato, e e a unica defesa automatica contra rodar 400 acoes no assunto errado.
3. **`autor_nascimento`**: a data de nascimento e, depois do CPF, o unico separador de homonimo.
   Entrou como campo proprio da Parte (`dataNascimento`), separado da `qualificacao` — a qualificacao
   completa continua sendo exigida para CADASTRAR parte nova (P5), mas exigi-la so para conferir
   travaria as 400, porque peticao traz data de nascimento e quase nunca traz sexo/estado civil.
4. **`pendencias[]` da extracao** entram direto na coluna de observacoes e derrubam o `aprovado`
   automatico.

Testes: 13/13 (dois casos novos cobrem a data de nascimento no nivel da parte, que e o caminho do lote).

### `modelo-bancaria.json` — o que esta verificado e o que nao esta

- `assuntoCodigo: 02190338` (DIREITO CIVIL > Obrigacoes > Especies de contratos > Contratos Bancarios)
  **verificado na arvore do eproc**, comarca Bonito, area Juizado Especial Civel, em 11/09/2026.
  Ficou so no rito JUIZADO ESPECIAL ESTADUAL, que foi onde foi visto.
- `assuntoRamo` foi corrigido de DIREITO DO CONSUMIDOR para DIREITO CIVIL. O ramo anterior nunca foi
  confirmado e a varredura do termo "Contratos Bancarios" devolveu 4 nos, todos sob DIREITO CIVIL.
  **Alinhar o modelo ao que o tribunal oferece nao decide o enquadramento — isso e do advogado.**
- RITO ORDINARIO (COMUM) ficou **sem** `assuntoCodigo` de proposito: a arvore muda com a competencia.
- Os CNPJs de `reusConhecidos` continuam **nao conferidos em fonte oficial**. Nao e risco silencioso:
  a etapa 3 consulta o CNPJ, o tribunal devolve a razao social da base dele, e a conferencia P8 trata
  divergencia de nome de pessoa juridica como GRAVE. CNPJ errado aborta na primeira acao; nao distribui
  400 contra o banco errado.
### A peticao real (11/09/2026) — o que ela resolveu e o que nao resolveu

Amostra: inicial de 23/07/2026, pensionista viuva x BANCO AGIBANK S.A., 17 paginas.
(Nome e CPF da autora ficam so na maquina, em exemplos/amostra/ — pasta fora do versionamento.)
Fica em `exemplos/amostra/` (pasta no .gitignore — dado de cliente nao vai para o repositorio).
O PDF nunca saiu da maquina do Roney; so o texto necessario foi lido.

**Perfil das 400 (dito pelo Roney):** variam **comarca, banco e valor**. O resto e identico.

**O que a peticao confirmou:**
- Comarca CAMPO GRANDE, **Vara Bancaria** -> a `area` "Cível - Bancária" do `porComarca` estava certa.
- Rito **ordinario**, classe PROCEDIMENTO COMUM CIVEL. Nao e Juizado, embora o valor (R$ 2.815,28)
  coubesse la. A escolha da vara especializada e dela.
- Justica gratuita: sim. Tutela/liminar: **nao** — nenhum pedido de urgencia nos pedidos.
- Reu: BANCO AGIBANK S.A., CNPJ 10.664.513/0001-50 — **nao estava** em `reusConhecidos`. Adicionado.
  Importante: no caminho normal o CNPJ vem do TEXTO da peticao, nao do mapa. O mapa e so fallback.
- Objeto: exibicao incidental + revisao de clausula remuneratoria + repeticao do indebito em dobro,
  sobre emprestimo pessoal de pensionista. E revisional de contrato bancario, sem duvida.

**O que a peticao NAO resolveu — e por que:**
A argumentacao inteira aplica o CDC (inversao do onus, Sumula 530/STJ, art. 400 CPC).
Era dai que vinha o `assuntoRamo: DIREITO DO CONSUMIDOR` do modelo antigo. **Mas aplicar o CDC nao
empurra o assunto para o ramo DIREITO DO CONSUMIDOR**: a tabela do CNJ e taxonomia processual, nao
lei aplicavel. Quem decide e a arvore daquela competencia — e o `02190338` foi visto em
**Bonito / Juizado Especial Civel**, comarca e area diferentes desta. Pode nao existir na Vara Bancaria.

**Consequencia pratica: a comarca virou o eixo do lote, nao o banco.**
Area, classe e arvore de assunto dependem da competencia. Campo Grande tem Vara Bancaria; a maioria
das comarcas nao tem. Antes de rodar, para CADA comarca distinta do lote:
```
npm run catalogo -- "<Comarca>"
npm run assuntos -- <pedido daquela comarca> "Bancarios"   # e "Consumidor", e "Revisao"
```
Hoje so **Bonito** esta catalogada. `npm run validar` ja barra comarca sem catalogo, com a mensagem certa.

**Detalhe que reduz o valor do `autor_nascimento`:** esta peticao qualifica a autora por nacionalidade,
profissao, estado civil e CPF — **sem data de nascimento**. Se as 400 seguem o mesmo modelo, a coluna
vem vazia e a separacao de homonimo fica so no CPF (que ja e GRAVE na P8). O campo continua valendo:
custa nada e endurece a conferencia quando a data aparecer.

- **PENDENTE**: catalogar Campo Grande e varrer a arvore dela antes de qualquer rodada real.

### 11/09/2026, tarde — a virada: de "modelo bancario" para mecanismo generico

Pergunta do Roney: *quantas comarcas sao?* Resposta: **nao se sabe, e o sistema precisa funcionar
para todas, e para qualquer tipo de acao** — nao so bancaria. Isso condenou o desenho anterior, que
dependia de alguem catalogar comarca por comarca a mao e fixar um codigo de assunto no modelo.

**A divisao que passou a reger tudo:**

| o que | onde vive | quem decide |
|---|---|---|
| igual em todas as acoes do tipo | o modelo de acao (JSON) | o advogado, uma vez |
| muda de acao para acao (partes, valor, comarca, documentos) | a planilha do lote | a extracao + conferencia do advogado |
| muda de COMARCA para comarca (area, classe, codigo do assunto) | **ninguem escreve** | o tribunal responde, o agente pergunta |

A terceira linha e a mudanca. Antes, area/classe/assunto eram dado fixo no modelo; agora sao
**resolvidos contra o proprio eproc**, por comarca, e ficam em cache.

**1. Competencia por lista de preferencia** (`escolherCompetencia`, catalogo.ts)
O modelo declara uma ORDEM de `{rito, area, classeCNJ}`. O agente pega a primeira que existir
naquela comarca. Campo Grande tem Vara Bancaria; Dourados nao tem e cai em Civel; Bonito so tem
Juizado e cai na terceira. Comparacao tolerante a acento, caixa e hifen ("Cível - Bancária" ==
"Civel Bancaria"), e devolve os rotulos do TRIBUNAL, nao os do modelo — e o que vai no `<select>`.
Se nenhuma opcao existir, **erra em vez de chutar**, listando o que tentou.
O relatorio diz em que POSICAO da lista caiu: cair na terceira opcao em 300 acoes sem ninguem
perceber seria pior do que parar.

**2. Catalogo de comarca sob demanda** (`garantirComarca`)
Comarca nunca vista se cataloga sozinha, na hora, com a tela 1 ja aberta. Uma varredura de selects
por comarca, uma vez na vida do catalogo. Acabou a exigencia de saber a lista de comarcas de antemao.

**3. Assunto resolvido na arvore, com cache por comarca** (etapa 2)
`assuntoCodigo` virou **opcional**. Sem ele, o agente filtra a arvore pelo `assuntoPrincipal` e
**so aceita se restar EXATAMENTE UMA folha**. Duas ou mais, ou nenhuma, ele **para aquela comarca**
e lista os candidatos com o caminho completo de cada um — marcando quais batem com o ramo do modelo,
mas **sem desempatar sozinho**: escolher entre nos homonimos sem o advogado ver foi exatamente o que
gerou o erro de competencia. O lote segue nas demais comarcas.
A decisao vai para `catalogo/resolucao-assunto-<tribunal>.json`, chaveada por comarca+area+termo.
**Uma decisao por comarca, nao uma por acao**: 400 acoes em 30 comarcas = no maximo 30 decisoes.
So grava no cache DEPOIS de o tribunal aceitar a selecao.

```
npm run assunto:fixar -- "Campo Grande" "Cível - Bancária" "Contratos Bancários" 02190338
npm run assunto:listar
```

**4. `assuntoRamo` virou opcional (default vazio).**
Vazio desliga a conferencia de ramo. E o certo quando o ramo e justamente o que se quer descobrir —
o caso de Campo Grande. Preenchido, ele CONFERE a folha resolvida; ele nunca DESEMPATA entre folhas.

**5. Modelo de acao virou schema zod (`ModeloAcaoSchema`), validado ao carregar.**
Modelo escrito a mao para um tipo novo de acao falha com mensagem, nao com `undefined` silencioso.
`reusConhecidos` virou `partesConhecidas` (serve para qualquer polo); o formato antigo ainda e aceito.
Ha dois modelos no repo de proposito: `modelo-bancaria.json` e
`modelo-EXEMPLO-outro-tipo.json` (dano moral), identicos em forma, para deixar explicito que
**nada no codigo e especifico de materia**.

**6. Lote deixou de assumir um autor e um reu.**
Colunas `autores` e `reus` no formato `NOME=DOCUMENTO | NOME=DOCUMENTO` — litisconsorcio de
qualquer tamanho, dos dois lados, sem coluna nova. O primeiro de cada polo entra como principal.
A extracao passou a devolver listas.

**7. Novo passo `lote:comarcas`, entre varrer e executar.**
```
npm run lote:varrer   -- ~/Acoes exemplos/modelo-bancaria.json   # offline + IA, le as pecas
npm run lote:comarcas -- lote/Acoes-AAAA-MM-DD.csv exemplos/modelo-bancaria.json   # abre o tribunal
npm run lote:executar -- lote/Acoes-AAAA-MM-DD.csv exemplos/modelo-bancaria.json
```
O passo do meio cataloga toda comarca nova e escreve rito/area/classe em cada linha, e **imprime a
competencia escolhida por comarca**. Existe separado para o advogado ver a escolha ANTES de qualquer
cadastro. `montarPedido` recusa linha sem competencia resolvida.

### Tres bugs que so apareceram quando o Roney tentou rodar (11/09/2026)

Ele colou os tres comandos do fluxo novo. Nenhum era o comando errado — eram bugs reais no caminho.

1. **O `.env` nunca era carregado.** Ninguem chamava dotenv nem `process.loadEnvFile`. O arquivo
   tinha `ANTHROPIC_API_KEY`, `CADENCIA_SEGUNDOS`, `PROFILE_DIR` e `TRIBUNAL` preenchidos e todos
   chegavam `undefined`. O sintoma seria "ANTHROPIC_API_KEY nao definida no .env" com a chave
   visivelmente la dentro — e, pior, a **cadencia caindo no padrao em silencio** numa rodada de 400.
   Correcao: `src/env.ts` com `process.loadEnvFile(".env")`, importado PRIMEIRO em cli.ts e lote.ts.

2. **O classificador de documentos nao reconhecia os arquivos reais dela.**
   A amostra vem como `1_INIC1_marianna.pdf` e `2_PROC1.pdf`; o regex era `/inicial|peticao/` e
   `/procura/`. Resultado: `null` nos dois, e **toda** linha das 400 morreria em "nenhum PDF
   reconhecido como peticao inicial". Nao da para resolver so alargando a lista de palavras —
   nomes de arquivo de escritorio sao imprevisiveis. Agora e em duas camadas:
   nome (barato, com abreviacoes reais: INIC, EXORD, PROC) e, quando o nome nao decide,
   **o TEXTO da primeira pagina** (`tipoPeloTexto`, padroes de forma e nao de materia, entao vale
   para qualquer tipo de acao). O que nem assim se decide volta com tipo nulo e **vira pendencia
   nomeando o arquivo** — nunca chute: chutar tipo faz o tribunal recusar o upload.
   Documento deduzido do texto tambem vai para a coluna de observacoes, para ser conferido.
   Verificado: `1_INIC1_marianna.pdf -> PETIÇÃO INICIAL`, `2_PROC1.pdf -> PROCURAÇÃO`.

3. **Erros saiam como stack trace de Node.** Quem roda isto e advogado. Pasta inexistente,
   planilha inexistente e modelo inexistente agora dizem o que falta e o que fazer; a stack so
   aparece com `DEBUG=1`.

**Estado para rodar:** `ANTHROPIC_API_KEY` esta **vazia** no `.env` — e o unico bloqueio do
`lote:varrer`. Ha um lote de teste de uma acao em `exemplos/amostra/lote-teste/acao-001/`.

**Conhecido, nao corrigido:** a coluna `pasta` da planilha guarda caminho ABSOLUTO. A planilha nao
e portavel entre maquinas (Mac do Roney -> VPS do colega). Resolver antes de entregar.

**Testes:** 21/21 offline (13 de conferencia de partes + 8 de escolha de competencia, incluindo
comarca sem nenhuma das opcoes, comarca nao catalogada, acento/hifen, e classe inexistente na area
preferida forcando a descida na lista).
5. `npm run preparadas` nao existia — o comando estava no `cli.ts` mas faltava o script no `package.json`.
6. O `value` do checkbox da fila vem como `id|autor|reu|assunto`. Usar o `id_peticao_pendente` do href de
   "Carregar", com fallback para o primeiro pedaco antes do pipe. Chave de reconciliacao tem de ser o id puro.

### P8 — CONFERENCIA DA PARTE RETORNADA (11/09/2026)

Implementado e coberto por teste: `npm run teste` (11 casos, `teste/conferencia-partes.mjs`).
**Ainda nao exercitado contra o tribunal.**

Antes disto, divergencia de nome so virava aviso no log. Com os CNPJs do `modelo-bancaria.json` nunca
conferidos, um CNPJ errado incluiria outra empresa como re e ninguem perceberia ate a citacao.
A trava nao conserta o dado: obriga o TRIBUNAL a conferir por nos, a cada acao.

Tres conferencias sobre a linha que o eproc devolve na consulta:

| # | Confere | Gravidade |
|---|---|---|
| 1 | o CPF/CNPJ do pedido aparece na linha | GRAVE, nunca ignoravel |
| 2 | todas as palavras significativas do nome esperado aparecem no retornado | ver abaixo |
| 3 | se o pedido traz `dataNascimento`, ela bate com a da linha | GRAVE, nunca ignoravel |

**Regra do nome, e o porque da assimetria PF/PJ:**
- Nenhuma palavra em comum: GRAVE para qualquer tipo.
- **Pessoa JURIDICA, qualquer palavra faltando: GRAVE.** "BANCO BRADESCO" e "BANCO SANTANDER"
  compartilham o token BANCO — tratar como divergencia parcial deixaria passar banco errado so porque a
  palavra generica bateu. Nome de empresa ou esta certo, ou e outra empresa. Esse caso passou batido na
  primeira versao e so apareceu ao escrever os testes.
- **Pessoa FISICA, palavra faltando: parcial.** Sobrenome a mais ou a menos e plausivelmente erro de
  digitacao. Ignoravel com `"aceitarNomeDivergente": true` naquela parte (default **false**), e a
  divergencia aceita fica registrada no `relatorio.json`.

A conferencia 3 e o que separa homonimos. Nome sozinho nao separa duas pessoas com o mesmo nome; por
isso vale a pena a extracao trazer a data de nascimento sempre que a peticao tiver.

Comparacao normaliza acento e caixa, e descarta palavras vazias (DE, DA, DOS...) e sufixos de empresa
(SA, LTDA, ME, EPP, EIRELI...). Por isso "Serraria Ponte Bonita" casa com "SERRARIA PONTE BONITA LTDA".

### Escrito, mas NUNCA executado
- **P5 `cadastrarParteNova`** — unico pacote nao exercitado. Precisa de uma parte que nao exista na base.
- Modo lote inteiro (`lote:varrer` e `lote:executar`).
- `lote.ts` NAO foi ajustado para os campos novos do Pedido (`assuntoCodigo`, `limparResiduais`,
  `cadastrarSeNaoExistir`). Vai quebrar se usado como esta.

### Bloqueios abertos
- Resposta do TJMS (eprocnegocial@tjms.jus.br): e-mail a enviar (Roney vai mandar em 12/09/2026). A pergunta
  mudou de formulacao depois da revogacao da regra 5 — nao e mais sobre credencial de assistente, e sobre
  ferramenta local operando na sessao do proprio advogado. Texto em `EMAIL-eprocnegocial.md`.
- Nao existe assistente cadastrado na conta, e a tela `usuario_assessor_advogado_cadastrar_1` so aceita
  login de usuario **ja existente** (campo unico `#txtUsuarioSiglaAnalista`, autocomplete AJAX; o oculto
  `#hdnIdUsuarioSiglaAnalista` so preenche ao escolher usuario real). O advogado nao cria o assistente,
  ele associa um login que ja existe. Fato registrado para nao se reabrir a discussao: com a regra 5
  revogada, isso deixou de ser caminho.
- Existe uma peticao preparada de teste na conta do Roney (RONEY x JAQUELINE, criada 10/09/2026 20:21:37,
  sem documentos). Excluir pela lista de preparadas quando nao for mais util.
- **Novo fato a avaliar:** o proprio eproc agora tem IA nativa de extracao de peticao inicial
  (`extracao_peticao_inicial/extrair` e `inteligencia_artificial/peticao_inicial/modal_termo_adesao`,
  mediante termo de adesao). Isso muda o argumento de venda: o diferencial deixa de ser "extrair dados da
  peticao" e passa a ser o cadastro em lote com documentos locais e finalizacao humana.

---

## 3.1 Repositorio (03/10/2026)

**https://github.com/novaeseribeiro-cell/eproc-agent** — PRIVADO. Commit inicial `e379a37`, 30 arquivos.
E a fonte para outro chat ou para a VPS do colega.

Ficam **fora** do versionamento, de proposito, e isso nao e descuido:
- `.perfil-chromium` — sessao do eproc e estado do certificado do advogado. **Nunca versionar.**
- `.env` — segredos. O `.env.example` esta no repo, com os campos vazios.
- `saida/` — prints das telas do eproc com nome e CPF de partes reais.
- `exemplos/amostra/` — peticao real de cliente.
- `lote/` — planilha com partes, CPF e valores.
- `exemplos/pedido-exemplo.json` — pedido com partes reais. O repo leva `pedido-exemplo.template.json`.
- `dist/` — build.

**Os CPFs do repositorio sao sinteticos.** Antes do primeiro commit os testes e o pedido de exemplo
tinham CPF e nome reais (inclusive do proprio Roney e da mae dele), e o HANDOFF trazia o nome completo
da autora da peticao-amostra. Tudo trocado: os testes sao casamento de string e nao dependem do numero.
Quem for mexer: **nao reintroduza documento real em fixture de teste.**

Para quem clonar: `npm install --include=dev`, copie `.env.example` para `.env` e preencha
`ANTHROPIC_API_KEY`, copie `exemplos/pedido-exemplo.template.json` para `pedido-exemplo.json` com
partes que existam na base do tribunal. `npm run teste` roda offline, sem tribunal e sem chave.

---

## 4. Onde as coisas estao

- Projeto local: `/Users/roneyribeiro/AGENTE EPROC-ESAJ-PJE/eproc-agent` (aspas obrigatorias; NAO usar `:` no nome).
- Pasta antiga (referencia): `/Users/roneyribeiro/Documents/NR SOLUCOES JURIDICAS/Agente MS/eproc-agent`.
- Perfil do navegador (sessao): `.perfil-chromium/`. Catalogo: `catalogo/tjms.json` (Bonito capturado).
- Saidas: `saida/<id>/` com prints por etapa e `relatorio.json`. Planilhas de lote: `lote/`.
- Modelo da carteira bancaria: `exemplos/modelo-bancaria.json` (CNPJs dos bancos NAO conferidos; conferir antes de usar).
- Pedido de teste: `exemplos/pedido-exemplo.json` (Bonito / Juizado, CPFs de teste do Roney e da requerida).
- Perfil do tribunal: `tribunais/tjms.json` — recalibrado em 11/09/2026, com backup `.bak-20260911-*`.

---

## 5. Comandos

```bash
npm install --include=dev            # typescript e devDependency; sem --include=dev "tsc: command not found"
npm run login                        # abre o Chromium, faca login com certificado, ENTER no painel
npm run discover                     # loop: navega, ENTER mapeia a tela em saida/, "sair" encerra
npm run catalogo -- "Comarca"        # captura ritos/areas/classes da comarca (uma visita a tela 1)
npm run validar -- pedido.json       # valida contra o catalogo SEM abrir navegador
npm run assuntos -- pedido.json "termo"   # varre a arvore de assunto e devolve os codigos CNJ (le, cancela o cadastro)
npm run preparadas                   # lista a fila "pendentes de distribuicao". Nunca distribui
npm run ler -- arquivo.pdf           # pdftotext -layout: extrai o texto AO LADO do PDF, nesta maquina
npm run preparar -- pedido.json      # roda as 5 etapas; para antes de Finalizar
npm run assunto:fixar -- "Comarca" "Area" "Termo" <codigo>   # resolve ambiguidade de assunto de uma comarca
npm run assunto:listar               # o que ja foi resolvido, por comarca
npm run lote:varrer -- ~/Acoes exemplos/modelo-bancaria.json      # offline + IA: le as pecas, gera a planilha
npm run lote:comarcas -- lote/Acoes-AAAA-MM-DD.csv exemplos/modelo-bancaria.json  # cataloga comarcas, resolve competencia
npm run lote:executar -- lote/Acoes-AAAA-MM-DD.csv exemplos/modelo-bancaria.json
```

Todos os scripts sao `tsc && node dist/...`. NAO usar `tsx`: ele injeta `__name` nas funcoes e quebra `page.evaluate`.

---

## 6. Mapa do codigo

```
src/
  cli.ts           comandos login | discover | catalogo | validar | preparar
  lote.ts          comandos varrer | executar (modo lote, uma pasta por acao)
  agent.ts         prepararAcao: as 5 etapas; abrirPeticaoInicial; incluirParte; anexarDocumento
  browser.ts       abrirNavegador, achar (seletores em cascata), selecionarPorTexto (exato por padrao), esperarOpcoes, screenshot
  catalogo.ts      capturarComarca, validar, carregar/salvar catalogo/<tribunal>.json
  extrair.ts       textoPdf (pdf-parse), extrairDaPeticao (API Anthropic), tipoPeloNome
  login-manual.ts  loginManual: reconhece sessao pela URL (controlador.php sem externo_), pede ENTER
  discover.ts      despeja campos da tela em JSON (script como string, por causa do tsx)
  notificar.ts     POST em WEBHOOK_URL ao terminar
  types.ts         zod: Pedido, Parte, Documento, PerfilTribunal, EtapaError
tribunais/tjms.json  perfil do TJMS: URLs e seletores por chave (calibrado por navegacao real 11/09/2026)
```

Perfil de tribunal = contrato. Quebrou a tela, muda-se o JSON, nao o codigo. Novo tribunal = novo JSON + discover.

---

## 7. Fatos do eproc TJMS que custaram caro descobrir

### 7.1 Geral
- URL real `eproc1g.tjms.jus.br/eproc/`; painel `acao=painel_adv_listar`; inicial `acao=processo_cadastrar`.
- Sessao de certificado expira em minutos. `about:blank` no inicio exige goto para a URL de login.
- O menu lateral abre por `#menu-btn`. "Menu Textual" (`acao=menu_textual`) lista o menu inteiro numa pagina
  so — util para descobrir telas. NAO existe item de menu para "processos nao protocolados" ou
  "distribuicao futura"; a fila de preparadas so aparece pelo painel (7.6).
- Etapa 1: comarca > rito > area > classe recarregam por AJAX em cadeia; a area varia por comarca e por rito
  (Bonito no rito ordinario nao tem "Civel"; no Juizado as areas sao Juizado de Saude, Juizado Especial Civel
  e Juizado Especial da Fazenda Publica).
- Etapa 1: ao escolher a classe aparecem "Processo Originario" e "Juizo" abaixo do Nivel de Sigilo, o que
  DESLOCA o Valor da Causa para baixo. Nunca clicar por coordenada nessa tela; focar por id.
- Consulta por CPF traz dados da Receita (nascimento, mae): pessoa fisica tende a existir sempre.
- Listas do autocomplete e menu lateral ficam fora da viewport: clique nativo do Playwright falha.

### 7.2 Etapa 2 — assunto (CORRIGIDO)
A arvore e um **jsTree** no container `#divArvore`, e **o ID de cada no e o proprio codigo CNJ do assunto**.
Isso torna a selecao deterministica e dispensa digitar tecla a tecla:

```js
const t = jQuery.jstree.reference('#divArvore');
t.deselect_all();
t.open_node('0220');      // pai
t.select_node('022003');  // folha
// conferir #txtDesAssunto, depois clicar #btnIncluirAssunto
```

Codigos ja confirmados:
- `022003` = INDENIZACAO POR DANO MORAL, RESPONSABILIDADE CIVIL, **DIREITO CIVIL** (este e o do pedido de teste)
- `010206` = Indenizacao por Dano Moral, Responsabilidade da Administracao, DIREITO ADMINISTRATIVO
- `060503` = Indenizacao por Dano Moral, Responsabilidade do Fornecedor, DIREITO DO CONSUMIDOR

Detalhe util: no ramo Civil o nome vem em minusculas ("Indenizacao por dano moral"); nos outros dois em
caixa alta. Filtrar por texto e ambiguo; filtrar por codigo nao.
Existe tambem `#sbmProcessoEtapa2TA` ("Tramitacao Agil") ao lado do Proxima — nao usar sem decisao do advogado.

### 7.3 Etapas 3 e 4 — partes
- `#txtCpfCnpj` e **limpo pelo sistema depois do Consultar**. Para clicar em `#btnNovo` na sequencia e preciso
  repreencher o CPF, senao `validarFrm()` dispara `alert('Informe o CPF.')` e nada acontece.
- `validarFrm()` usa a trava global `bolValidarFrmRunning`. Se um alert for dispensado no meio, a trava pode
  ficar presa e o botao para de responder. Resetar antes de reclicar.
- Clicar `#btnNovo` com um CPF **ja cadastrado** nao abre a tela Novo: apenas reexecuta a busca.
  A tela Novo so serve para pessoa inexistente.
- **Qualificacao do reu em Bonito / Juizado Especial Civel / Procedimento do JEC: a unica opcao e "REU"
  (valor 52).** A anotacao antiga de que no juizado seria "REQUERIDO" esta ERRADA. Manter a regra geral de
  ler as opcoes e usar a unica quando houver so uma.
- Justica gratuita: `select[id^='selJusticaAutor']`, opcoes "Nao Requerida" / "Requerida".
- Erro de competencia, quando ocorre, e do tribunal e aparece ao consultar a parte, nao na etapa 1.

### 7.4 Tela "Novo" — Cadastro de Pessoa (MAPEADA)
Abre no mesmo tab, titulo `:: eproc - - Cadastro de Pessoa ::`. 40 campos visiveis para pessoa fisica.

**Obrigatorios de verdade** (label com classe `.infraLabelObrigatorio`):
`#txtNome`, `#selSexo`, `#selEstCivil`, `#txtDataNascimento`, `#selNacionalidade`.

**Opcionais:** `#txtProfissao`, `#txtMae`, `#txtPai`, `#selUfNaturalidade` + `#selLocalidadeNaturalidade`,
`#selEscolaridade`, `#selTipoEtnia`, `#chkPCD`, `#chkGestante`.

**Ja vem preenchidos com default "Nao informado" e nao travam:** `#selLgbti`, `#selIdentidadeGenero`,
`#selOrientacaoSexual`.

**Sub-formularios com botao Incluir proprio** (os "obrigatorios" dentro deles so valem se o bloco for usado):
- Documentos: `#selTipoIdent`, `#txtIdentPrinc`, `#txtIdentCompl1`, `#txtIdentCompl2`, `#txtDataEmissao` -> `#btnIncDoc`
- Dependentes: `#txtCpfDependente`, `#txtNomeDependente`, `#txtDataNascDependente`, `#selTipoDeficienciaDependente` -> `#btnIncDependente`
- Endereco: `#selTipoEnd`, `#txtCep`, `#txtEndLog`, `#txtEndNum`, `#txtEndComp`, `#txtBairro`, `#selPais`, `#selUf`, `#selLocalidade` -> `#btnIncEnd`
- Contato: `#selTipoCont`, `#txtContato` -> `#btnIncCont`

Rodape: `Salvar` e `#btnVoltar`. **Sair pelo `#btnVoltar` nao salva nada** — usar isso em qualquer teste.

Implicacao para `extrair.ts`: a extracao da peticao precisa entregar, no minimo, nome, sexo, estado civil,
data de nascimento e nacionalidade. Endereco completo e contato sao necessarios na pratica (o eproc precisa
citar o reu), entao tratar como obrigatorios de negocio mesmo nao sendo obrigatorios de formulario.

### 7.5 Etapa 5 — documentos e o rascunho preso
- A tabela chama-se "Documentos selecionados e ainda nao utilizados em movimentacao" (`#tbDocumentosCadastradas`),
  e o contador e `#hdnNumDocumentos`.
- Ela e **server-side, presa a conta do usuario**, e sobrevive a Cancelar, a troca de sessao e a troca de
  navegador. Confirmado em 11/09/2026: num perfil de navegador zerado, um cadastro novo nasceu com
  `relatorio-16.pdf` (enviado 07/09 17:42) e `procuracao.pdf` (enviado 08/09 11:32) ja na tabela.
- O "X" de excluir e `a.btnExcluirDocumento`, com
  `onclick="excluirDocumento(rowIndex, idDocumento, nome, numBytes, idMinuta)"`.
  Essa funcao chama `alert_excluir()`, que chama `confirm()`. **O Playwright dispensa dialogos por padrao,
  entao o confirm retorna false e a exclusao nunca e enviada.** Essa e a causa raiz do "X nao exclui".
  **Correcao: `page.on('dialog', d => d.accept())` antes do clique.** Validado a mao: com o confirm aceito,
  a exclusao foi por AJAX (`excluir_documento_anexo`), as linhas sairam e `#hdnNumDocumentos` foi a 0.
- **DOIS BUGS CAROS DA GUARDA, pegos em execucao real em 10/09/2026. Nao repetir:**
  1. **`#hdnNumDocumentos` NAO serve para detectar documento preexistente.** E contador client-side,
     mantido a mao pelo proprio eproc (`excluirDocumento` faz `val(val - 1)`). Numa pagina recem-carregada
     com documentos na tabela ele vem ZERADO. A verdade sao as LINHAS: cada documento tem um
     `a.btnExcluirDocumento`. Contar esses links, e usar o hdn so como terceiro palpite.
  2. **A area de upload da etapa 5 e montada por AJAX** (`controlador_ajax.php?acao_ajax=gerar_upload_documentos`),
     e `esperarTitulo` devolve assim que o TITULO bate — antes do HTML da tabela existir. Ler a tabela nesse
     instante da zero com a tabela cheia. Esperar o `input[type=file]` ficar attached, depois `networkidle`,
     depois ~1,2 s, e so entao contar (com algumas tentativas).
  Sintoma quando a guarda falha: o agente sobe peca por cima do residuo e quem barra e o tribunal, com
  `alert: Ja foi inserido um documento com o tipo 'Peticao Inicial', favor escolher outro tipo.`
- **`alert()` de recusa e aceito em silencio pelo handler de dialogo.** Marcar a posicao da lista antes de
  cada envio (`marcaDialogos()`) e, depois, transformar qualquer `alert:` novo em `EtapaError`. Sem isso a
  recusa do tribunal passa despercebida e o agente segue como se tivesse enviado.
- **Efeito colateral do handler de dialogo:** enquanto o processo do agente estiver vivo, TODA caixa de
  confirmacao daquele navegador e aceita automaticamente e so aparece no log. Se o advogado clicar em
  Cancelar ou no X de excluir, acontece sem perguntar. Encerrar o agente (Ctrl+C) antes de mexer a mao na
  tela. O agente avisa isso ao entregar o navegador.
- `docTipo` (`txtTipo_N`) e campo de texto com autocomplete que ignora MouseEvent sintetico; so teclado.

### 7.6 Salvar para Distribuicao Futura e a fila de preparadas (EXECUTADO)
- `#btnSalvarDistribuicao` **NAO salva direto**. Seu onclick e `confirmacaoFinalizarProcessoAdvogado()`, que
  abre o iframe `#ifrSubFrm` com `processo_confirmacao_finalizar_subfrm&acao_futura=1`.
- Esse modal traz o **"Resumo das Informacoes"**: comarca, rito, tipo de acao, sigilo, assunto principal,
  partes, "Distribuicao preparada para", lista de documentos, e a pergunta
  "Confirmar a preparacao do ajuizamento do processo?". Botoes: `#sbmConfirmar` ("Finalizar preparacao",
  onclick `confirmaAjuizamento()`) e `#btnFechar` ("Cancelar").
  **Esse resumo e o melhor artefato de conferencia do agente: capturar print dele sempre.**
- **O eproc aceita a preparacao com a tabela de documentos VAZIA.** Nao ha validacao de peca nesse momento.
  O agente precisa validar por conta propria antes de confirmar.
- Depois de `#sbmConfirmar`, o sistema redireciona para o **Painel do Advogado**, e o contador
  **"Processos pendentes do advogado"** (Area de trabalho > Pendencias) sobe de 0 para 1.
  O link e `controlador.php?acao=peticao_inicial_preparada_listar`.
- A tela e `:: eproc - - Peticoes Iniciais pendentes de distribuicao ::`.
  Colunas: Autor, Reu, Assunto, Data da Criacao, Criado por, Acoes.
  Por linha: checkbox `#chkInfraItem<N>`, "Carregar os dados da peticao"
  (`peticao_inicial_preparada_carregar&id_peticao_pendente=<ID>`, reabre o cadastro para continuar) e
  "Excluir Peticao" (`acaoDesativar('<ID>','peticao')`).
  No rodape: **`#btnDistribuir`** (`distribuirPeticaoInicialPreparada()`) e `#btnVoltar`.
- **`#btnDistribuir` e o ato do advogado. PROIBIDO ao agente.**

**Consequencia de arquitetura:** essa fila, com selecao por checkbox e um botao Distribuir unico, e exatamente
o desenho que o art. 12 da Res. 383/2025 pede. O agente prepara N acoes, o advogado abre essa tela, confere e
distribui em bloco. Nao precisa inventar fila fora do tribunal para essa etapa — a fila ja e do eproc.
Isso tambem e o melhor argumento de venda contra Projuris/Oystr/Legis: o ato final fica no tribunal, na mao do
advogado, com trilha propria.

### 7.7 Guarda de rascunho pendente (como implementar)
Nao existe aviso de "cadastro em andamento" ao entrar na Peticao Inicial — a etapa 1 abre limpa. Entao o agente
deve checar duas coisas:
1. No painel, a contagem "Processos pendentes do advogado" / o link `peticao_inicial_preparada_listar`.
   Se houver preparadas nao distribuidas acima de um limite combinado, avisar e parar.
2. Ao chegar na etapa 5, antes do primeiro upload: se `#hdnNumDocumentos != 0`, limpar a tabela
   (com o `dialog` aceito) ou abortar com mensagem clara. Nunca subir peca por cima de lixo.

---

## 8. Divisao de trabalho Claude <-> Claude Code

**Claude (chat/Cowork)**: arquitetura, decisoes de produto e comercial, leitura da Res. 383, mapeamento de telas
no navegador (Cowork), redacao de handoff e memoria, revisao de diffs.

**Claude Code**: implementacao no repositorio local. Tarefas na fila, em ordem:

1. Ler este HANDOFF, `tribunais/tjms.json` e `PACOTES-claude-code.md` antes de tocar em qualquer coisa.
2. **P5 e o unico pacote sem prova em campo.** Testar `cadastrarParteNova` com uma parte que realmente nao
   exista na base, com qualificacao completa no pedido. Em teste, sair pelo `#btnVoltar` (nao salva nada)
   antes de confiar no Salvar.
3. `extrair.ts`: ampliar a extracao para devolver a `QualificacaoSchema` inteira (sexo, estado civil, data de
   nascimento, nacionalidade, endereco, contato) e `pendencias[]` por campo obrigatorio ausente.
   Sem isso o P5 nao serve para as 400 acoes.
4. `lote.ts`: atualizar para os campos novos do Pedido.
5. Rodada de lote pequena (3 a 5 acoes reais), com cadencia, conferindo os prints um a um.
6. Depois: fila em Supabase (tabela `protocolos` com status), worker em loop, servico local para o LEX
   listar a pasta de documentos, entrada por WhatsApp.

**Formato de entrega para o Claude Code**: um pacote por tarefa, com contexto (por que), arquivo alvo, criterio
de pronto e comando de teste. Nunca patch por `sed` com ancora de texto: as ancoras divergiram entre copias
varias vezes. Substituir arquivo inteiro ou entregar zip.

**Sinais de autorizacao do Roney**: "vamos executar" = implementar; "revisa" = ler e apontar, nao alterar;
duvida de arquitetura = perguntar antes.

---

## 9. Regulatorio (para nao esquecer no meio do codigo)

Res. 383/2025 do TJMS: art. 10 preve bloqueio total do usuario por uso inadequado, e considera inadequado
consulta em grande volume por acesso robotizado e fornecimento de credencial a terceiros ou softwares de
consulta robotizada; art. 12 admite que pecas sejam inseridas por preposto habilitado; art. 21 preve convenio
(MNI) so com orgaos publicos. **Essas leituras vieram de sessoes anteriores e nao foram reconferidas contra o
texto oficial. Reler os artigos 10, 12 e 21 antes de usar qualquer um deles em argumento de venda.**

Consequencias praticas adotadas: nenhuma credencial entregue a software (o advogado abre a propria sessao,
regra 5); nunca consulta em massa; cadencia baixa; reconciliacao so do que sumiu da fila de preparadas;
resposta escrita do TJMS antes de vender.

A propria tela de login reforca: "O acesso simultaneo do mesmo usuario em varias maquinas e reconhecido pelo
sistema como similar ao uso de robos, o que pode levar ao bloqueio do usuario." E: o 2FA e obrigatorio para
usuario externo e nao pode ser desativado. As duas frases sustentam o desenho da regra 5 e devem ser citadas
no e-mail ao eprocnegocial.

A propria tela de login reforca: "O acesso simultaneo do mesmo usuario em varias maquinas e reconhecido pelo
sistema como similar ao uso de robos, o que pode levar ao bloqueio do usuario." Citar isso no e-mail ao
eprocnegocial como prova de que o desenho adotado (uma sessao, credencial de assistente, cadencia baixa,
finalizacao humana) foi pensado para respeitar a norma.

---

## 10. Concorrencia (para posicionamento)

Projuris Peticiona, Oystr e Legis fazem RPA de protocolo em lote, na nuvem, com o certificado do advogado no
servidor deles. Nosso diferencial e o inverso: documentos locais, credencial local, finalizacao humana pela
propria fila do eproc (secao 7.6), relatorio com prints por acao.

Atencao ao movimento novo: o eproc do TJMS ja embarcou IA de extracao de peticao inicial
(`extracao_peticao_inicial/extrair`, com termo de adesao). Extrair dados da peticao esta deixando de ser
diferencial. O que continua sendo nosso: cadastrar em lote, com os documentos do escritorio, sem entregar
credencial a ninguem, parando antes do ato.

---

### Sessao de 03-04/10/2026 — primeira rodada real feita; lote PAUSADO pelo Roney

**Feito e provado em campo (TJMS, Campo Grande):**
- Os 3 bloqueios do briefing resolvidos: chave da API preenchida pelo Roney (Sonnet 5.5, `claude-sonnet-5-5`),
  Campo Grande catalogada, assunto fixado pelo advogado: `CAMPO GRANDE|CIVEL BANCARIA|CONTRATOS BANCARIOS -> 02190338`.
- `preparar` da amostra chegou a etapa 5 (status `pronto_para_conferencia`), sem Finalizar.
- `lote:varrer` da amostra: comarca, partes e valor (R$ 2815,28) extraidos certo.

**Correcoes desta sessao (commits 22ea897..4a34af3):**
- `assuntos`: cataloga a comarca antes; abre ramos fechados um por vez com checagem de coerencia
  (o eproc as vezes devolve filhos errados no carregamento sob demanda); caminho montado pelo codigo CNJ.
- CLI: libera o stdin depois do ENTER (o processo nao terminava). Colar dois comandos juntos fazia o 2o virar o ENTER do 1o.
- `preparar` termina em MODO CONFERENCIA: nenhum dialogo e aceito sozinho, cada confirm vai ao terminal (s+ENTER).
  Encerra ao fechar a janela. Ctrl+C mata o Chromium junto (mesmo grupo de processos) — NAO usar.
- Login manual tambem em modo conferencia (em 03/10 duas "Confirma desativacao da peticao?" foram aceitas sozinhas).
- `extrair`: le a inicial inteira (inicio + fim; o valor da causa fica no fim); pendencia so o que afeta o cadastro.
- `lote:varrer` mostra no terminal o motivo de cada CONFERIR.

**Proximo passo (quando o Roney retomar):** lote real de 3 a 5 acoes em `~/Acoes/acao-00N/` (uma subpasta por acao),
clientes ja cadastrados no eproc (P5 parte nova continua sem prova em campo). Avaliar `limparResiduais: true`
no modelo para o lote: PDF residual da etapa 5 fica preso na conta e trava a acao seguinte.
