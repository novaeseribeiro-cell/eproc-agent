import "./env.js";   // primeiro de todos: popula process.env antes de qualquer leitura
import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { abrirNavegador } from "./browser.js";
import { loginManual } from "./login-manual.js";
import { prepararAcao, abrirPeticaoInicial } from "./agent.js";
import { loginManual as garantirLogin } from "./login-manual.js";
import { carregar, validar, escolherCompetencia, garantirComarca } from "./catalogo.js";
import { notificar } from "./notificar.js";
import { textoPdf, extrairDaPeticao, classificarDocumento } from "./extrair.js";
import { PedidoSchema, PerfilTribunalSchema, ModeloAcaoSchema, type Pedido, type ModeloAcao } from "./types.js";

/**
 * Modo lote: uma pasta por acao. Nenhum formulario.
 *   lote varrer <raiz> <modelo.json>   -> le as peticoes, extrai variaveis por IA, gera lote/<nome>.csv para conferencia
 *   lote executar <lote.csv>           -> para cada linha aprovada, monta o pedido, valida no catalogo e roda com cadencia
 */
const [cmd, a1, a2] = process.argv.slice(2);
const tribunalId = process.env.TRIBUNAL ?? "tjms";
const NORM = (s: string) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

type Modelo = ModeloAcao;

function exigirCsv(csvPath: string) {
  if (existsSync(resolve(csvPath))) return;
  const disponiveis = existsSync("lote") ? readdirSync("lote").filter((f) => f.endsWith(".csv")) : [];
  throw new Error(
    `planilha nao encontrada: ${csvPath}\n` +
    (disponiveis.length
      ? `  Planilhas em lote/: ${disponiveis.join(", ")}`
      : `  Nenhuma planilha em lote/ ainda. Gere uma antes:\n    npm run lote:varrer -- <pasta-com-as-acoes> ${"exemplos/modelo-bancaria.json"}`),
  );
}

function carregarModelo(caminho: string): Modelo {
  if (!existsSync(resolve(caminho))) throw new Error(`modelo nao encontrado: ${caminho}`);
  const bruto = JSON.parse(readFileSync(resolve(caminho), "utf8"));
  // compatibilidade com o formato antigo, que so tinha reus
  if (bruto.reusConhecidos && !bruto.partesConhecidas) bruto.partesConhecidas = bruto.reusConhecidos;
  const r = ModeloAcaoSchema.safeParse(bruto);
  if (!r.success)
    throw new Error(`modelo "${caminho}" invalido:\n- ` + r.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`).join("\n- "));
  return r.data;
}

/** "NOME=DOC | OUTRO NOME=DOC" -> lista. Serve para autores e para reus, litisconsorcio incluso. */
function lerPartes(campo: string): { nome: string; documento: string }[] {
  return (campo || "").split("|").map((s) => s.trim()).filter(Boolean).map((s) => {
    const i = s.lastIndexOf("=");
    const nome = (i < 0 ? s : s.slice(0, i)).trim();
    const documento = (i < 0 ? "" : s.slice(i + 1)).replace(/\D/g, "");
    return { nome, documento };
  });
}
const escreverPartes = (ps: { nome: string; documento: string }[]) =>
  ps.map((p) => `${p.nome}=${p.documento}`).join(" | ");

/** Completa documento faltante pelo mapa de partes conhecidas do modelo. */
function completarDocumentos(ps: { nome: string; documento: string }[], modelo: Modelo) {
  for (const p of ps) {
    if (p.documento) continue;
    const k = Object.keys(modelo.partesConhecidas).find((n) => NORM(p.nome).includes(NORM(n)));
    if (k) p.documento = modelo.partesConhecidas[k].replace(/\D/g, "");
  }
  return ps;
}

/**
 * Duas descricoes de assunto falam da mesma coisa? Compara por prefixo de 5 letras para
 * "Contratos Bancarios" casar com "contrato bancario" sem casar com "dano moral".
 * Serve so para LEVANTAR SUSPEITA — quem decide o enquadramento e o advogado.
 */
function compartilhaTermo(a: string, b: string): boolean {
  const p = (s: string) => NORM(s).split(/[^A-Z0-9]+/).filter((w) => w.length >= 5).map((w) => w.slice(0, 5));
  const x = p(a), y = p(b);
  return x.some((w) => y.includes(w));
}

/**
 * Colunas da planilha de conferencia.
 *
 * `autores` e `reus` sao listas "NOME=DOCUMENTO | NOME=DOCUMENTO" — litisconsorcio de qualquer
 * tamanho, dos dois lados, sem coluna nova. Nao ha campo por tipo de acao aqui: o que e
 * especifico do tipo mora no modelo, e o que e especifico da COMARCA o tribunal e quem diz.
 *
 * `rito`, `area` e `classe` ficam VAZIOS na varredura e sao preenchidos por `lote:comarcas`,
 * que abre o tribunal, cataloga as comarcas novas e aplica a preferencia do modelo.
 * `assunto_codigo` tambem: so preenche quando o advogado fixa um, ou quando a resolucao
 * automatica ja gravou um para aquela comarca.
 */
const COLUNAS = ["pasta","comarca","rito","area","classe","assunto_codigo","autores","autor_nascimento","reus",
  "valor_causa","justica_gratuita","tutela","documentos","assunto_declarado","confianca","observacoes","aprovado","status","resultado"];

async function varrer(raiz: string, modeloPath: string) {
  if (!existsSync(raiz)) throw new Error(`pasta nao encontrada: ${raiz}\n  Esperado: uma pasta com UMA SUBPASTA POR ACAO, cada uma com os PDFs daquela acao.`);
  if (!statSync(raiz).isDirectory()) throw new Error(`${raiz} nao e uma pasta`);
  const modelo = carregarModelo(modeloPath);
  const pastas = readdirSync(raiz).map((n) => join(raiz, n)).filter((p) => statSync(p).isDirectory()).sort();
  console.log(`[lote] ${pastas.length} pastas em ${raiz}`);
  const linhas: Record<string, string>[] = [];

  for (const pasta of pastas) {
    const pdfs = readdirSync(pasta).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
    // nome primeiro, texto da 1a pagina depois. Os arquivos reais chegam como `1_INIC1_x.pdf`.
    const docs = [];
    for (const f of pdfs) docs.push(await classificarDocumento(join(pasta, f), f));
    const inicial = docs.find((d) => d.tipo === "PETIÇÃO INICIAL");
    const linha: Record<string, string> = Object.fromEntries(COLUNAS.map((c) => [c, ""]));
    linha.pasta = pasta;
    linha.documentos = docs.map((d) => `${d.arquivo}=${d.tipo ?? "?"}`).join(" | ");
    try {
      if (!inicial)
        throw new Error(
          `nenhum PDF reconhecido como peticao inicial entre: ${pdfs.join(", ") || "(nenhum PDF na pasta)"}. ` +
          `Renomeie o arquivo da inicial com "inicial" no nome, ou confira se o PDF tem texto (digitalizado sem OCR nao da).`,
        );
      const texto = await textoPdf(join(pasta, inicial.arquivo));
      const ex = await extrairDaPeticao(texto);
      linha.comarca = ex.comarca ?? "";
      const autores = completarDocumentos(ex.autores ?? [], modelo);
      const reus = completarDocumentos(ex.reus ?? [], modelo);
      linha.autores = escreverPartes(autores);
      linha.reus = escreverPartes(reus);
      linha.autor_nascimento = ex.autores?.[0]?.nascimento ?? "";
      linha.valor_causa = ex.valorCausa ?? "";
      linha.justica_gratuita = ex.justicaGratuita ? "sim" : "nao";
      linha.tutela = ex.tutela ? "sim" : "nao";
      linha.confianca = String(ex.confianca ?? "");
      linha.assunto_declarado = ex.assuntoDeclarado ?? "";
      // override por comarca, quando o advogado ja fixou o codigo daquela comarca
      linha.assunto_codigo = modelo.assuntoCodigoPorComarca[linha.comarca] ?? "";

      const pend: string[] = [];
      if (ex.assuntoDeclarado && !compartilhaTermo(ex.assuntoDeclarado, modelo.assuntoPrincipal))
        pend.push(`a peticao se diz "${ex.assuntoDeclarado}" e o modelo cadastra "${modelo.assuntoPrincipal}"`);
      pend.push(...(ex.pendencias ?? []));
      const semTipo = docs.filter((d) => !d.tipo).map((d) => d.arquivo);
      if (semTipo.length) pend.push(`tipo nao reconhecido: ${semTipo.join(", ")}`);
      const adivinhados = docs.filter((d) => d.porTexto).map((d) => `${d.arquivo}=${d.tipo}`);
      if (adivinhados.length) pend.push(`tipo deduzido do texto (confira): ${adivinhados.join(", ")}`);
      if (!autores.length) pend.push("nenhum autor localizado");
      if (!reus.length) pend.push("nenhum reu localizado");
      for (const p of [...autores, ...reus]) if (!p.documento) pend.push(`sem CPF/CNPJ: ${p.nome}`);
      if (!linha.comarca) pend.push("comarca nao localizada");
      if (!linha.valor_causa) pend.push("valor da causa nao localizado");
      linha.observacoes = [ex.observacoes, ...pend].filter(Boolean).join(" | ");
      linha.aprovado = pend.length === 0 && (ex.confianca ?? 0) >= 0.85 ? "sim" : "";
      console.log(`[lote] ${basename(pasta)}: ${linha.comarca} | ${autores.map((p) => p.nome).join(", ")} x ${reus.map((p) => p.nome).join(", ")} | R$ ${linha.valor_causa} | ${linha.aprovado ? "ok" : "CONFERIR"}`);
      // Mostra o MOTIVO no terminal (sem CPF: as pendencias citam nome, nunca numero).
      if (!linha.aprovado) {
        const motivos = pend.length ? pend : [`confianca da extracao ${ex.confianca ?? "?"} (minimo 0,85)`];
        for (const m of motivos) console.log(`         - ${m}`);
      }
    } catch (e: any) {
      linha.observacoes = `ERRO NA EXTRACAO: ${e.message}`;
      console.log(`[lote] ${basename(pasta)}: ${linha.observacoes}`);
    }
    linhas.push(linha);
  }
  mkdirSync("lote", { recursive: true });
  const saida = resolve(`lote/${basename(raiz)}-${new Date().toISOString().slice(0, 10)}.csv`);
  writeFileSync(saida, stringify(linhas, { header: true, columns: COLUNAS, delimiter: ";" }));
  console.log(`\n[lote] planilha de conferencia: ${saida}\nAbra, corrija o que estiver marcado CONFERIR, escreva "sim" em aprovado e rode: npm run lote:executar -- "${saida}" ${modeloPath}`);
}

function montarPedido(l: Record<string, string>, modelo: Modelo): Pedido {
  if (!l.rito || !l.area || !l.classe)
    throw new Error('sem competencia resolvida: rode `npm run lote:comarcas -- <csv> <modelo.json>` antes de executar');
  /**
   * assunto_codigo pode ficar VAZIO de proposito. Nesse caso a etapa 2 resolve contra a arvore
   * daquela comarca e so aceita folha unica; se for ambiguo, para aquela comarca e lista os
   * candidatos. Preencher a coluna a mao (ou `npm run assunto:fixar`) manda por cima.
   */
  const assuntoCodigo = (l.assunto_codigo || "").trim();
  const docs = l.documentos.split("|").map((s) => s.trim()).filter(Boolean).map((s) => {
    const [arquivo, tipo] = s.split("=").map((x) => x.trim());
    return { arquivo: join(l.pasta, arquivo), tipo, sigilo: modelo.tiposDocumento[tipo]?.sigilo ?? "0" };
  });
  // ordem: inicial primeiro, procuracao depois, resto na sequencia
  const ordem = (t: string) => t === "PETIÇÃO INICIAL" ? 0 : t === "PROCURAÇÃO" ? 1 : 2;
  docs.sort((a, b) => ordem(a.tipo) - ordem(b.tipo));
  const autores = lerPartes(l.autores);
  const reus = lerPartes(l.reus);
  if (!autores.length) throw new Error("linha sem autor (coluna `autores`)");
  if (!reus.length) throw new Error("linha sem reu (coluna `reus`)");

  return PedidoSchema.parse({
    id: basename(l.pasta),
    tribunal: tribunalId,
    acao: {
      comarca: l.comarca, rito: l.rito, area: l.area, classeCNJ: l.classe,
      ...(assuntoCodigo ? { assuntoCodigo } : {}),
      assuntoPrincipal: modelo.assuntoPrincipal,
      assuntoRamo: modelo.assuntoRamo,
      assuntosSecundarios: modelo.assuntosSecundarios,
      valorCausa: l.valor_causa,
      nivelSigilo: modelo.nivelSigilo,
    },
    partes: {
      // principal = o primeiro de cada polo. Os demais entram como litisconsortes.
      autores: autores.map((p, i) => ({
        tipo: modelo.tipoAutorPadrao, documento: p.documento, nome: p.nome, principal: i === 0,
        justicaGratuita: l.justica_gratuita === "sim",
        // P8: alem do CPF, a data de nascimento e o que separa homonimo. So o 1o autor tem coluna.
        ...(i === 0 && l.autor_nascimento ? { dataNascimento: l.autor_nascimento } : {}),
      })),
      reus: reus.map((p, i) => ({
        tipo: modelo.tipoReuPadrao, documento: p.documento, nome: p.nome, principal: i === 0,
      })),
    },
    documentos: docs,
    marcacoes: { ...modelo.marcacoes, liminarTutela: l.tutela === "sim" },
    finalizacao: modelo.finalizacao,
  });
}

/**
 * Passo entre varrer e executar: abre o tribunal, cataloga toda comarca nova da planilha e
 * escreve rito/area/classe em cada linha, pela preferencia do modelo.
 * Existe separado para o advogado VER a competencia escolhida antes de qualquer cadastro —
 * cair na terceira opcao da lista em 300 acoes sem ninguem perceber seria pior do que parar.
 */
async function resolverComarcas(csvPath: string, modeloPath: string) {
  exigirCsv(csvPath);
  const modelo = carregarModelo(modeloPath);
  const perfil = PerfilTribunalSchema.parse(JSON.parse(readFileSync(resolve(`tribunais/${tribunalId}.json`), "utf8")));
  const linhas: Record<string, string>[] = parse(readFileSync(resolve(csvPath), "utf8"), { columns: true, delimiter: ";", bom: true });
  const cat = carregar(tribunalId);

  const comarcas = [...new Set(linhas.map((l) => l.comarca).filter(Boolean))].sort();
  const faltando = comarcas.filter((c) => !cat.porComarca[c]);
  console.log(`[lote] ${comarcas.length} comarca(s) na planilha; ${faltando.length} ainda sem catalogo`);

  if (faltando.length) {
    const ctx = await abrirNavegador(resolve(process.env.PROFILE_DIR ?? "./.perfil-chromium"), false);
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await loginManual(page, perfil);
    for (const c of faltando) {
      await abrirPeticaoInicial(page, perfil);
      await garantirComarca(page, perfil, c, cat);
    }
    await ctx.close();
  }

  const resumo = new Map<string, string>();
  for (const l of linhas) {
    if (!l.comarca) { l.observacoes = [l.observacoes, "comarca nao localizada"].filter(Boolean).join(" | "); continue; }
    const r = escolherCompetencia(cat, l.comarca, modelo.preferenciaCompetencia);
    if ("erro" in r) {
      l.rito = l.area = l.classe = "";
      l.aprovado = "";
      l.observacoes = [l.observacoes, `competencia: ${r.erro}`].filter(Boolean).join(" | ");
      resumo.set(l.comarca, `SEM COMPETENCIA — ${r.erro.split("\n")[0]}`);
      continue;
    }
    l.rito = r.escolhida.rito; l.area = r.escolhida.area; l.classe = r.escolhida.classeCNJ;
    if (!l.assunto_codigo) l.assunto_codigo = modelo.assuntoCodigoPorComarca[l.comarca] ?? "";
    resumo.set(l.comarca, `${r.escolhida.rito} :: ${r.escolhida.area} :: ${r.escolhida.classeCNJ}` +
      (r.posicao > 0 ? `   (opcao ${r.posicao + 1} da preferencia, nao a primeira)` : ""));
  }
  writeFileSync(resolve(csvPath), stringify(linhas, { header: true, columns: COLUNAS, delimiter: ";" }));

  console.log("\n[lote] competencia por comarca:");
  for (const [c, v] of [...resumo].sort()) console.log(`  ${c.padEnd(24)} ${v}`);
  console.log(`\nPlanilha atualizada: ${csvPath}\nConfira a coluna area/classe e rode: npm run lote:executar -- "${csvPath}" ${modeloPath}`);
}

async function executar(csvPath: string, modeloPath: string) {
  exigirCsv(csvPath);
  const modelo = carregarModelo(modeloPath);
  const perfil = PerfilTribunalSchema.parse(JSON.parse(readFileSync(resolve(`tribunais/${tribunalId}.json`), "utf8")));
  const cat = carregar(tribunalId);
  const cadenciaMs = Number(process.env.CADENCIA_SEGUNDOS ?? 300) * 1000;
  const maxPorExecucao = Number(process.env.MAX_POR_EXECUCAO ?? 40);
  const linhas: Record<string, string>[] = parse(readFileSync(resolve(csvPath), "utf8"), { columns: true, delimiter: ";", bom: true });
  const salvar = () => writeFileSync(resolve(csvPath), stringify(linhas, { header: true, columns: COLUNAS, delimiter: ";" }));

  // 1) validacao offline de TODAS as aprovadas antes de abrir o navegador
  const fila = linhas.filter((l) => l.aprovado?.toLowerCase() === "sim" && !["ok", "salvo"].includes(l.status));
  let invalidas = 0;
  for (const l of fila) {
    try {
      const p = montarPedido(l, modelo);
      const erros = validar(cat, p.acao);
      if (erros.length) { l.status = "invalido"; l.resultado = erros.join(" | "); invalidas++; }
      for (const d of p.documentos) if (!existsSync(d.arquivo)) { l.status = "invalido"; l.resultado = `arquivo ausente: ${d.arquivo}`; invalidas++; }
    } catch (e: any) { l.status = "invalido"; l.resultado = e.message; invalidas++; }
  }
  salvar();
  const prontas = fila.filter((l) => l.status !== "invalido").slice(0, maxPorExecucao);
  console.log(`[lote] ${fila.length} aprovadas, ${invalidas} invalidas (ver coluna resultado), ${prontas.length} nesta execucao, cadencia ${cadenciaMs / 1000}s`);
  if (!prontas.length) return;

  // 2) execucao com cadencia
  const ctx = await abrirNavegador(resolve(process.env.PROFILE_DIR ?? "./.perfil-chromium"), false);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await garantirLogin(page, perfil);
  for (const [i, l] of prontas.entries()) {
    const pedido = montarPedido(l, modelo);
    const pasta = resolve(`saida/${pedido.id}`); mkdirSync(pasta, { recursive: true });
    console.log(`\n[lote] (${i + 1}/${prontas.length}) ${pedido.id} — ${l.comarca} — ${l.autor_nome}`);
    const rel = await prepararAcao(page, perfil, pedido, pasta);
    writeFileSync(`${pasta}/relatorio.json`, JSON.stringify(rel, null, 2));
    await notificar(rel);
    if (rel.status === "salvo_distribuicao_futura") { l.status = "salvo"; l.resultado = "salvo para distribuicao futura; finalizar no painel"; }
    else if (rel.status === "pronto_para_conferencia") { l.status = "ok"; l.resultado = "aguardando conferencia na tela"; }
    else { l.status = "erro"; l.resultado = rel.mensagem ?? ""; }
    salvar();
    if (rel.status === "erro" && /sessao|login|externo_controlador/i.test(rel.mensagem ?? "")) {
      console.log("[lote] sessao caiu; encerrando esta execucao. Rode de novo para continuar de onde parou.");
      break;
    }
    if (i < prontas.length - 1) { console.log(`[lote] aguardando ${cadenciaMs / 1000}s...`); await new Promise((r) => setTimeout(r, cadenciaMs)); }
  }
  await ctx.close();
  console.log("\n[lote] execucao encerrada. Status por linha na planilha.");
}

(async () => {
  if (cmd === "varrer") { if (!a1 || !a2) throw new Error('uso: npm run lote:varrer -- <pasta-raiz> <modelo.json>'); await varrer(resolve(a1), a2); }
  else if (cmd === "comarcas") { if (!a1 || !a2) throw new Error('uso: npm run lote:comarcas -- <lote.csv> <modelo.json>'); await resolverComarcas(a1, a2); }
  else if (cmd === "executar") { if (!a1 || !a2) throw new Error('uso: npm run lote:executar -- <lote.csv> <modelo.json>'); await executar(a1, a2); }
  else console.log("comandos: varrer <raiz> <modelo.json> | comarcas <lote.csv> <modelo.json> | executar <lote.csv> <modelo.json>");
})().catch((e) => {
  // mensagem, nao stack: quem roda isto e advogado, nao quem escreveu o lote.ts
  console.error(`\n[lote] ${e?.message ?? e}\n`);
  if (process.env.DEBUG) console.error(e);
  process.exit(1);
});
