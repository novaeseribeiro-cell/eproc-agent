import { chromium, type BrowserContext, type Page, type Locator } from "playwright";
import type { PerfilTribunal } from "./types.js";
import { EtapaError, type Etapa } from "./types.js";

/**
 * Dialogos aceitos nesta execucao. Vai para o relatorio: e a prova de o que foi confirmado.
 * O eproc usa confirm() em acoes destrutivas (exclusao de documento anexo).
 */
export const dialogosAceitos: string[] = [];

/** Marca a posicao atual da lista, para depois perguntar o que apareceu desde entao. */
export function marcaDialogos(): number { return dialogosAceitos.length; }

/**
 * Dialogos surgidos depois da marca. Serve para transformar em erro um `alert()` de recusa do
 * eproc que, sem isto, seria aceito em silencio pelo handler e passaria despercebido.
 */
export function dialogosDesde(marca: number): string[] { return dialogosAceitos.slice(marca); }

/**
 * P1 — ACEITAR DIALOGOS.
 * Sem isto, TODO confirm() da tela responde "false" (padrao do Playwright) e a acao nunca acontece.
 * Foi a causa raiz do "X nao exclui documento": excluirDocumento() chama alert_excluir(),
 * que chama confirm(). Com o dialogo dispensado, o AJAX de exclusao jamais era enviado.
 */
let modoConferencia = false;

/**
 * Depois que o agente termina, a tela e do advogado. Nenhum dialogo e aceito sozinho:
 * cada confirm()/alert() aparece no terminal e so e aceito se o advogado digitar "s".
 * Necessario porque Ctrl+C encerra o Node E o Chromium filho (a aba some junto).
 */
export function entrarModoConferencia() { modoConferencia = true; }
/** So o agente trabalhando aceita dialogos sozinho. Login e conferencia sao do advogado. */
export function sairModoConferencia() { modoConferencia = false; }

function perguntarNoTerminal(texto: string): Promise<boolean> {
  return new Promise((r) => {
    console.log(`\n[eproc-agent] O eproc pergunta:\n  ${texto.replace(/\n/g, "\n  ")}\nDigite s + ENTER para CONFIRMAR, ou so ENTER para recusar:`);
    process.stdin.resume();
    process.stdin.once("data", (b) => { process.stdin.pause(); r(/^\s*s/i.test(String(b))); });
  });
}

function armarDialogos(ctx: BrowserContext) {
  const armar = (p: Page) => {
    p.on("dialog", async (d) => {
      const linha = `${d.type()}: ${d.message()}`;
      if (modoConferencia) {
        if (d.type() === "alert") { console.log(`[eproc-agent] [aviso do eproc] ${d.message()}`); await d.accept().catch(() => {}); return; }
        const ok = await perguntarNoTerminal(d.message());
        console.log(`[eproc-agent] [dialogo ${ok ? "CONFIRMADO" : "recusado"} pelo advogado] ${linha}`);
        await (ok ? d.accept() : d.dismiss()).catch(() => {});
        return;
      }
      dialogosAceitos.push(linha);
      console.log(`[eproc-agent] [dialogo aceito] ${linha}`);
      await d.accept().catch(() => {});
    });
  };
  ctx.pages().forEach(armar);
  ctx.on("page", armar);
}

export async function abrirNavegador(profileDir: string, headless = false): Promise<BrowserContext> {
  // Perfil persistente: a sessao e o 2FA validado sobrevivem entre execucoes.
  // O advogado faz login UMA vez (com o codigo do autenticador) e o agente reaproveita.
  // O agente NUNCA faz login sozinho: o 2FA e obrigatorio e nao pode ser desativado.
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless,
    viewport: { width: 1366, height: 900 },
    locale: "pt-BR",
    args: ["--disable-blink-features=AutomationControlled"],
  });
  armarDialogos(ctx);
  return ctx;
}

/** Tenta cada seletor do perfil, em ordem, e devolve o primeiro que existe. */
export async function achar(page: Page, perfil: PerfilTribunal, chave: string, etapa: Etapa, timeoutMs = 8000): Promise<Locator> {
  const lista = perfil.seletores[chave];
  if (!lista?.length) throw new EtapaError(etapa, chave, "chave ausente no perfil do tribunal");
  const fatia = Math.max(1500, Math.floor(timeoutMs / lista.length));
  for (const sel of lista) {
    const loc = page.locator(sel).first();
    try {
      await loc.waitFor({ state: "visible", timeout: fatia });
      return loc;
    } catch { /* tenta o proximo */ }
  }
  throw new EtapaError(etapa, chave, `nenhum seletor encontrado: ${lista.join(" | ")}`);
}

export async function existe(page: Page, perfil: PerfilTribunal, chave: string, timeoutMs = 3000): Promise<boolean> {
  try { await achar(page, perfil, chave, "menu", timeoutMs); return true; } catch { return false; }
}

const NORM = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const LER_OPCOES = (el: HTMLSelectElement) => Array.from(el.options).map((o) => ({ value: o.value, label: (o.textContent || "").trim() }));

/** Espera o <select> ter mais de N opcoes (para campos carregados por AJAX apos outro select). */
export async function esperarOpcoes(loc: Locator, minimo = 2, timeoutMs = 10000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    const n = ((await loc.evaluate(LER_OPCOES)) as { label: string }[]).filter((o) => o.label).length;
    if (n >= minimo) return;
    await loc.page().waitForTimeout(300);
  }
}

/**
 * Seleciona opcao de <select> por texto. `exato=true` (padrao nos campos juridicos) NAO adivinha:
 * se nao houver correspondencia exata (ignorando acento/caixa), aborta listando as opcoes.
 */
export async function selecionarPorTexto(loc: Locator, texto: string, etapa: Etapa, chave: string, exato = true) {
  const alvo = NORM(texto);
  const opcoes = (await loc.evaluate(LER_OPCOES)) as { value: string; label: string }[];
  const validas = opcoes.filter((o) => o.label);
  const achado = validas.find((o) => NORM(o.label) === alvo)
    ?? (exato ? undefined : validas.filter((o) => NORM(o.label).includes(alvo)).sort((a, b) => a.label.length - b.label.length)[0]);
  if (!achado) throw new EtapaError(etapa, chave, `opcao "${texto}" nao existe (exigida correspondencia exata). Disponiveis: ${validas.map((o) => o.label).join("; ")}`);
  await loc.selectOption(achado.value);
  await loc.dispatchEvent("change");
  return achado.label;
}

export async function screenshot(page: Page, pasta: string, nome: string) {
  const { mkdirSync } = await import("node:fs");
  mkdirSync(pasta, { recursive: true });
  const caminho = `${pasta}/${nome}.png`;
  await page.screenshot({ path: caminho, fullPage: true });
  return caminho;
}
