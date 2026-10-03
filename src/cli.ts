import "./env.js";   // primeiro de todos: popula process.env antes de qualquer leitura
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { abrirNavegador } from "./browser.js";
import { prepararAcao, abrirPeticaoInicial, lerPreparadas, listarAssuntos, chaveAssunto, lerResolucoes, gravarResolucao } from "./agent.js";
import { carregar, salvar, capturarComarca, validar } from "./catalogo.js";
import { loginManual as garantirLogin } from "./login-manual.js";
import { descobrirCampos } from "./discover.js";
import { notificar } from "./notificar.js";
import { PedidoSchema, PerfilTribunalSchema } from "./types.js";

const [cmd, arg] = process.argv.slice(2);
const tribunalId = process.env.TRIBUNAL ?? "tjms";
const perfil = PerfilTribunalSchema.parse(JSON.parse(readFileSync(resolve(`tribunais/${tribunalId}.json`), "utf8")));
const profileDir = resolve(process.env.PROFILE_DIR ?? "./.perfil-chromium");

/**
 * O navegador so abre sob demanda. Antes, abrirNavegador() era chamado no topo de main(),
 * o que fazia `validar` subir um Chromium com o perfil de sessao enquanto imprimia
 * "nenhum acesso ao tribunal foi feito". Comando offline nao toca no perfil.
 */
let ctx: BrowserContext | null = null;
async function abrir(): Promise<Page> {
  if (!ctx) ctx = await abrirNavegador(profileDir, false);
  return ctx.pages()[0] ?? (await ctx.newPage());
}

async function main() {
  if (cmd === "login") {
    const page = await abrir();
    await garantirLogin(page, perfil);
    console.log("Sessao salva no perfil. Pode fechar o navegador.");
    await page.waitForTimeout(3000);

  } else if (cmd === "discover") {
    const page = await abrir();
    await garantirLogin(page, perfil);
    mkdirSync("saida", { recursive: true });
    await descobrirCampos(page, perfil, resolve(`saida/discover-${tribunalId}-${Date.now()}.json`));

  } else if (cmd === "catalogo") {
    if (!arg) throw new Error('uso: npm run catalogo -- "Nome da Comarca"');
    const page = await abrir();
    await garantirLogin(page, perfil);
    await abrirPeticaoInicial(page, perfil);
    const cat = carregar(tribunalId);
    const e = await capturarComarca(page, perfil, arg, cat);
    console.log(`\nCatalogo de ${e.comarca} salvo: ${e.ritos.length} ritos, ${Object.keys(e.areas).length} combinacoes rito+area.`);

  } else if (cmd === "validar") {
    // OFFLINE: nao abre navegador, nao toca no perfil, nao acessa o tribunal.
    if (!arg) throw new Error("uso: npm run validar -- pedido.json");
    const pedido = PedidoSchema.parse(JSON.parse(readFileSync(resolve(arg), "utf8")));
    const erros = validar(carregar(tribunalId), pedido.acao);
    if (erros.length) { console.error("PEDIDO INVALIDO:\n- " + erros.join("\n- ")); process.exitCode = 1; }
    else console.log("Pedido valido contra o catalogo. Nenhum acesso ao tribunal foi feito.");

  } else if (cmd === "preparar") {
    if (!arg) throw new Error("uso: npm run preparar -- caminho/do/pedido.json");
    const pedido = PedidoSchema.parse(JSON.parse(readFileSync(resolve(arg), "utf8")));
    const erros = validar(carregar(tribunalId), pedido.acao);
    if (erros.length && !erros[0].includes("ainda nao catalogada")) {
      console.error("PEDIDO INVALIDO (validado offline, sem acessar o tribunal):\n- " + erros.join("\n- "));
      process.exit(1);
    }
    if (erros.length) console.log("[eproc-agent] aviso: comarca sem catalogo; seguindo sem validacao previa.");

    const page = await abrir();
    await garantirLogin(page, perfil);
    const pasta = resolve(`saida/${pedido.id}`);
    mkdirSync(pasta, { recursive: true });
    const rel = await prepararAcao(page, perfil, pedido, pasta);
    writeFileSync(`${pasta}/relatorio.json`, JSON.stringify(rel, null, 2));
    await notificar(rel);
    console.log(JSON.stringify(rel, null, 2));
    // Nao fecha o navegador: a tela fica aberta para o advogado conferir e protocolar.
    if (rel.status === "salvo_distribuicao_futura")
      console.log(
        "\nAcao PREPARADA, nao distribuida. Abra Painel > Area de trabalho > Pendencias >\n" +
        '"Processos pendentes do advogado", confira e clique em Distribuir. `npm run preparadas` lista a fila.',
      );
    else if (rel.status === "pronto_para_conferencia")
      console.log("\nNavegador mantido aberto. Confira e, se estiver tudo certo, clique em Finalizar (etapa 5). Ctrl+C encerra o agente (a aba continua).");
    else
      console.log("\nExecucao terminou em ERRO. Veja a mensagem acima e o print 99-ERRO. Nada foi protocolado.");
    console.log(
      "ATENCAO: enquanto este processo estiver rodando, TODA caixa de confirmacao desse navegador e\n" +
      "aceita automaticamente e so aparece aqui no log. Se voce clicar em Cancelar ou no X de excluir\n" +
      "documento, vai acontecer sem perguntar. Encerre com Ctrl+C antes de mexer a mao na tela.",
    );
    await new Promise(() => {});

  } else if (cmd === "assuntos") {
    // uso: npm run assuntos -- exemplos/pedido-exemplo.json "Contratos Bancários"
    // npm run nao preserva aspas: "Contratos Bancarios" chega como dois argumentos.
    const termo = process.argv.slice(4).join(" ").trim();
    if (!arg || !termo) throw new Error('uso: npm run assuntos -- <pedido.json> "termo de busca"');
    const pedido = PedidoSchema.parse(JSON.parse(readFileSync(resolve(arg), "utf8")));
    const page = await abrir();
    await garantirLogin(page, perfil);
    const lista = await listarAssuntos(page, perfil, pedido, termo);
    if (!lista.length) console.log(`Nenhum assunto encontrado para "${termo}".`);
    else {
      console.log(`${lista.length} no(s) na arvore para "${termo}" (comarca ${pedido.acao.comarca}, ${pedido.acao.area}):\n`);
      for (const a of lista) console.log(`${a.incerto ? "?" : a.folha ? "*" : " "} ${a.codigo}  ${a.caminho}`);
      console.log('\n* = folha (selecionavel como assunto principal). Use o codigo em "assuntoCodigo".');
      if (lista.some((a) => a.incerto)) console.log('? = o eproc respondeu de forma incoerente ao abrir este no; confira na tela antes de usar.');
    }
    mkdirSync("catalogo", { recursive: true });
    const destino = resolve(`catalogo/assuntos-${termo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\W+/g, "-").toLowerCase()}.json`);
    writeFileSync(destino, JSON.stringify(lista, null, 2));
    console.log(`\nSalvo em ${destino}`);

  } else if (cmd === "preparadas") {
    // Lista a fila "Peticoes Iniciais pendentes de distribuicao". Nunca clica em Distribuir.
    const page = await abrir();
    await garantirLogin(page, perfil);
    const fila = await lerPreparadas(page, perfil);
    if (!fila.length) console.log("Nenhuma peticao preparada aguardando distribuicao.");
    else {
      console.log(`${fila.length} peticao(oes) preparada(s) aguardando DISTRIBUICAO pelo advogado:\n`);
      for (const p of fila) console.log(`- [${p.id}] ${p.autor} x ${p.reu} | ${p.assunto} | criada ${p.criadaEm} por ${p.criadaPor}`);
      console.log("\nAbra o eproc, confira e clique em Distribuir. O agente nao distribui.");
    }
    writeFileSync(resolve(`saida/preparadas-${Date.now()}.json`), JSON.stringify(fila, null, 2));

  } else if (cmd === "assunto:fixar") {
    // OFFLINE. Grava a decisao do advogado para uma comarca+area+termo ambiguo.
    // A partir daqui todas as acoes daquela comarca usam este codigo, sem perguntar de novo.
    const [comarca, area, termo, codigo] = process.argv.slice(3);
    if (!comarca || !area || !termo || !codigo)
      throw new Error('uso: npm run assunto:fixar -- "Comarca" "Area" "Termo do assunto" <codigoCNJ>');
    if (!/^(?:\d{2}){2,6}$/.test(codigo))
      throw new Error(`codigo "${codigo}" invalido: sao pares de digitos, 2 a 6 niveis (ex.: 02190338)`);
    const chave = chaveAssunto(comarca, area, termo);
    gravarResolucao(tribunalId, chave, {
      codigo, caminho: "(fixado a mao pelo advogado)", resolvidoEm: new Date().toISOString(), origem: "manual",
    });
    console.log(`Gravado: ${chave} -> ${codigo}\nVale para todas as acoes de ${comarca} / ${area} com o assunto "${termo}".`);

  } else if (cmd === "assunto:listar") {
    const todas = lerResolucoes(tribunalId);
    const chaves = Object.keys(todas).sort();
    if (!chaves.length) console.log("Nenhum assunto resolvido ainda.");
    else for (const k of chaves) {
      const r = todas[k];
      console.log(`${r.codigo}  [${r.origem}]  ${k.replace(/\|/g, " / ")}\n            ${r.caminho}`);
    }

  } else if (cmd === "fila") {
    console.log("Modo fila (Supabase) previsto para a fase 2. Use `preparar` com JSON por enquanto.");

  } else {
    console.log(
      "comandos:\n" +
      "  login | discover | catalogo <comarca>\n" +
      "  assuntos <pedido.json> <termo>          varre a arvore de assunto e devolve os codigos\n" +
      '  assunto:fixar "Comarca" "Area" "Termo" <codigo>   resolve ambiguidade de uma comarca, para sempre\n' +
      "  assunto:listar                          mostra o que ja foi resolvido, por comarca\n" +
      "  validar <pedido.json> | preparar <pedido.json> | preparadas | fila",
    );
  }

  if (ctx) await ctx.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
