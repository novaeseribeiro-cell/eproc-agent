# Briefing para o chat que vai destravar a primeira rodada real

> Documento de passagem de bastão, escrito em 03/10/2026. Leia inteiro antes de tocar em qualquer coisa.
> O `HANDOFF-eproc-agent.md`, neste mesmo projeto, é a fonte completa — este arquivo é o recorte do que
> importa para a próxima tarefa.

---

## 1. O que é

Agente que preenche o cadastro de petição inicial no eproc do TJMS **dentro da sessão que o próprio
advogado autentica**, e **para antes de distribuir**. A ação fica na fila "pendentes de distribuição" do
eproc e quem protocola é o advogado, clicando ele mesmo.

Cliente final: uma colega advogada com cerca de 400 ações bancárias praticamente idênticas, paradas.
Elas **variam comarca, banco e valor**; o resto é igual. O produto precisa funcionar para **qualquer
comarca** (ninguém sabe quantas são) e para **qualquer tipo de ação**, não só bancária.

- Código: **https://github.com/novaeseribeiro-cell/eproc-agent** (privado; peça para anexar à sessão)
- Na máquina do Roney: `/Users/roneyribeiro/AGENTE EPROC-ESAJ-PJE/eproc-agent`

---

## 2. Regras que não se negociam

Estas não são preferências de estilo. Cada uma custou um erro real ou protege a inscrição do advogado.

1. **Nunca clicar em Finalizar** (`#btnSalvar[name=sbmProcessoEtapa4]`) **nem em Distribuir**
   (`#btnDistribuir`). Os dois atos são do advogado.
2. **Nunca navegar para URL interna do eproc sem o `hash` de sessão.** Responde "Link sem assinatura" e
   derruba a sessão. Sempre ler o href do menu e navegar por ele.
3. Nos campos de competência (comarca, rito, área, classe), **só correspondência exata**. Sem "mais
   parecido": duas heurísticas de aproximação já escolheram área errada.
4. **Documento de cliente não sai da máquina do advogado.** Nada de PDF em nuvem.
5. **O agente nunca faz login — herda a sessão que o advogado abriu.** Isto é escolha de produto, não
   limitação técnica. Login desatendido com A1 + semente TOTP **é possível** (o Roney já opera assim numa
   VPS para consultas) e foi **deliberadamente descartado**. Os motivos estão na seção 2 do HANDOFF.
   **Não "melhore" o agente com login automático.** Também está revogada a ideia anterior de usar
   credencial de assistente habilitado.
6. **Uma ação por vez, sem rajadas.** Pausa padrão 300 s, no máximo 40 por rodada.
7. **Nunca duas sessões do mesmo usuário ao mesmo tempo.** A tela de login do TJMS avisa que acesso
   simultâneo é tratado como robô e pode bloquear o usuário. Se o advogado está logado no navegador dele,
   o agente não roda.
8. **Nunca inventar seletor.** Se a tela mudou, rodar `npm run discover` e calibrar `tribunais/tjms.json`.
9. **Nunca reintroduzir CPF ou nome real em fixture de teste.** Os do repositório são sintéticos de
   propósito — houve uma limpeza para isso.
10. **Jamais inventar jurisprudência**, em nenhuma circunstância. Toda citação legal é verificada em fonte
    oficial antes de entrar em qualquer texto.

**Aviso operacional:** enquanto o processo do agente está rodando, **toda caixa de confirmação daquele
navegador é aceita automaticamente** e só aparece no log. Se alguém clicar em Cancelar ou no X de excluir
documento com a mão, acontece sem perguntar. Encerrar com Ctrl+C antes de mexer na tela.

---

## 3. O que está provado e o que não está

**Provado por execução real contra o TJMS:**
as cinco etapas do cadastro; seleção de assunto por ID do nó da árvore; a guarda de documentos residuais
da etapa 5; o "Salvar para Distribuição Futura" ponta a ponta; a leitura da fila de preparadas.

**Escrito e com teste offline, mas NUNCA executado contra o eproc** — tudo isto é de 11/09/2026:
- competência por lista de preferência (`escolherCompetencia`)
- catálogo de comarca sob demanda (`garantirComarca`)
- resolução automática de assunto na árvore, com cache por comarca
- conferência de partes retornadas pelo tribunal (documento, nome, data de nascimento)
- classificação de documento pelo texto da primeira página
- o passo `lote:comarcas`

**Teste offline não é prova de que a tela responde como se supõe.** Precedente concreto: a guarda de
residuais passou nos testes e **falhou duas vezes em execução real**, porque lia um campo que só é
preenchido depois de um AJAX. Na segunda tentativa trocou-se o campo mas não o momento da leitura.
Trate os itens da segunda lista como hipóteses até ver o log do tribunal.

---

## 4. A tarefa: três bloqueios, nesta ordem

### Bloqueio 1 — `ANTHROPIC_API_KEY` está vazia no `.env`
Sem ela o `lote:varrer` não lê petição nenhuma. É do Roney preencher; não peça o valor por chat nem
manuseie a chave. O `.env` já é carregado (`src/env.ts`) — até 11/09 ninguém carregava, e isso fazia a
cadência cair no padrão em silêncio.

### Bloqueio 2 — Campo Grande não está catalogada
Só **Bonito** está. Campo Grande é a comarca da petição-amostra e tem **Vara Bancária**, que a maioria das
comarcas não tem.

### Bloqueio 3 — o enquadramento do assunto na Vara Bancária
**Esta é decisão do advogado, não do agente.** O código `02190338`
(DIREITO CIVIL > Obrigações > Espécies de contratos > Contratos Bancários) foi **verificado na árvore de
Bonito / Juizado Especial Cível**. Campo Grande / Vara Bancária é outra comarca e outra área: pode não ter
esse nó.

A petição-amostra aplica o CDC na argumentação inteira (inversão do ônus, Súmula 530/STJ, art. 400 do CPC).
Era daí que vinha um `assuntoRamo: DIREITO DO CONSUMIDOR` que estava no modelo. **Aplicar o CDC não empurra
o assunto para o ramo DIREITO DO CONSUMIDOR**: a tabela do CNJ é taxonomia processual, não lei aplicável.
Quem decide é a árvore daquela competência — e, entre folhas ambíguas, o advogado.

**Caminho mais curto para os bloqueios 2 e 3, um comando** (ele cataloga Campo Grande sozinho e cancela o
cadastro no fim):

```
npm run assuntos -- exemplos/amostra/pedido-simone-campogrande.json "Bancarios"
```

Depois `"Consumidor"` e `"Revisao"`. Com o resultado na mão, **apresente as folhas ao Roney e deixe ele
escolher.** A escolha vira permanente com:

```
npm run assunto:fixar -- "Campo Grande" "<area exata que o tribunal devolveu>" "Contratos Bancários" <codigo>
```

Isso grava em `catalogo/resolucao-assunto-tjms.json` e vale para **todas** as ações daquela comarca.
Uma decisão por comarca, não uma por ação.

> O arquivo `exemplos/amostra/pedido-simone-campogrande.json` **não está no repositório** (tem partes
> reais). Existe só na máquina do Roney. Se não estiver lá, monte um equivalente a partir do
> `exemplos/pedido-exemplo.template.json` com uma comarca e partes que existam na base do tribunal.

---

## 5. Como o mecanismo decide (para não desfazer sem querer)

| o que | onde vive | quem decide |
|---|---|---|
| igual em todas as ações do tipo | o modelo de ação (JSON em `exemplos/`) | o advogado, uma vez |
| muda de ação para ação (partes, valor, comarca, documentos) | a planilha do lote | extração + conferência do advogado |
| muda de **comarca** para comarca (área, classe, código do assunto) | **ninguém escreve** | o tribunal responde, o agente pergunta |

- **Competência**: o modelo declara uma ORDEM de `{rito, area, classeCNJ}`; o agente usa a primeira que
  existir naquela comarca. Nenhuma existir **erra listando o que tentou**, não chuta. O relatório diz em
  que posição da lista caiu — cair na terceira opção em 300 ações sem ninguém notar seria pior que parar.
- **Assunto**: filtra a árvore pelo termo e **só aceita folha única**. Duas ou mais, ou nenhuma, **para
  aquela comarca** e lista os candidatos; o lote segue nas demais. **Não desempata sozinho** — escolher
  entre nós homônimos sem o advogado ver foi exatamente o que gerou o erro de competência.
- **Conferência de partes**: documento que não bate, nenhuma palavra do nome em comum, ou data de
  nascimento divergente **abortam**. Para pessoa jurídica, **qualquer** palavra faltante é grave — um CNPJ
  errado no modelo aborta na primeira ação em vez de distribuir 400 contra o banco errado.
- **Documentos residuais na etapa 5**: a tabela é server-side e presa à conta, sobrevive a Cancelar e a
  troca de navegador. O padrão é **abortar**, não apagar arquivo sem o usuário pedir.
- **Tipo de documento**: nome primeiro, texto da primeira página quando o nome não decide. O que não se
  decide vira pendência nomeando o arquivo. **Nunca chute** — chutar tipo faz o tribunal recusar o upload.

Fluxo do lote:
```
npm run lote:varrer   -- <pasta-com-as-acoes> exemplos/modelo-bancaria.json   # offline + IA
npm run lote:comarcas -- lote/<arquivo>.csv    exemplos/modelo-bancaria.json  # abre o tribunal
npm run lote:executar -- lote/<arquivo>.csv    exemplos/modelo-bancaria.json
```

---

## 6. Armadilhas de ambiente

- **`tsc && node dist/...`. Nunca `tsx`** — injeta `__name` nas funções e quebra `page.evaluate`.
- **Rodar na pasta do projeto**, não na home. `npm error Missing script` quase sempre é isso.
- `npm install --include=dev` — sem isso, "tsc: command not found".
- **Precisa rodar no Terminal do macOS.** O Playwright do projeto tem browsers de macOS; shell de VM Linux
  falha com "Executable doesn't exist".
- **npm não preserva aspas**: argumento com espaço chega partido. Ler `process.argv.slice(4).join(" ")`.
- Na árvore jsTree, `no.text` devolve a marcação (span, onmouseenter, img), não o texto; e `no.children`
  vem vazio em nó não carregado. Usar o textContent de `#<id>_anchor` e a classe `jstree-leaf` do `<li>`.
- `npm run teste` roda **offline**, sem tribunal e sem chave: 21 casos. Rode antes e depois de mexer.

---

## 7. Pendências conhecidas, fora dos três bloqueios

- **P5 (`cadastrarParteNova`) nunca foi exercitado** — as partes de teste já existiam na base.
- **A conferência de partes nunca rodou contra o tribunal**, só nos 13 testes sintéticos.
- **A coluna `pasta` da planilha guarda caminho absoluto**: a planilha não é portável entre máquinas
  (Mac do Roney → VPS da colega). Resolver antes de entregar.
- **A petição-amostra qualifica a autora sem data de nascimento.** Se as 400 seguem o mesmo modelo, a
  coluna `autor_nascimento` vem vazia e a separação de homônimo fica só no CPF.
- Os CNPJs de bancos em `partesConhecidas` **não foram conferidos em fonte oficial**. Não é risco
  silencioso (a conferência aborta), mas confira antes de rodar.
- Há **duas petições de teste** paradas na fila de preparadas do eproc, de setembro. Apagar.
- O e-mail para `eprocnegocial@tjms.jus.br` está **retido por decisão do Roney** — não envie.
  O rascunho está em `EMAIL-eprocnegocial.md`.
- `preferenciaCompetencia` do modelo bancário está como Vara Bancária → Cível → Juizado. **É política do
  advogado**: se em comarca sem vara especializada ele preferir Juizado para causa pequena, inverter as
  duas últimas linhas do JSON.
