import type { Page } from "playwright";
import { resolve, basename } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { achar, existe, selecionarPorTexto, esperarOpcoes, screenshot, dialogosAceitos, marcaDialogos, dialogosDesde } from "./browser.js";
import { EtapaError, type Pedido, type PerfilTribunal, type Parte, type Etapa } from "./types.js";
import { carregar, garantirComarca, validar } from "./catalogo.js";

export interface Relatorio {
  pedidoId: string;
  status: "pronto_para_conferencia" | "salvo_distribuicao_futura" | "erro";
  etapaFalha?: string;
  mensagem?: string;
  preenchido: Record<string, string>;
  screenshots: string[];
  resumoConfirmacao?: string;
  dialogos?: string[];
}

const log = (m: string) => console.log(`[eproc-agent] ${m}`);
const NORM = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const ESC = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const EH_CODIGO = (s: string) => /^(?:\d{2}){2,6}$/.test(s);

/** Espera a tela certa; se o eproc devolver a pagina "Erro", devolve a regra de negocio recusada. */
async function esperarTitulo(page: Page, trecho: string, etapa: Etapa, timeoutMs = 20000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    if (NORM(await page.title()).includes(NORM(trecho))) return;
    if (NORM(await page.title()).includes("erro") || await page.locator("h1:has-text('Erro')").count()) {
      const msg = await page.locator("font[color='red'], .erro, #divInfraAreaDados").first().innerText().catch(() => "");
      throw new EtapaError(etapa, "eproc", `o tribunal recusou: ${msg.replace(/\s+/g, " ").trim().slice(0, 300)}`);
    }
    await page.waitForTimeout(300);
  }
  throw new EtapaError(etapa, "titulo", `esperava "${trecho}", estou em "${await page.title()}" (${page.url()})`);
}

/**
 * P4 — O erro de competencia do tribunal aparece AO CONSULTAR A PARTE, nao na etapa 1.
 * Sem isto, a tela de erro vira "parte nao encontrada" e o diagnostico sai errado.
 */
async function checarErroTribunal(page: Page, etapa: Etapa) {
  const txt = await page.innerText("body").catch(() => "");
  const m = txt.match(/[^\n]*(?:combina[cç][aã]o entre|n[aã]o pode resultar|ocorreu um erro|erro ao )[^\n]*/i);
  if (m) throw new EtapaError(etapa, "eproc", `tela de erro do tribunal: ${m[0].replace(/\s+/g, " ").trim().slice(0, 300)}`);
}

/**
 * P8 — CONFERENCIA DA PARTE RETORNADA PELO TRIBUNAL.
 *
 * Vale para pessoa fisica e juridica. Antes disto, divergencia de nome so virava aviso no log:
 * um CNPJ errado no modelo bancario incluiria outra empresa como re e ninguem perceberia ate a citacao.
 *
 * Sao tres conferencias, e duas delas NAO podem ser ignoradas:
 *   1. documento — o CPF/CNPJ pedido tem de aparecer na linha. Garante que estamos lendo a linha certa.
 *   2. nome      — todas as palavras significativas do nome esperado tem de aparecer no nome retornado.
 *   3. nascimento— se o pedido trouxer data de nascimento, ela tem de bater. E o que separa homonimos;
 *                  conferencia de nome sozinha nao separa duas pessoas com o mesmo nome.
 */
const SEM_ACENTO = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const PALAVRAS_VAZIAS = new Set(["DE", "DA", "DO", "DAS", "DOS", "E", "DI", "DEL", "EM", "NA", "NO"]);
const SUFIXOS_EMPRESA = new Set(["SA", "LTDA", "ME", "EPP", "EIRELI", "CIA", "COMPANHIA", "SOCIEDADE", "ANONIMA", "ANONIMO", "MEI", "SS"]);

function tokensNome(s: string): string[] {
  return SEM_ACENTO(s).toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/)
    .filter((t) => t.length >= 2 && !PALAVRAS_VAZIAS.has(t) && !SUFIXOS_EMPRESA.has(t));
}

export interface Conferencia { ok: boolean; motivo?: string; grave?: boolean }

export function conferirParteRetornada(textoLinha: string, p: Parte): Conferencia {
  // 1. documento — grave
  if (p.documento) {
    const pedido = p.documento.replace(/\D/g, "");
    const naLinha = textoLinha.replace(/\D/g, "");
    if (pedido && !naLinha.includes(pedido))
      return { ok: false, grave: true, motivo: `o documento ${p.documento} nao aparece na linha retornada pelo tribunal` };
  }

  // 2. nome
  const esperados = tokensNome(p.nome);
  const retornados = new Set(tokensNome(textoLinha));
  const faltando = esperados.filter((t) => !retornados.has(t));
  if (esperados.length && faltando.length === esperados.length)
    return { ok: false, grave: true, motivo: `nenhuma palavra de "${p.nome}" aparece no nome retornado` };
  if (faltando.length) {
    /**
     * Pessoa JURIDICA: qualquer palavra faltando e GRAVE e nao pode ser ignorada.
     * Motivo: "BANCO BRADESCO" e "BANCO SANTANDER" compartilham o token BANCO. Tratar isso como
     * divergencia parcial deixaria passar um banco errado so porque a palavra generica bateu — que e
     * exatamente o estrago que esta conferencia existe para impedir, ja que os CNPJs do modelo
     * bancario nunca foram conferidos. Nome de empresa ou esta certo, ou e outra empresa.
     *
     * Pessoa FISICA: sobrenome a mais ou a menos e plausivelmente erro de digitacao na peticao.
     * Fica como divergencia parcial, ignoravel com "aceitarNomeDivergente" e registrada no relatorio.
     */
    if (p.tipo !== "PF")
      return { ok: false, grave: true, motivo: `pessoa juridica: o nome retornado nao contem ${faltando.join(", ")} (esperado "${p.nome}"). Provavel documento errado no pedido` };
    return { ok: false, motivo: `o nome retornado nao contem: ${faltando.join(", ")} (esperado "${p.nome}")` };
  }

  // 3. data de nascimento — grave. Unico jeito de separar homonimos.
  const dn = p.dataNascimento ?? p.qualificacao?.dataNascimento;
  if (dn) {
    const m = textoLinha.match(/\d{2}\/\d{2}\/\d{4}/);
    if (m && m[0] !== dn)
      return { ok: false, grave: true, motivo: `data de nascimento diverge: pedido diz ${dn}, tribunal diz ${m[0]}` };
  }

  return { ok: true };
}

/** Entra na Peticao Inicial pelo link do menu (a URL precisa do hash de sessao). */
export async function abrirPeticaoInicial(page: Page, perfil: PerfilTribunal) {
  const link = page.locator("a[aria-label='Petição Inicial'], a[href*='acao=processo_cadastrar']").first();
  await link.waitFor({ state: "attached", timeout: 20000 });
  const href = await link.getAttribute("href");
  if (!href) throw new EtapaError("menu", "menuPeticaoInicial", "link da Peticao Inicial sem href");
  const url = new URL(href, page.url()).toString();
  log(`abrindo Peticao Inicial: ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForLoadState("domcontentloaded");
}

export interface AssuntoCatalogado {
  codigo: string;
  texto: string;
  caminho: string;
  folha: boolean;
}

/**
 * Varre a arvore de assuntos e devolve codigo CNJ + caminho completo de cada no que o filtro trouxe.
 * Existe porque `assuntoCodigo` e obrigatorio no Pedido e NAO pode ser adivinhado: o mesmo nome de
 * assunto aparece em varios ramos. Este comando e a unica forma honesta de descobrir o codigo certo.
 *
 * Percorre as 5 etapas ate a 2, despeja a arvore, e CANCELA o cadastro no fim — nao deixa rascunho.
 */
/**
 * Dump da arvore de assunto do jsTree.
 *
 * Ler `no.text` devolve a MARCACAO do no (span, onmouseenter, img de tooltip), nao o texto.
 * E `no.children` vem vazio para no ainda nao carregado, entao nao serve para saber se e folha.
 * O que vale: o texto do ancora no DOM, e a classe `jstree-leaf` do <li>.
 */
const SCRIPT_ARVORE = `(function () {
  var c = document.querySelector('#divArvore') || document.querySelector('.jstree');
  if (!c) return '[]';
  var jq = window.jQuery || window.$;
  if (!jq || !jq.jstree) return '[]';
  var t = jq.jstree.reference(c);
  if (!t) return '[]';

  function textoDe(id) {
    var a = document.getElementById(id + '_anchor');
    return a ? String(a.textContent || '').replace(/\\s+/g, ' ').trim() : '';
  }

  var saida = [];
  var lis = c.querySelectorAll('li.jstree-node');
  for (var i = 0; i < lis.length; i++) {
    var id = lis[i].id;
    if (!id) continue;
    var no = t.get_node(id);
    if (!no) continue;

    var partes = [];
    var pais = (no.parents || []).filter(function (x) { return x && x !== '#'; }).reverse();
    for (var j = 0; j < pais.length; j++) { var tp = textoDe(pais[j]); if (tp) partes.push(tp); }
    var meu = textoDe(id);
    if (meu) partes.push(meu);

    saida.push({
      codigo: id,
      texto: meu,
      caminho: partes.join(' > '),
      folha: lis[i].classList.contains('jstree-leaf')
    });
  }
  return JSON.stringify(saida);
})()`;

async function dumparArvore(page: Page): Promise<AssuntoCatalogado[]> {
  try { return JSON.parse(String(await page.evaluate(SCRIPT_ARVORE))); } catch { return []; }
}

/** Aplica o termo no filtro da arvore e espera o jsTree remontar. */
async function filtrarArvore(page: Page, perfil: PerfilTribunal, termo: string) {
  const filtro = await achar(page, perfil, "assuntoFiltro", "assuntos");
  await filtro.fill("");
  await filtro.pressSequentially(termo, { delay: 40 });
  await (await achar(page, perfil, "assuntoFiltrar", "assuntos")).click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1800);
}

// ---------------------------------------------------------------------------
// Resolucao automatica de assunto por comarca+area
// ---------------------------------------------------------------------------
//
// O lote atravessa comarcas que ninguem catalogou, e a arvore de assunto muda com a
// competencia. Fixar um codigo unico no modelo seria adivinhar — foi adivinhar assunto por
// texto que produziu o erro de combinacao LOCALIDADE/CLASSE/ASSUNTO/COMPETENCIA.
//
// Regra: filtra a arvore pelo termo e so aceita se restar EXATAMENTE UMA folha.
// Duas ou mais, ou nenhuma, para AQUELA comarca e lista os candidatos. Nunca desempata sozinho.
// O que resolve fica em cache por comarca+area+termo: a decisao e uma por comarca, nao por acao.

export interface ResolucaoAssunto {
  codigo: string; caminho: string; resolvidoEm: string; origem: "arvore" | "manual";
}

const arquivoResolucao = (tribunal: string) => resolve(`catalogo/resolucao-assunto-${tribunal}.json`);

export function chaveAssunto(comarca: string, area: string, termo: string): string {
  const n = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  return `${n(comarca)}|${n(area)}|${n(termo)}`;
}

export function lerResolucoes(tribunal: string): Record<string, ResolucaoAssunto> {
  const p = arquivoResolucao(tribunal);
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; }
}

export function gravarResolucao(tribunal: string, chave: string, r: ResolucaoAssunto) {
  const todas = lerResolucoes(tribunal);
  todas[chave] = r;
  mkdirSync("catalogo", { recursive: true });
  writeFileSync(arquivoResolucao(tribunal), JSON.stringify(todas, null, 2));
}

export async function listarAssuntos(
  page: Page, perfil: PerfilTribunal, pedido: Pedido, termo: string,
): Promise<AssuntoCatalogado[]> {
  const rel: Relatorio = { pedidoId: `assuntos:${termo}`, status: "erro", preenchido: {}, screenshots: [] };

  await abrirPeticaoInicial(page, perfil);
  await esperarTitulo(page, "1 de 5", "dados_acao");

  // Comarca nunca vista: cataloga aqui, com a tela 1 aberta (mesmo caminho do preparar).
  // Depois confere o pedido contra o catalogo: rito/area/classe so por correspondencia EXATA.
  // Se nao bater, cancela o cadastro e devolve as opcoes que o tribunal oferece — nao chuta.
  const cat = carregar(pedido.tribunal);
  const { capturadaAgora } = await garantirComarca(page, perfil, pedido.acao.comarca, cat);
  if (capturadaAgora) console.log(`[catalogo] "${pedido.acao.comarca}" catalogada nesta execucao (catalogo/${pedido.tribunal}.json)`);
  const erros = validar(cat, pedido.acao);
  if (erros.length) {
    await (await achar(page, perfil, "cancelarCadastro", "dados_acao")).click().catch(() => {});
    await page.waitForTimeout(2000);
    throw new EtapaError(
      "dados_acao", "competencia",
      `o pedido nao bate com o que o tribunal oferece em ${pedido.acao.comarca}. Ajuste rito/area/classe do pedido com o rotulo EXATO:\n  - ` +
        erros.join("\n  - "),
    );
  }

  await etapa1(page, perfil, pedido, rel);
  await (await achar(page, perfil, "etapa1Proxima", "dados_acao")).click();
  await esperarTitulo(page, "2 de 5", "assuntos");

  await (await achar(page, perfil, "assuntoRadio", "assuntos")).check().catch(() => {});
  await filtrarArvore(page, perfil, termo);
  const lista = await dumparArvore(page);

  // Nao deixar rascunho para tras. O confirm do Cancelar e aceito pelo handler de dialogo.
  await (await achar(page, perfil, "cancelarCadastro", "assuntos")).click().catch(() => {});
  await page.waitForTimeout(3000);

  return lista.sort((a, b) => a.codigo.localeCompare(b.codigo));
}

export interface PeticaoPreparada {
  id: string; autor: string; reu: string; assunto: string; criadaEm: string; criadaPor: string;
}

/**
 * P7 — Le a fila "Peticoes Iniciais pendentes de distribuicao".
 * Serve para duas coisas: guarda antes de rodar (nao empilhar preparadas sem conferencia)
 * e base da reconciliacao (o que sumiu entre duas leituras foi distribuido pelo advogado).
 * Navega SEMPRE por href do sistema: URL montada a mao nao tem hash de sessao e derruba a sessao.
 */
export async function lerPreparadas(page: Page, perfil: PerfilTribunal): Promise<PeticaoPreparada[]> {
  const acharLink = () => page.locator("a[href*='acao=peticao_inicial_preparada_listar']").first();

  if (!(await acharLink().count())) {
    const painel = page.locator("a[href*='acao=principal'], a[href*='acao=painel_adv_listar']").first();
    if (!(await painel.count())) throw new EtapaError("menu", "painel", "nao achei o link do painel; faca login primeiro");
    await painel.click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1500);
  }
  if (!(await acharLink().count())) return [];        // painel sem pendencias nao mostra o link

  await acharLink().click();
  await page.waitForLoadState("domcontentloaded");
  await esperarTitulo(page, "pendentes de distribui", "menu", 20000);

  const script = `(function () {
    var linhas = Array.prototype.slice.call(document.querySelectorAll('tr'));
    var saida = [];
    for (var i = 0; i < linhas.length; i++) {
      var chk = linhas[i].querySelector("input.infraCheckbox[id^='chkInfraItem']");
      if (!chk) continue;
      var c = linhas[i].cells;
      // O value do checkbox vem como "id|autor|reu|assunto". O id limpo e o primeiro pedaco.
      // Fonte preferida: o href de "Carregar os dados da peticao", que traz id_peticao_pendente.
      var id = String(chk.value || '').split('|')[0];
      var carregar = linhas[i].querySelector("a[href*='id_peticao_pendente=']");
      if (carregar) {
        var m = (carregar.getAttribute('href') || '').match(/id_peticao_pendente=([^&]+)/);
        if (m) id = m[1];
      }
      saida.push({
        id: id,
        autor:     c[1] ? c[1].innerText.replace(/\\s+/g, ' ').trim() : '',
        reu:       c[2] ? c[2].innerText.replace(/\\s+/g, ' ').trim() : '',
        assunto:   c[3] ? c[3].innerText.replace(/\\s+/g, ' ').trim() : '',
        criadaEm:  c[4] ? c[4].innerText.replace(/\\s+/g, ' ').trim() : '',
        criadaPor: c[5] ? c[5].innerText.replace(/\\s+/g, ' ').trim() : ''
      });
    }
    return JSON.stringify(saida);
  })()`;
  try { return JSON.parse(String(await page.evaluate(script))); } catch { return []; }
}

/** Guarda: nao faz sentido empilhar preparadas esperando conferencia do advogado. */
export async function guardaPreparadas(page: Page, perfil: PerfilTribunal, teto = 40): Promise<PeticaoPreparada[]> {
  const fila = await lerPreparadas(page, perfil);
  if (fila.length >= teto)
    throw new EtapaError("menu", "preparadas",
      `ja existem ${fila.length} peticoes preparadas aguardando distribuicao (teto ${teto}). ` +
      `O advogado precisa conferir e distribuir antes de o agente preparar mais.`);
  log(`fila de preparadas: ${fila.length} aguardando distribuicao`);
  return fila;
}

export async function prepararAcao(page: Page, perfil: PerfilTribunal, pedido: Pedido, pastaSaida: string): Promise<Relatorio> {
  const rel: Relatorio = { pedidoId: pedido.id, status: "erro", preenchido: {}, screenshots: [] };
  const shot = async (n: string) => rel.screenshots.push(await screenshot(page, pastaSaida, n));

  try {
    await abrirPeticaoInicial(page, perfil);
    await esperarTitulo(page, "1 de 5", "dados_acao");

    // Comarca nova se cataloga sozinha, aqui, com a tela 1 ja aberta. Sem isso o lote so
    // roda em comarca que alguem catalogou a mao antes — e ninguem sabe a lista de antemao.
    const cat = carregar(pedido.tribunal);
    const { capturadaAgora } = await garantirComarca(page, perfil, pedido.acao.comarca, cat);
    if (capturadaAgora) rel.preenchido.comarcaCatalogada = "capturada nesta execucao";

    await etapa1(page, perfil, pedido, rel);
    await shot("01-informacoes");
    await (await achar(page, perfil, "etapa1Proxima", "dados_acao")).click();
    await esperarTitulo(page, "2 de 5", "assuntos");

    await etapa2Assuntos(page, perfil, pedido, rel);
    await shot("02-assuntos");
    await (await achar(page, perfil, "etapa2Proxima", "assuntos")).click();
    await esperarTitulo(page, "3 de 5", "partes_autores");

    for (const p of pedido.partes.autores) await incluirParte(page, perfil, p, "partes_autores", pastaSaida, rel);
    await shot("03-requerentes");
    await (await achar(page, perfil, "partesProxima", "partes_autores")).click();
    await esperarTitulo(page, "4 de 5", "partes_reus");

    for (const p of pedido.partes.reus) await incluirParte(page, perfil, p, "partes_reus", pastaSaida, rel);
    await shot("04-requeridos");
    await (await achar(page, perfil, "partesProxima", "partes_reus")).click();
    await esperarTitulo(page, "5 de 5", "documentos");

    await tratarResiduais(page, perfil, pedido, rel, shot);
    await marcacoes(page, perfil, pedido, rel);
    for (const d of pedido.documentos) await anexarDocumento(page, perfil, d, rel);
    await shot("05-documentos");

    if (!(await existe(page, perfil, "btnFinalizarPROIBIDO", 5000)))
      throw new EtapaError("conferencia", "btnFinalizarPROIBIDO", "botao Finalizar nao encontrado; conferir manualmente");

    if (pedido.finalizacao === "salvar_distribuicao_futura") {
      await salvarParaDistribuicaoFutura(page, perfil, pedido, rel, shot);
      rel.status = "salvo_distribuicao_futura";
      rel.mensagem = "Acao preparada. Abra Painel > Pendencias > Processos pendentes do advogado, confira e distribua.";
    } else {
      await shot("06-PRONTO-para-conferencia");
      rel.status = "pronto_para_conferencia";
      rel.mensagem = "Acao cadastrada ate a etapa 5. Confira e clique em Finalizar quando estiver de acordo.";
    }
    log(rel.mensagem);
  } catch (e: any) {
    rel.status = "erro";
    rel.etapaFalha = e instanceof EtapaError ? e.etapa : "desconhecida";
    rel.mensagem = e?.message ?? String(e);
    await shot("99-ERRO").catch(() => {});
    log(`ERRO: ${rel.mensagem}`);
  }
  if (dialogosAceitos.length) rel.dialogos = [...dialogosAceitos];
  return rel;
}

/** Etapa 1: comarca -> rito -> area -> classe (cada um recarrega o seguinte por AJAX). Match EXATO. */
async function etapa1(page: Page, perfil: PerfilTribunal, pedido: Pedido, rel: Relatorio) {
  const a = pedido.acao;
  const sel = async (chave: string, texto: string, exato = true) =>
    (rel.preenchido[chave] = await selecionarPorTexto(await achar(page, perfil, chave, "dados_acao"), texto, "dados_acao", chave, exato));

  await sel("comarca", a.comarca);
  await esperarOpcoes(await achar(page, perfil, "rito", "dados_acao"), 2, 15000);
  await sel("rito", a.rito);
  await esperarOpcoes(await achar(page, perfil, "area", "dados_acao"), 2, 15000);
  await sel("area", a.area);
  await esperarOpcoes(await achar(page, perfil, "classe", "dados_acao"), 2, 15000);
  await sel("classe", a.classeCNJ);
  await sel("nivelSigilo", a.nivelSigilo === "1" ? "Segredo de Justi" : "Sem Sigilo", false);

  // Ao escolher a classe aparecem "Processo Originario" e "Juizo", que DESLOCAM o Valor da Causa.
  // Por isso tudo aqui e por id, nunca por coordenada.
  if (a.valorNaoSeAplica) {
    await (await achar(page, perfil, "valorNaoAplica", "dados_acao")).check();
    rel.preenchido.valorCausa = "nao se aplica";
  } else {
    const v = a.valorCausa.replace(/[^\d,.]/g, "").replace(".", ",");
    await (await achar(page, perfil, "valorCausa", "dados_acao")).fill(v);
    rel.preenchido.valorCausa = v;
  }
}

/**
 * P2 — Etapa 2 por CODIGO CNJ.
 * A arvore e um jsTree em #divArvore e o ID de cada no E o codigo CNJ do assunto.
 * Selecao por API: deterministica, sem digitar tecla a tecla, sem ambiguidade de texto.
 */
async function selecionarNoArvore(page: Page, codigo: string): Promise<string> {
  // A arvore tem profundidade variavel: 2 digitos por nivel. "022003" tem 3 niveis, "02190338" tem 4.
  // Abrir so o pai imediato nao basta quando os avos estao fechados — abrir a linhagem inteira.
  const ancestrais: string[] = [];
  for (let k = 2; k < codigo.length; k += 2) ancestrais.push(codigo.slice(0, k));
  const script = `(function () {
    var c = document.querySelector('#divArvore') || document.querySelector('.jstree');
    if (!c) return '__SEM_ARVORE__';
    var jq = window.jQuery || window.$;
    if (!jq || !jq.jstree) return '__SEM_JSTREE__';
    var t = jq.jstree.reference(c);
    if (!t) return '__SEM_INSTANCIA__';
    t.deselect_all();
    var linhagem = ${JSON.stringify(ancestrais)};
    for (var k = 0; k < linhagem.length; k++) { try { t.open_node(linhagem[k]); } catch (e) { /* ja aberto */ } }
    if (!document.getElementById('${codigo}_anchor')) return '__NO_AUSENTE__';
    t.select_node('${codigo}');
    var d = document.getElementById('txtDesAssunto');
    return d ? d.value : '__SEM_CAMPO__';
  })()`;
  let r = String(await page.evaluate(script));
  if (r === "__NO_AUSENTE__") {            // open_node pode carregar o filho de forma assincrona
    await page.waitForTimeout(1500);
    r = String(await page.evaluate(script));
  }
  return r;
}

async function etapa2Assuntos(page: Page, perfil: PerfilTribunal, pedido: Pedido, rel: Relatorio) {
  const a = pedido.acao;
  await (await achar(page, perfil, "assuntoRadio", "assuntos")).check().catch(() => {});

  // O filtro so serve para o jsTree montar os nos. A escolha e sempre por codigo.
  await filtrarArvore(page, perfil, a.assuntoPrincipal);

  let codigo = a.assuntoCodigo;
  let origem: "pedido" | "cache" | "arvore" = "pedido";
  const chave = chaveAssunto(a.comarca, a.area, a.assuntoPrincipal);

  if (!codigo) {
    const cache = lerResolucoes(pedido.tribunal)[chave];
    if (cache) { codigo = cache.codigo; origem = "cache"; log(`assunto do cache (${chave}): ${cache.codigo} - ${cache.caminho}`); }
  }

  if (!codigo) {
    /**
     * Resolucao automatica. So aceita folha UNICA. Nao desempata por ramo nem por ordem:
     * escolher entre nos homonimos sem o advogado ver foi o que gerou o erro de competencia.
     */
    const nos = await dumparArvore(page);
    const alvo = NORM(a.assuntoPrincipal);
    const candidatos = nos.filter((n) => n.folha && NORM(n.texto).includes(alvo));

    if (candidatos.length === 0) {
      const folhas = nos.filter((n) => n.folha).slice(0, 12).map((n) => `${n.codigo} ${n.caminho}`);
      throw new EtapaError("assuntos", "assuntoPrincipal",
        `nenhuma folha da arvore casa com "${a.assuntoPrincipal}" em ${a.comarca} / ${a.area}.\n` +
        (folhas.length ? `  Folhas que o filtro devolveu:\n    - ${folhas.join("\n    - ")}\n` : "  O filtro nao devolveu folha nenhuma.\n") +
        `  Rode: npm run assuntos -- <pedido desta comarca> "<outro termo>"`);
    }

    if (candidatos.length > 1) {
      const ramo = a.assuntoRamo ? NORM(a.assuntoRamo) : "";
      const linhas = candidatos.map((n) => {
        const marca = ramo && NORM(n.caminho).includes(ramo) ? " <- bate com o ramo do modelo" : "";
        return `${n.codigo}  ${n.caminho}${marca}`;
      });
      throw new EtapaError("assuntos", "assuntoCodigo",
        `"${a.assuntoPrincipal}" e ambiguo em ${a.comarca} / ${a.area}: ${candidatos.length} folhas.\n` +
        `    - ${linhas.join("\n    - ")}\n` +
        `  Escolha UMA e grave, que vale para todas as acoes desta comarca:\n` +
        `    npm run assunto:fixar -- ${pedido.tribunal} "${a.comarca}" "${a.area}" "${a.assuntoPrincipal}" <codigo>`);
    }

    codigo = candidatos[0].codigo;
    origem = "arvore";
    log(`assunto resolvido na arvore (folha unica) para ${a.comarca} / ${a.area}: ${codigo} - ${candidatos[0].caminho}`);
  }

  const caminho = await selecionarNoArvore(page, codigo);
  if (caminho.startsWith("__"))
    throw new EtapaError("assuntos", "assuntoCodigo",
      `nao consegui selecionar o assunto ${codigo} na arvore (${caminho}). ` +
      `Confira o codigo, ou rode discover: a tela pode ter mudado.`);

  // Conferencia dura: o caminho tem de conter o termo. E o ramo, quando o modelo declara um.
  const c = NORM(caminho);
  if (!c.includes(NORM(a.assuntoPrincipal)))
    throw new EtapaError("assuntos", "assuntoPrincipal", `codigo ${codigo} devolveu "${caminho}", que nao contem "${a.assuntoPrincipal}"`);
  if (a.assuntoRamo && !c.includes(NORM(a.assuntoRamo)))
    throw new EtapaError("assuntos", "assuntoRamo",
      `codigo ${codigo} esta em ramo diferente do declarado. Modelo diz "${a.assuntoRamo}", tribunal devolveu "${caminho}".\n` +
      `  Em ${a.comarca} / ${a.area} pode nao existir esse assunto no ramo do modelo. Decida: mude o assuntoRamo\n` +
      `  do modelo, ou deixe-o vazio para desligar esta conferencia.`);

  // So grava no cache DEPOIS de o tribunal aceitar a selecao.
  if (origem === "arvore")
    gravarResolucao(pedido.tribunal, chave, { codigo, caminho, resolvidoEm: new Date().toISOString(), origem: "arvore" });

  await (await achar(page, perfil, "assuntoIncluirOutro", "assuntos")).click();
  await page.waitForLoadState("networkidle").catch(() => {});
  rel.preenchido.assuntoPrincipal = `${codigo} - ${caminho} (${origem})`.slice(0, 200);
  log(`assunto principal incluido: ${codigo} - ${caminho} [${origem}]`);

  for (const sec of a.assuntosSecundarios) {
    if (EH_CODIGO(sec)) {
      const cs = await selecionarNoArvore(page, sec);
      if (cs.startsWith("__")) { log(`assunto secundario ${sec} nao encontrado (${cs})`); continue; }
    } else {
      await filtrarArvore(page, perfil, sec);
      const n = page.locator("a, span").filter({ hasText: new RegExp(ESC(sec), "i") }).first();
      if (!(await n.isVisible().catch(() => false))) { log(`assunto secundario nao encontrado: ${sec}`); continue; }
      await n.click();
      await page.waitForTimeout(600);
    }
    await (await achar(page, perfil, "assuntoIncluirOutro", "assuntos")).click();
    await page.waitForLoadState("networkidle").catch(() => {});
  }
}

/**
 * P3 — Documentos residuais na etapa 5 (tabela server-side, presa a conta).
 *
 * NAO confiar em #hdnNumDocumentos: e contador CLIENT-SIDE, mantido a mao pelo proprio eproc
 * (`excluirDocumento` faz `$('#hdnNumDocumentos').val(val - 1)`). Numa pagina recem-carregada com
 * documentos preexistentes ele vem ZERADO, e a guarda passava direto — bug real, pego em 10/09/2026:
 * o agente subiu peca por cima do residuo e quem barrou foi o tribunal, com
 * `alert: Ja foi inserido um documento com o tipo 'Peticao Inicial'`.
 *
 * A verdade sao as LINHAS da tabela. Cada documento tem um `a.btnExcluirDocumento`.
 */
async function lerTabelaDocumentos(page: Page): Promise<{ n: number; nomes: string[] }> {
  const script = `(function () {
    var links = document.querySelectorAll('a.btnExcluirDocumento').length;
    var tabela = document.getElementById('tbDocumentosCadastradas');
    if (!tabela) {
      var ts = document.querySelectorAll('table');
      for (var i = 0; i < ts.length; i++) {
        if (/ainda n.o utilizados|Nome Documento/i.test(ts[i].innerText || '')) { tabela = ts[i]; break; }
      }
    }
    var nomes = tabela
      ? Array.prototype.slice.call(tabela.querySelectorAll('tr'))
          .map(function (t) { var m = (t.innerText || '').match(/[A-Za-z0-9_.-]+\\.(pdf|PDF|p7s)/); return m ? m[0] : null; })
          .filter(function (x) { return !!x; })
      : [];
    var h = document.getElementById('hdnNumDocumentos');
    var hn = h ? Number(h.value || '0') : 0;
    return JSON.stringify({ n: Math.max(links, nomes.length, hn), nomes: nomes });
  })()`;
  try { return JSON.parse(String(await page.evaluate(script))); } catch { return { n: 0, nomes: [] }; }
}

/**
 * A area de upload da etapa 5 e montada por AJAX (`gerar_upload_documentos`), e `esperarTitulo`
 * devolve assim que o TITULO bate — o que pode ser antes do HTML da tabela existir.
 * Ler sem esperar dava n=0 com a tabela cheia, e a guarda passava direto. Bug real, 10/09/2026.
 */
async function esperarAreaDocumentos(page: Page, perfil: PerfilTribunal) {
  await page.locator(perfil.seletores.docArquivo[0]).first()
    .waitFor({ state: "attached", timeout: 30000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
}

/** Conta com paciencia: sai cedo se achar algo, insiste um pouco antes de aceitar "tabela vazia". */
async function contarDocumentosComEspera(page: Page, tentativas = 12): Promise<{ n: number; nomes: string[] }> {
  let ultimo: { n: number; nomes: string[] } = { n: 0, nomes: [] };
  for (let i = 0; i < tentativas; i++) {
    ultimo = await lerTabelaDocumentos(page);
    if (ultimo.n > 0) return ultimo;
    await page.waitForTimeout(500);
  }
  return ultimo;
}

async function tratarResiduais(
  page: Page, perfil: PerfilTribunal, pedido: Pedido, rel: Relatorio, shot: (n: string) => Promise<number>,
) {
  await esperarAreaDocumentos(page, perfil);
  const antes = await contarDocumentosComEspera(page);
  log(`[etapa5] documentos ja na tabela antes do upload: ${antes.n}${antes.nomes.length ? ` (${antes.nomes.join(", ")})` : ""}`);
  if (antes.n === 0) return;

  await shot("05a-documentos-residuais");
  const lista = antes.nomes.join(", ") || "(sem nomes legiveis)";

  if (!pedido.limparResiduais)
    throw new EtapaError("documentos", "docNumDocumentos",
      `a conta tem ${antes.n} documento(s) residual(is) da etapa 5: ${lista}. ` +
      `Essa tabela e do servidor e presa a conta: sobrevive a Cancelar e a troca de navegador. ` +
      `Rode com "limparResiduais": true, ou exclua a mao no eproc antes de continuar.`);

  log(`limpando ${antes.n} documento(s) residual(is): ${lista}`);
  for (let i = 0; i < antes.n + 2; i++) {
    const link = page.locator(perfil.seletores.docExcluirLink[0]).first();
    if (!(await link.count())) break;
    await link.click();                 // o confirm() e aceito pelo handler de dialogo (P1)
    await page.waitForTimeout(2500);
    if ((await lerTabelaDocumentos(page)).n === 0) break;
  }

  const depois = await lerTabelaDocumentos(page);
  if (depois.n !== 0)
    throw new EtapaError("documentos", "docExcluirLink",
      `limpeza incompleta: ainda restam ${depois.n} documento(s) (${depois.nomes.join(", ")}). ` +
      `Verifique se o handler de dialogo esta ativo (browser.ts).`);
  rel.preenchido.residuaisLimpos = lista;
}

/** P5 — Cadastro de parte inexistente (botao Novo -> tela "Cadastro de Pessoa"). */
async function cadastrarParteNova(page: Page, perfil: PerfilTribunal, p: Parte, etapa: Etapa, pastaSaida: string, rel: Relatorio) {
  const q = p.qualificacao;
  if (!q) throw new EtapaError(etapa, "qualificacao", `"${p.nome}" nao existe na base e o pedido nao traz qualificacao para cadastrar`);
  if (p.tipo !== "PF") throw new EtapaError(etapa, "parteNovo", `cadastro automatico so implementado para pessoa fisica (parte "${p.nome}")`);

  // O eproc LIMPA #txtCpfCnpj depois do Consultar. Sem repreencher, validarFrm() so dispara
  // alert('Informe o CPF.') e nada acontece. bolValidarFrmRunning pode ficar presa apos um dialogo.
  await page.evaluate("window.bolValidarFrmRunning = false;").catch(() => {});
  if (p.documento) await (await achar(page, perfil, "parteDocumento", etapa)).fill(p.documento.replace(/\D/g, ""));
  await (await achar(page, perfil, "parteNovo", etapa)).click();
  await esperarTitulo(page, "Cadastro de Pessoa", etapa, 30000);

  const preencher = async (chave: string, valor?: string) => {
    if (!valor) return;
    await (await achar(page, perfil, chave, etapa)).fill(valor);
  };
  const escolher = async (chave: string, valor?: string, exato = true) => {
    if (!valor) return;
    await selecionarPorTexto(await achar(page, perfil, chave, etapa), valor, etapa, chave, exato);
  };

  // Obrigatorios
  await preencher("novaPessoaNome", p.nome);
  await escolher("novaPessoaSexo", q.sexo);
  await escolher("novaPessoaEstadoCivil", q.estadoCivil);
  await preencher("novaPessoaDataNascimento", q.dataNascimento);
  await escolher("novaPessoaNacionalidade", q.nacionalidade, false);

  // Opcionais
  await preencher("novaPessoaProfissao", q.profissao);
  await preencher("novaPessoaMae", q.mae);
  await preencher("novaPessoaPai", q.pai);

  if (q.documento) {
    await escolher("novaPessoaDocTipo", q.documento.tipo, false);
    await preencher("novaPessoaDocPrincipal", q.documento.numero);
    await (await achar(page, perfil, "novaPessoaDocIncluir", etapa)).click();
    await page.waitForTimeout(800);
  }

  if (q.endereco) {
    const e = q.endereco;
    await escolher("novaPessoaEndTipo", e.tipo, false);
    await preencher("novaPessoaEndCep", e.cep.replace(/\D/g, ""));
    await page.waitForTimeout(1200);                       // o CEP costuma preencher logradouro por AJAX
    await preencher("novaPessoaEndLogradouro", e.logradouro);
    await preencher("novaPessoaEndNumero", e.numero);
    await preencher("novaPessoaEndComplemento", e.complemento);
    await preencher("novaPessoaEndBairro", e.bairro);
    await escolher("novaPessoaEndPais", e.pais, false);
    await escolher("novaPessoaEndUf", e.uf, false);
    await esperarOpcoes(await achar(page, perfil, "novaPessoaEndCidade", etapa), 2, 15000);
    await escolher("novaPessoaEndCidade", e.cidade, false);
    await (await achar(page, perfil, "novaPessoaEndIncluir", etapa)).click();
    await page.waitForTimeout(800);
  } else {
    log(`AVISO: cadastrando "${p.nome}" SEM endereco. O reu pode nao ser citado.`);
  }

  if (q.contato) {
    await escolher("novaPessoaContatoTipo", q.contato.tipo, false);
    await preencher("novaPessoaContato", q.contato.valor);
    await (await achar(page, perfil, "novaPessoaContatoIncluir", etapa)).click();
    await page.waitForTimeout(800);
  }

  rel.screenshots.push(await screenshot(page, pastaSaida, `cadastro-parte-${NORM(p.nome).replace(/\s+/g, "-").slice(0, 30)}`));
  await (await achar(page, perfil, "novaPessoaSalvar", etapa)).click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await checarErroTribunal(page, etapa);
  rel.preenchido[`parteCadastrada:${p.nome}`] = p.documento ?? "sem documento";
  log(`parte cadastrada: ${p.nome}`);
}

async function incluirParte(
  page: Page, perfil: PerfilTribunal, p: Parte,
  etapa: "partes_autores" | "partes_reus", pastaSaida: string, rel: Relatorio,
) {
  const consultar = async () => {
    const tipoTxt = p.tipo === "PJ" ? "Pessoa Jur" : p.tipo === "ENTIDADE" ? "Entidade" : "Pessoa F";
    await selecionarPorTexto(await achar(page, perfil, "parteTipoPessoa", etapa), tipoTxt, etapa, "parteTipoPessoa", false);
    await page.evaluate("window.bolValidarFrmRunning = false;").catch(() => {});

    if (p.semDocumento || !p.documento) {
      await (await achar(page, perfil, "parteSemCpf", etapa)).check();
      if (p.motivoSemDocumento)
        await selecionarPorTexto(await achar(page, perfil, "parteSemCpfMotivo", etapa), p.motivoSemDocumento, etapa, "parteSemCpfMotivo");
      await (await achar(page, perfil, "parteNome", etapa)).fill(p.nome);
      await (await achar(page, perfil, "parteConsultarNome", etapa)).click();
    } else {
      await (await achar(page, perfil, "parteDocumento", etapa)).fill(p.documento.replace(/\D/g, ""));
      await (await achar(page, perfil, "parteConsultar", etapa)).click();
    }
    await page.waitForLoadState("networkidle").catch(() => {});
    await checarErroTribunal(page, etapa);            // P4: erro de competencia aparece AQUI
  };

  await consultar();

  if (!(await existe(page, perfil, "parteResultadoLinha", 8000))) {
    if (!p.cadastrarSeNaoExistir)
      throw new EtapaError(etapa, "parteResultadoLinha",
        `"${p.nome}" nao encontrado na base do tribunal. Para o agente cadastrar, marque ` +
        `"cadastrarSeNaoExistir": true e inclua a qualificacao no pedido.`);
    await cadastrarParteNova(page, perfil, p, etapa, pastaSaida, rel);
    await consultar();
    if (!(await existe(page, perfil, "parteResultadoLinha", 8000)))
      throw new EtapaError(etapa, "parteResultadoLinha", `"${p.nome}" foi cadastrado mas nao apareceu na consulta seguinte`);
  }

  const linha = await achar(page, perfil, "parteResultadoLinha", etapa);
  const textoLinha = (await linha.innerText()).replace(/\s+/g, " ").trim();

  // P8: o tribunal e quem confere por nos, a cada acao. Ver conferirParteRetornada.
  const conf = conferirParteRetornada(textoLinha, p);
  if (!conf.ok) {
    if (conf.grave || !p.aceitarNomeDivergente)
      throw new EtapaError(etapa, "conferenciaParte",
        `${conf.motivo}. Linha do tribunal: "${textoLinha.slice(0, 200)}". ` +
        (conf.grave
          ? "Divergencia grave: confira o documento no pedido. Nao ha como ignorar."
          : 'Se a divergencia for so de grafia, marque "aceitarNomeDivergente": true nessa parte.'));
    log(`AVISO: divergencia de nome ACEITA por "aceitarNomeDivergente" -> ${conf.motivo}`);
    rel.preenchido[`divergenciaAceita:${p.nome}`] = `${conf.motivo} | tribunal: ${textoLinha.slice(0, 120)}`;
  }

  await selecionarPorTexto(await achar(page, perfil, "partePrincipal", etapa), p.principal ? "Sim" : "Não", etapa, "partePrincipal", false);

  // Qualificacao do polo passivo: LER as opcoes e usar a unica quando houver so uma.
  // Em Bonito / Juizado Especial Civel / Procedimento do JEC a unica opcao e "REU" (valor 52).
  // A anotacao antiga de que no juizado seria "REQUERIDO" estava errada.
  if (etapa === "partes_reus" && await existe(page, perfil, "parteQualificacaoReu", 1500)) {
    const q = await achar(page, perfil, "parteQualificacaoReu", etapa);
    const ops = ((await q.evaluate((el: HTMLSelectElement) =>
      Array.from(el.options).map((o) => ({ value: o.value, label: (o.textContent || "").trim() })))) as { value: string; label: string }[])
      .filter((o) => o.label);
    if (ops.length === 1) await q.selectOption(ops[0].value);
    else await selecionarPorTexto(q, "R", etapa, "parteQualificacaoReu", false);
  }

  await (await achar(page, perfil, "parteIncluir", etapa)).click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await checarErroTribunal(page, etapa);

  if (etapa === "partes_autores" && p.justicaGratuita) {
    const jg = page.locator(perfil.seletores.parteJusticaGratuita[0]).last();
    if (await jg.count()) await selecionarPorTexto(jg, "Requerida", etapa, "parteJusticaGratuita", false);
  }
  log(`parte incluida (${etapa}): ${p.nome}`);
}

/**
 * P6 — Salvar para Distribuicao Futura.
 * O botao NAO salva direto: abre o iframe #ifrSubFrm com o "Resumo das Informacoes".
 * So #sbmConfirmar grava. E o eproc ACEITA preparacao com a tabela de documentos vazia,
 * entao a validacao da peca tem de ser nossa.
 */
async function salvarParaDistribuicaoFutura(
  page: Page, perfil: PerfilTribunal, pedido: Pedido, rel: Relatorio, shot: (n: string) => Promise<number>,
) {
  const docs = await lerTabelaDocumentos(page);
  if (docs.n < pedido.documentos.length)
    throw new EtapaError("conferencia", "docNumDocumentos",
      `o pedido tem ${pedido.documentos.length} documento(s) mas a tela mostra ${docs.n}. ` +
      `O eproc aceitaria assim mesmo; nos nao.`);

  await (await achar(page, perfil, "btnSalvarDistribuicaoFutura", "conferencia")).click();

  const seletorIframe = perfil.seletores.modalConfirmacaoIframe[0];
  await page.waitForSelector(seletorIframe, { timeout: 30000 });
  await page.waitForTimeout(2000);

  const resumo = (await page.frameLocator(seletorIframe).locator("body").innerText().catch(() => ""))
    .replace(/\s+/g, " ").trim();
  if (!resumo) throw new EtapaError("conferencia", "modalConfirmacaoIframe", "o modal de confirmacao abriu vazio");
  rel.resumoConfirmacao = resumo.slice(0, 1200);
  await shot("06-resumo-confirmacao");
  log(`resumo: ${resumo.slice(0, 240)}`);

  // Conferencia do resumo contra o Pedido, antes do ato.
  const r = NORM(resumo);
  const conferir: [string, string][] = [
    ["comarca", pedido.acao.comarca],
    ["classe", pedido.acao.classeCNJ],
    ["ramo do assunto", pedido.acao.assuntoRamo],
  ];
  for (const [campo, esperado] of conferir)
    if (!r.includes(NORM(esperado)))
      throw new EtapaError("conferencia", "resumo", `o resumo nao confere em ${campo}: esperava "${esperado}". Resumo: ${resumo.slice(0, 300)}`);

  await page.frameLocator(seletorIframe).locator(perfil.seletores.modalConfirmarPreparacao[0]).click();
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(3000);
  await shot("07-SALVO-distribuicao-futura");
}

async function marcacoes(page: Page, perfil: PerfilTribunal, pedido: Pedido, rel: Relatorio) {
  const m = pedido.marcacoes;
  const mapa: [boolean, string][] = [
    [m.liminarTutela, "chkLiminarTutela"], [m.prioridadeDoencaGrave, "chkDoencaGrave"], [m.prioridadeIdoso, "chkIdoso"],
    [m.prioridadeDeficiente, "chkDeficiente"], [m.prioridadeCrianca, "chkCrianca"], [m.lei14289, "chkLei14289"],
    [m.juizoDigital, "chkJuizoDigital"], [m.semInteresseConciliar, "chkSemInteresseConciliar"],
  ];
  const feitas: string[] = [];
  for (const [on, chave] of mapa) if (on) { await (await achar(page, perfil, chave, "documentos")).check(); feitas.push(chave); }
  if (feitas.length) rel.preenchido.marcacoes = feitas.join(", ");
}

async function anexarDocumento(page: Page, perfil: PerfilTribunal, d: Pedido["documentos"][number], rel: Relatorio) {
  const caminho = resolve(d.arquivo);
  if (!existsSync(caminho)) throw new EtapaError("documentos", "docArquivo", `arquivo nao encontrado: ${caminho}`);

  const antes = (await lerTabelaDocumentos(page)).n;
  await page.locator(perfil.seletores.docArquivo[0]).last().setInputFiles(caminho);
  await page.waitForTimeout(800);

  // Tipo e autocomplete que ignora clique sintetico: digita o inicio e navega com setas ate o texto exato.
  const tipo = page.locator(perfil.seletores.docTipo[0]).last();
  await tipo.click();
  await tipo.fill("");
  await tipo.pressSequentially(d.tipo.slice(0, 12), { delay: 60 });
  await page.waitForTimeout(900);
  const alvo = NORM(d.tipo);
  let selecionado = false; const vistos: string[] = [];
  for (let i = 0; i < 30 && !selecionado; i++) {
    await tipo.press("ArrowDown");
    await page.waitForTimeout(120);
    const atual = NORM(await tipo.inputValue().catch(() => ""));
    if (atual && atual !== NORM(d.tipo.slice(0, 12))) vistos.push(atual);
    if (atual === alvo) {
      await tipo.press("Enter");
      await page.waitForTimeout(400);
      selecionado = NORM(await tipo.inputValue().catch(() => "")) === alvo;
    }
  }
  if (!selecionado) throw new EtapaError("documentos", "docTipo",
    `nao consegui selecionar "${d.tipo}". Opcoes percorridas: ${[...new Set(vistos)].slice(0, 20).join("; ")}`);

  const sig = page.locator(perfil.seletores.docSigilo[0]).last();
  if (await sig.count()) await selecionarPorTexto(sig, d.sigilo === "1" ? "Segredo de Justi" : "Sem Sigilo", "documentos", "docSigilo", false);

  const marca = marcaDialogos();
  await (await achar(page, perfil, "docEnviar", "documentos")).click();
  await page.waitForLoadState("networkidle").catch(() => {});

  // O eproc recusa por alert(), que o handler aceita em silencio. Sem isto a recusa passa batida.
  const recusas = dialogosDesde(marca).filter((d) => d.startsWith("alert:"));
  if (recusas.length)
    throw new EtapaError("documentos", "docEnviar",
      `o eproc recusou o envio de "${basename(caminho)}": ${recusas.join(" | ")}`);

  const inicio = Date.now();
  while (Date.now() - inicio < 30000) {
    if ((await lerTabelaDocumentos(page)).n > antes) {
      rel.preenchido[`doc:${basename(caminho)}`] = d.tipo;
      log(`documento enviado: ${basename(caminho)} (${d.tipo})`);
      return;
    }
    await page.waitForTimeout(500);
  }
  throw new EtapaError("documentos", "docTabela", `"${basename(caminho)}" nao apareceu na tabela apos o envio`);
}
