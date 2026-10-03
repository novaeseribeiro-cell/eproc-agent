import type { Page } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { achar, esperarOpcoes } from "./browser.js";
import type { PerfilTribunal } from "./types.js";

export interface CatalogoComarca { comarca: string; capturadoEm: string; ritos: string[]; areas: Record<string, string[]>; }
export interface Catalogo { tribunal: string; comarcas: string[]; porComarca: Record<string, CatalogoComarca>; }

const arquivo = (t: string) => resolve(`catalogo/${t}.json`);

export function carregar(tribunal: string): Catalogo {
  const p = arquivo(tribunal);
  if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  return { tribunal, comarcas: [], porComarca: {} };
}
export function salvar(c: Catalogo) {
  mkdirSync("catalogo", { recursive: true });
  writeFileSync(arquivo(c.tribunal), JSON.stringify(c, null, 2));
}

const ler = (page: Page, sel: string) =>
  page.locator(sel).evaluate((el: HTMLSelectElement) =>
    Array.from(el.options).map((o) => (o.textContent || "").trim()).filter((t) => t && !t.startsWith("--")));

/**
 * Captura, na tela 1, as areas e as classes de UMA comarca. Uma visita, sem avancar etapa.
 * Guarda em catalogo/<tribunal>.json para que as validacoes seguintes sejam offline.
 */
export async function capturarComarca(page: Page, perfil: PerfilTribunal, comarca: string, cat: Catalogo): Promise<CatalogoComarca> {
  const s = perfil.seletores;
  const selComarca = await achar(page, perfil, "comarca", "dados_acao");
  if (!cat.comarcas.length) cat.comarcas = await ler(page, s.comarca[0]);

  const opt = cat.comarcas.find((c) => c === comarca) ?? cat.comarcas.find((c) => c.toLowerCase() === comarca.toLowerCase());
  if (!opt) throw new Error(`comarca "${comarca}" nao existe no ${perfil.nome}. Disponiveis: ${cat.comarcas.join("; ")}`);
  await selComarca.selectOption({ label: opt });
  await selComarca.dispatchEvent("change");
  await esperarOpcoes(await achar(page, perfil, "rito", "dados_acao"), 2, 15000);

  const ritos = await ler(page, s.rito[0]);
  const areas: Record<string, string[]> = {};
  const selRito = await achar(page, perfil, "rito", "dados_acao");
  const selArea = await achar(page, perfil, "area", "dados_acao");

  for (const rito of ritos) {
    await selRito.selectOption({ label: rito });
    await selRito.dispatchEvent("change");
    await esperarOpcoes(selArea, 2, 15000);
    for (const area of await ler(page, s.area[0])) {
      const chave = `${rito} :: ${area}`;
      if (areas[chave]) continue;
      await selArea.selectOption({ label: area });
      await selArea.dispatchEvent("change");
      await esperarOpcoes(await achar(page, perfil, "classe", "dados_acao"), 2, 15000).catch(() => {});
      areas[chave] = await ler(page, s.classe[0]);
      console.log(`[catalogo] ${opt} | ${chave}: ${areas[chave].length} classes`);
    }
  }
  const entrada: CatalogoComarca = { comarca: opt, capturadoEm: new Date().toISOString(), ritos, areas };
  cat.porComarca[opt] = entrada;
  salvar(cat);
  return entrada;
}

/**
 * Uma opcao de competencia: rito + area + classe, do jeito que o eproc nomeia.
 * O modelo de acao declara uma LISTA delas, em ordem de preferencia, e o agente pega a
 * primeira que EXISTIR na comarca. Isso e o que faz o mesmo modelo atravessar comarcas
 * diferentes: Campo Grande tem Vara Bancaria, a maioria das comarcas nao tem.
 * Nao e exclusivo de acao bancaria — vale para qualquer tipo de acao.
 */
export interface Competencia { rito: string; area: string; classeCNJ: string; }

const NORM = (s: string) =>
  (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ").trim();

/** Igualdade tolerante a acento, caixa, hifen e travessao ("Cível - Bancária" == "Civel Bancaria"). */
const IGUAL = (a: string, b: string) => NORM(a) === NORM(b);

/**
 * Primeira competencia da lista que existe nesta comarca. Devolve tambem o indice, para o
 * relatorio dizer se caiu na preferida ou numa alternativa — cair na terceira opcao em 300 acoes
 * sem ninguem perceber seria pior do que parar.
 */
export function escolherCompetencia(
  cat: Catalogo, comarca: string, preferencias: Competencia[],
): { escolhida: Competencia; posicao: number; consideradas: string[] } | { erro: string } {
  const c = cat.porComarca[comarca];
  if (!c) return { erro: `comarca "${comarca}" ainda nao catalogada` };
  if (!preferencias.length) return { erro: "modelo sem preferenciaCompetencia" };

  const consideradas: string[] = [];
  for (const [i, pref] of preferencias.entries()) {
    const rito = c.ritos.find((r) => IGUAL(r, pref.rito));
    if (!rito) { consideradas.push(`${pref.rito} :: ${pref.area} -> rito nao existe aqui`); continue; }

    const chave = Object.keys(c.areas).find((k) => {
      const [r, a] = k.split(" :: ");
      return IGUAL(r, pref.rito) && IGUAL(a, pref.area);
    });
    if (!chave) { consideradas.push(`${pref.rito} :: ${pref.area} -> area nao existe neste rito`); continue; }

    const classe = c.areas[chave].find((x) => IGUAL(x, pref.classeCNJ));
    if (!classe) {
      consideradas.push(`${pref.rito} :: ${pref.area} -> classe "${pref.classeCNJ}" nao existe. Ha: ${c.areas[chave].slice(0, 6).join("; ")}`);
      continue;
    }
    // devolve os rotulos do TRIBUNAL, nao os do modelo: e o que vai no <select>
    const area = chave.split(" :: ")[1];
    return { escolhida: { rito, area, classeCNJ: classe }, posicao: i, consideradas };
  }
  return { erro: `nenhuma das ${preferencias.length} competencias do modelo existe em ${comarca}:\n    - ` + consideradas.join("\n    - ") };
}

/**
 * Catalogo da comarca sob demanda: se ela ainda nao foi vista, captura AGORA e segue.
 * Chamado com a tela 1 ja aberta. Faz a captura acontecer sozinha na primeira acao de cada
 * comarca nova, em vez de exigir que alguem saiba de antemao a lista de comarcas do lote.
 * Custo: uma varredura de selects por comarca, uma unica vez na vida do catalogo.
 */
export async function garantirComarca(
  page: Page, perfil: PerfilTribunal, comarca: string, cat: Catalogo,
): Promise<{ entrada: CatalogoComarca; capturadaAgora: boolean }> {
  const ja = cat.porComarca[comarca];
  if (ja) return { entrada: ja, capturadaAgora: false };
  console.log(`[catalogo] comarca "${comarca}" ainda nao catalogada — capturando agora`);
  const entrada = await capturarComarca(page, perfil, comarca, cat);
  return { entrada, capturadaAgora: true };
}

/** Validacao 100% offline do pedido contra o catalogo ja capturado. */
export function validar(cat: Catalogo, p: { comarca: string; rito: string; area: string; classeCNJ: string }): string[] {
  const erros: string[] = [];
  const c = cat.porComarca[p.comarca];
  if (!c) return [`comarca "${p.comarca}" ainda nao catalogada — rode: npm run catalogo -- "${p.comarca}"`];
  if (!c.ritos.includes(p.rito)) erros.push(`rito "${p.rito}" invalido em ${p.comarca}. Opcoes: ${c.ritos.join("; ")}`);
  const chave = `${p.rito} :: ${p.area}`;
  if (!(chave in c.areas)) {
    const doRito = Object.keys(c.areas).filter((k) => k.startsWith(`${p.rito} ::`)).map((k) => k.split(" :: ")[1]);
    erros.push(`area "${p.area}" nao existe para o rito "${p.rito}" em ${p.comarca}. Opcoes: ${doRito.join("; ")}`);
  } else if (!c.areas[chave].includes(p.classeCNJ)) {
    erros.push(`classe "${p.classeCNJ}" nao existe em ${chave}. Opcoes: ${c.areas[chave].join("; ")}`);
  }
  return erros;
}
