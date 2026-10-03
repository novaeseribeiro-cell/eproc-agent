# eproc-agent

Agente que cadastra uma acao nova no eproc (TJMS primeiro) e para na tela de conferencia.
O advogado confere e aperta Protocolar. O agente nunca clica no botao final.

## Por que assim

- O eproc nao tem API de protocolo para advogado. O MNI existe, mas o credenciamento e para orgaos e pessoas juridicas conveniadas.
- O eproc exige segundo fator (codigo de 6 digitos por app). O agente usa um perfil de navegador persistente: o advogado loga uma vez com o 2FA, e as execucoes seguintes reaproveitam a sessao ate ela expirar.
- Cada tribunal tem sua versao do eproc. Os seletores ficam em `tribunais/<id>.json`; para adicionar TJSP, TRF4 etc. basta um perfil novo.

## Instalacao

```bash
npm install
npx playwright install chromium
cp .env.example .env   # ajuste TRIBUNAL e, se quiser, WEBHOOK_URL
```

## Uso

```bash
npm run login                                   # abre o navegador, faz login com senha + 2FA, sessao fica salva
npm run discover                                # mapeia os campos de qualquer tela para calibrar o perfil
npm run preparar -- exemplos/pedido-exemplo.json
```

`preparar` gera `saida/<id>/` com screenshots de cada etapa e `relatorio.json`. Se `WEBHOOK_URL` estiver definida, envia um POST ao terminar (Evolution API, LEX, Slack).

## Calibracao obrigatoria antes do primeiro uso real

Os seletores de `tribunais/tjms.json` foram derivados dos manuais oficiais do eproc, nao de teste no TJMS. Antes de usar em producao:

1. `npm run login`.
2. `npm run discover`, navegue ate Petição Inicial > primeira tela, pressione ENTER no terminal.
3. Abra o JSON gerado em `saida/` e confira `name`/`id`/`label` de cada campo; ajuste as chaves do perfil.
4. Repita para as telas de partes e documentos.
5. Rode `preparar` com um pedido de teste. Nao clique em Protocolar.

## Formato do pedido

Veja `exemplos/pedido-exemplo.json`. Nomes de classe, assunto e tipo de documento devem existir nas listas do tribunal (o agente casa por texto, ignorando acento e caixa; se nao achar, aborta listando as opcoes disponiveis).

## Fluxo real do TJMS (calibrado em 07/09/2026)

1. Informacoes do processo: comarca, rito, area, classe (carrega apos a area), sigilo, valor.
2. Assuntos: pesquisa por texto e marca "Sim" na linha; secundarios opcionais.
3. Requerentes: tipo pessoa, CPF/CNPJ, Consultar, Principal, Incluir; justica gratuita opcional.
4. Requeridos: idem, com qualificacao REQUERIDO.
5. Documentos: marcacoes (tutela, prioridades, Juizo 100% Digital, art. 334), PDFs com tipo e sigilo.

`finalizacao`: `parar` deixa a tela aberta no botao Finalizar; `salvar_distribuicao_futura` clica no botao oficial de rascunho do eproc e a acao fica no painel para o advogado finalizar depois (ideal para VPS).

## Roadmap

- Fase 2: fila em tabela `protocolos` no Supabase (LEX) em vez de JSON local; worker consumindo a fila.
- Fase 3: peticionamento intermediario em processo existente.
- Fase 4: VPS com Chromium headed + noVNC para o cliente conferir de qualquer lugar.

## Limites conhecidos

- Se o eproc mudar o HTML, o agente para com screenshot `99-ERRO` e a etapa que falhou. Ajuste o perfil, nao o codigo.
- Sessao expirada: `npm run login` de novo. Nao guarde o secret do 2FA no servidor.
- Nao faz saneamento juridico do pedido; o que estiver errado no JSON vai errado para a tela.

## Catalogo offline (evita acessos desnecessarios ao tribunal)

O eproc so aceita combinacoes validas de comarca + rito + area + classe, e as listas mudam por comarca.
Em vez de descobrir isso errando no site, o agente mantem um catalogo local:

```bash
npm run catalogo -- "Bonito"     # uma visita a tela 1, captura ritos, areas e classes daquela comarca
npm run validar -- pedido.json   # valida o pedido SEM abrir navegador
```

`preparar` tambem valida antes de abrir o navegador: se a classe nao existir naquela area, ele nem acessa o tribunal.
O catalogo e incremental — cada comarca nova e capturada uma vez e fica em `catalogo/tjms.json`.

Regra dura: nos campos juridicos (comarca, rito, area, classe) o agente exige correspondencia EXATA.
Nao ha "mais parecido": se nao bater, ele aborta listando as opcoes reais do tribunal.

## Modo lote (sem formulario) — v0.5

Uma pasta por acao, com os PDFs dentro. Nada mais.

```bash
cp .env.example .env               # preencher ANTHROPIC_API_KEY
npm run lote:varrer -- ~/Acoes exemplos/modelo-bancaria.json
```

`varrer` le a peticao inicial de cada pasta, extrai comarca, partes, valor, rito, gratuidade e tutela por IA,
classifica os PDFs pelo nome e gera `lote/<pasta>-<data>.csv`. Linhas com tudo localizado e confianca >= 0,85
ja vem com `aprovado=sim`; as demais vem marcadas para conferencia. O advogado abre no Numbers/Excel, corrige e aprova.

```bash
npm run lote:executar -- lote/Acoes-2026-09-10.csv exemplos/modelo-bancaria.json
```

`executar` valida TODAS as aprovadas contra o catalogo antes de abrir o navegador (linhas invalidas ganham status
`invalido` com o motivo), e entao roda uma por uma com cadencia (`CADENCIA_SEGUNDOS`, padrao 300) ate
`MAX_POR_EXECUCAO` (padrao 40). Cada acao termina em "Salvar para Distribuicao Futura"; o advogado finaliza no painel.
O status volta para a planilha (`salvo`, `erro`, `invalido`), entao pode rodar de novo a qualquer momento: ele continua de onde parou.

O modelo (`exemplos/modelo-bancaria.json`) guarda o que e fixo na carteira: area/classe por rito e por comarca,
assunto + ramo, sigilo por tipo de documento, CNPJs dos bancos. Cada carteira homogenea tem o seu.
