# Pacotes de implementação — agente eproc TJMS

> **ESTADO EM 11/09/2026: P0 a P7 IMPLEMENTADOS.** Compilam com `tsc --noEmit` limpo e `npm run validar`
> passa. **Nada foi executado contra o tribunal ainda.** Este documento vira agora material de referência:
> serve para entender *por que* cada trecho do código é daquele jeito, e para recalibrar se a tela mudar.
> A fila de execução está no `HANDOFF-eproc-agent.md`, seção 8.

Gerado em 11/09/2026, a partir do mapeamento manual das telas. Formato combinado no HANDOFF seção 8:
um pacote por tarefa, com contexto, arquivo alvo, critério de pronto e comando de teste.

**Ler antes:** `HANDOFF-eproc-agent.md` e `tribunais/tjms.json`.

**Ordem:** P1 bloqueia P3. Os demais são independentes entre si. P0 (types) entra junto com P2.

**Regra de entrega:** substituir arquivo inteiro. Nunca patch por `sed` com âncora de texto — as âncoras
já divergiram entre cópias mais de uma vez.

---

## P0 — `types.ts`: campos novos no Pedido

**Por quê.** A seleção de assunto por texto é ambígua (existem três "Indenização por Dano Moral" em ramos
diferentes) e foi a causa provável do erro de competência de 10/09. O Pedido precisa carregar o código CNJ.

**Arquivo alvo:** `src/types.ts`

**Mudanças:**

```ts
// dentro do schema de acao:
assuntoCodigo: z.string().regex(/^\d{6}$/),   // NOVO, obrigatório. Ex.: "022003"
assuntoPrincipal: z.string(),                  // mantido, agora só para CONFERÊNCIA
assuntoRamo: z.string(),                       // mantido, agora só para CONFERÊNCIA
```

Atualizar `exemplos/pedido-exemplo.json`:

```json
"assuntoCodigo": "022003",
"assuntoPrincipal": "Indenização por Dano Moral",
"assuntoRamo": "DIREITO CIVIL",
```

**Critério de pronto:** `npm run validar -- exemplos/pedido-exemplo.json` passa, e um pedido sem
`assuntoCodigo` é rejeitado pelo zod com mensagem clara.

---

## P1 — `browser.ts`: aceitar diálogos (BLOQUEIA P3)

**Por quê.** Esta é a causa raiz do "X não exclui documento", que travou o projeto por dias.
`excluirDocumento()` no eproc chama `alert_excluir()`, que chama `confirm()`. O Playwright **dispensa
diálogos por padrão**, então o confirm devolvia `false` e o AJAX de exclusão nunca era enviado.

**Arquivo alvo:** `src/browser.ts`, em `abrirNavegador`, logo após criar a `page`.

```ts
page.on('dialog', async (d) => {
  registrar(`[dialog] ${d.type()}: ${d.message()}`);   // vai para o relatorio.json
  await d.accept();
});
```

Registrar a mensagem importa: é evidência de que o usuário-agente confirmou o quê.

**Atenção:** a partir daqui TODO `confirm()` da tela passa a ser aceito automaticamente. Conferir que nenhum
caminho do agente passa por um confirm destrutivo não intencional. Hoje o único é o de exclusão de documento.

**Critério de pronto:** com um documento na tabela da etapa 5, chamar a rotina de exclusão e ver
`#hdnNumDocumentos` cair e a linha sumir de `#tbDocumentosCadastradas`.

**Teste:** `npm run preparar -- exemplos/pedido-exemplo.json` com um documento residual na conta; o log deve
mostrar a linha `[dialog] confirm: Confirma exclusão do Documento "..."?`.

---

## P2 — `agent.ts`: assunto por código CNJ, via jsTree

**Por quê.** A árvore de assunto é um **jsTree** no container `#divArvore`, e **o ID de cada nó é o próprio
código CNJ**. Selecionar por código é determinístico e elimina a ambiguidade que provavelmente causou o erro
de competência. Substitui a digitação tecla a tecla.

**Arquivo alvo:** `src/agent.ts`, etapa 2.

**Referência de implementação** (adaptar ao estilo do arquivo; lembrar que o script vai como string por causa
do `tsx`):

```ts
const codigo = pedido.acao.assuntoCodigo;          // "022003"
const pai = codigo.slice(0, 4);                     // "0220"

// 1. filtrar para a árvore carregar os nós (o jsTree só monta o que o filtro traz)
await achar(page, perfil.seletores.assuntoFiltro).fill(pedido.acao.assuntoPrincipal);
await achar(page, perfil.seletores.assuntoFiltrar).click();
await page.waitForTimeout(2000);

// 2. selecionar pelo código
const desc = await page.evaluate(
  "(function(){" +
  "  var t = jQuery.jstree.reference('#divArvore');" +
  "  if (!t) return '__SEM_ARVORE__';" +
  "  t.deselect_all();" +
  "  t.open_node('" + pai + "');" +
  "  t.select_node('" + codigo + "');" +
  "  return document.getElementById('txtDesAssunto').value;" +
  "})()"
);

// 3. conferência dura
if (desc === '__SEM_ARVORE__' || !desc) {
  throw new EtapaError('etapa2', `assunto ${codigo} não encontrado na árvore`);
}
const ramoOk = desc.toUpperCase().includes(pedido.acao.assuntoRamo.toUpperCase());
if (!ramoOk) {
  throw new EtapaError('etapa2', `ramo divergente. Esperado "${pedido.acao.assuntoRamo}", veio "${desc}"`);
}

// 4. incluir
await achar(page, perfil.seletores.assuntoIncluirOutro).click();
```

**Códigos já confirmados** (também em `tribunais/tjms.json` → `assuntosConhecidos`):

| Código | Descrição completa |
|---|---|
| `022003` | INDENIZAÇÃO POR DANO MORAL, RESPONSABILIDADE CIVIL, **DIREITO CIVIL** |
| `010206` | Indenização por Dano Moral, Responsabilidade da Administração, DIREITO ADMINISTRATIVO |
| `060503` | Indenização por Dano Moral, Responsabilidade do Fornecedor, DIREITO DO CONSUMIDOR |

**Critério de pronto:** com `assuntoCodigo: "022003"`, `#txtDesAssunto` fica
`"INDENIZAÇÃO POR DANO MORAL, RESPONSABILIDADE CIVIL, DIREITO CIVIL"` e a tabela de assuntos selecionados
mostra `022003 - ...`. Com um código inexistente, o agente aborta na etapa 2 com mensagem clara, sem avançar.

---

## P3 — `agent.ts`: guarda de documentos residuais na etapa 5

**Por quê.** A tabela "Documentos selecionados e ainda não utilizados em movimentação"
(`#tbDocumentosCadastradas`) é **server-side, presa à conta**, e sobrevive a Cancelar, troca de sessão e troca
de navegador. Em 11/09/2026 um cadastro novo, em navegador de perfil zerado, nasceu com dois PDFs de dias
anteriores. Subir peça por cima desse lixo produziria uma inicial com documento errado.

**Depende de P1.** Sem o handler de diálogo, a limpeza não funciona.

**Arquivo alvo:** `src/agent.ts`, início da etapa 5, antes do primeiro upload.

```ts
const residuais = Number(await page.inputValue('#hdnNumDocumentos') || '0');
if (residuais > 0) {
  const nomes = await page.evaluate(
    "Array.from(document.querySelectorAll('#tbDocumentosCadastradas tr'))" +
    ".map(function(t){var m=t.innerText.match(/[\\w.-]+\\.(pdf|PDF)/); return m?m[0]:null;})" +
    ".filter(Boolean)"
  );
  await screenshot(page, 'etapa5-residuais');

  if (pedido.limparResiduais === true) {
    registrar(`[etapa5] limpando ${residuais} documento(s) residual(is): ${nomes.join(', ')}`);
    // excluir sempre a PRIMEIRA linha: os rowIndex mudam a cada exclusão
    for (let i = 0; i < residuais; i++) {
      await page.click('a.btnExcluirDocumento');   // confirm aceito pelo handler de P1
      await page.waitForTimeout(2500);
    }
    const sobrou = Number(await page.inputValue('#hdnNumDocumentos') || '0');
    if (sobrou !== 0) {
      throw new EtapaError('etapa5', `limpeza incompleta: ainda restam ${sobrou} documento(s)`);
    }
  } else {
    throw new EtapaError(
      'etapa5',
      `conta com ${residuais} documento(s) residual(is) (${nomes.join(', ')}). ` +
      `Rode com limparResiduais: true ou limpe à mão antes de continuar.`
    );
  }
}
```

Adicionar `limparResiduais?: boolean` ao `Pedido` em `types.ts`. **Default `false`.** Apagar arquivo do
usuário sem ele pedir é pior que abortar.

**Critério de pronto:** com a conta suja e `limparResiduais: false`, o agente aborta com a lista de nomes e um
print. Com `true`, limpa, confirma `#hdnNumDocumentos === "0"` e segue.

---

## P4 — `agent.ts`: detectar a tela de erro dentro de `incluirParte`

**Por quê.** O erro de competência do tribunal aparece **ao consultar a parte**, não na etapa 1. Hoje o agente
interpreta essa tela como "parte não encontrada", o que mascara o problema real e gerou diagnóstico errado
por dois dias.

**Arquivo alvo:** `src/agent.ts`, dentro de `incluirParte`, logo após o clique em `#btnConsultar`.

```ts
// antes de concluir "parte não encontrada", checar se o tribunal devolveu tela de erro
const txt = await page.innerText('body');
const erroTribunal = txt.match(/[^\n]*(?:combina..o entre|n.o pode resultar|Erro ao|Ocorreu um erro)[^\n]*/i);
if (erroTribunal) {
  await screenshot(page, `erro-tribunal-${etapa}`);
  throw new EtapaError(etapa, `tela de erro do tribunal: ${erroTribunal[0].trim()}`);
}
```

Aplicar o mesmo bloco em `incluirParte` para autor e réu.

**Critério de pronto:** forçar o erro (por exemplo com um `assuntoCodigo` de ramo incompatível com a classe) e
ver o agente abortar com o texto do tribunal no `relatorio.json` e um print, em vez de "parte não encontrada".

---

## P5 — `agent.ts`: `cadastrarParteNova` (botão Novo)

**Por quê.** Em 400 ações bancárias, parte de réu não vai existir na base. Recusar é inviável. Decisão do
Roney: o agente cadastra, com a qualificação extraída da petição.

**Arquivo alvo:** `src/agent.ts`, nova função, chamada quando a consulta devolve zero partes.

**Duas armadilhas confirmadas:**

1. `#txtCpfCnpj` é **limpo pelo sistema após o Consultar**. Sem repreencher, `#btnNovo` dispara
   `alert('Informe o CPF.')` e nada acontece.
2. `validarFrm()` usa a trava global `bolValidarFrmRunning`. Se um diálogo for dispensado no meio, ela fica
   presa e o botão para de responder.

```ts
await page.evaluate("window.bolValidarFrmRunning = false;");
await achar(page, perfil.seletores.parteDocumento).fill(parte.documento);
await achar(page, perfil.seletores.parteNovo).click();
await page.waitForURL(/.*/, { timeout: 30000 });
// confirmar que chegou: title === ':: eproc - - Cadastro de Pessoa ::'
```

**Mapa de campos — Pessoa Física** (40 campos visíveis; os obrigatórios têm label `.infraLabelObrigatorio`):

| Obrigatórios | Opcionais |
|---|---|
| `#txtNome` | `#txtProfissao`, `#txtMae`, `#txtPai` |
| `#selSexo` | `#selUfNaturalidade` + `#selLocalidadeNaturalidade` |
| `#selEstCivil` | `#selEscolaridade`, `#selTipoEtnia` |
| `#txtDataNascimento` | `#chkPCD`, `#chkGestante` |
| `#selNacionalidade` | |

Já vêm com default "Não informado" e **não travam**: `#selLgbti`, `#selIdentidadeGenero`,
`#selOrientacaoSexual`. **Não preencher.** São dados sensíveis que o agente não tem como saber e não deve
inferir da petição.

Sub-formulários, cada um com Incluir próprio:

| Bloco | Campos | Botão |
|---|---|---|
| Documentos | `#selTipoIdent`, `#txtIdentPrinc`, `#txtIdentCompl1`, `#txtIdentCompl2`, `#txtDataEmissao` | `#btnIncDoc` |
| Endereço | `#selTipoEnd`, `#txtCep`, `#txtEndLog`, `#txtEndNum`, `#txtEndComp`, `#txtBairro`, `#selPais`, `#selUf`, `#selLocalidade` | `#btnIncEnd` |
| Contato | `#selTipoCont`, `#txtContato` | `#btnIncCont` |

Endereço e contato não são obrigatórios de formulário, mas são **obrigatórios de negócio** — sem endereço o
réu não é citado. Tratar campo de endereço ausente como `pendencia` e abortar antes de abrir o navegador.

Rodape: `Salvar` e `#btnVoltar`. **`#btnVoltar` não salva nada** — usar em qualquer teste.

**Critério de pronto:** com uma parte inexistente e qualificação completa no Pedido, o agente preenche e
salva, e a parte aparece na consulta seguinte. Com qualificação incompleta, aborta na validação offline,
antes de abrir o navegador, listando os campos que faltam.

---

## P6 — `agent.ts`: `salvar_distribuicao_futura` com o modal

**Por quê.** `#btnSalvarDistribuicao` **não salva direto**. Seu onclick é
`confirmacaoFinalizarProcessoAdvogado()`, que abre o iframe `#ifrSubFrm` com
`processo_confirmacao_finalizar_subfrm&acao_futura=1`. Só `#sbmConfirmar` grava.

**E o eproc aceita a preparação com a tabela de documentos VAZIA.** Não valida a peça. A validação tem de ser
nossa.

**Arquivo alvo:** `src/agent.ts`, finalização.

```ts
// 0. validação nossa, antes de qualquer clique
const nDocs = Number(await page.inputValue('#hdnNumDocumentos') || '0');
if (nDocs < pedido.documentos.length) {
  throw new EtapaError('finalizacao', `esperados ${pedido.documentos.length} documentos, a tela tem ${nDocs}`);
}

// 1. abre o modal
await achar(page, perfil.seletores.btnSalvarDistribuicaoFutura).click();
const frame = await page.waitForSelector('#ifrSubFrm', { timeout: 30000 });
await page.waitForTimeout(2000);

// 2. captura o Resumo das Informações — principal artefato de conferência
const resumo = await page.frameLocator('#ifrSubFrm').locator('body').innerText();
await screenshot(page, 'resumo-confirmacao');
registrar(`[resumo] ${resumo.replace(/\s+/g, ' ')}`);

// 3. conferência contra o Pedido, antes de confirmar
for (const [campo, esperado] of [
  ['comarca', pedido.acao.comarca],
  ['classe',  pedido.acao.classeCNJ],
  ['assunto', pedido.acao.assuntoRamo],
] as const) {
  if (!resumo.toUpperCase().includes(String(esperado).toUpperCase())) {
    throw new EtapaError('finalizacao', `resumo não confere em ${campo}: esperado "${esperado}"`);
  }
}

// 4. confirma
await page.frameLocator('#ifrSubFrm').locator('#sbmConfirmar').click();
// redireciona para o Painel do Advogado
```

O modal traz: comarca, rito, tipo de ação, sigilo, assunto principal, partes, "Distribuição preparada para" e
a lista de documentos. Guardar o print **sempre** — é o que se mostra ao cliente.

**NUNCA clicar:** `#btnSalvar[name=sbmProcessoEtapa4]` (Finalizar) nem `#btnDistribuir` na fila de preparadas.

**Critério de pronto:** o agente chega ao modal, grava print e texto do resumo, confere os três campos,
confirma, e o painel passa a mostrar "Processos pendentes do advogado" incrementado em 1.

---

## P7 — `agent.ts`: ler a fila de preparadas (guarda + reconciliação)

**Por quê.** Duas funções de uma vez: guarda antes de rodar, e base da reconciliação sem consulta em massa.

**Arquivo alvo:** `src/agent.ts`, nova função `lerPreparadas(page)`.

Caminho: Painel → link `controlador.php?acao=peticao_inicial_preparada_listar`. Navegar **pelo href do
painel**, nunca por URL montada (o eproc exige o hash de sessão).

Cada linha da tabela tem:

| Elemento | Seletor / onclick |
|---|---|
| id da petição | `input.infraCheckbox[id^='chkInfraItem']` → `value` |
| carregar | `a[href*='peticao_inicial_preparada_carregar']` (`&id_peticao_pendente=<ID>`) |
| excluir | `a[onclick^='acaoDesativar']` |
| distribuir (PROIBIDO) | `#btnDistribuir` → `distribuirPeticaoInicialPreparada()` |

Colunas: Autor, Réu, Assunto, Data da Criação, Criado por.

**Uso 1 — guarda.** No início da rodada, se o número de preparadas não distribuídas passar de um teto
configurável (sugestão: 40), avisar e parar. Não faz sentido empilhar 400 preparadas esperando conferência.

**Uso 2 — reconciliação.** Guardar os IDs da rodada N. Na rodada N+1, os que **sumiram** foram distribuídos
pelo advogado. Só para esses — poucos, identificados, disparados por ato dele — consultar o número do
processo. Isso não é varredura, e é o que mantém o desenho dentro do art. 10.

**Critério de pronto:** `lerPreparadas` devolve a lista com id, autor, réu, assunto e data. Rodando duas
vezes com uma distribuição manual no meio, o diff identifica corretamente a que saiu.

---

## O que NÃO fazer ainda

- Modo lote (`lote:varrer` / `lote:executar`) em produção: só depois de P1–P7 validados com uma ação real.
- Fila em Supabase e Agente Local com long polling: depois do agente confiável por arquivo.
- Qualquer código de driver PJe neste repositório (ver projeto separado).
- Vender: antes da resposta escrita do `eprocnegocial@tjms.jus.br`.
