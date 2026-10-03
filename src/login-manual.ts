import type { Page } from "playwright";
import type { PerfilTribunal } from "./types.js";

/** Logado = estamos no controlador.php interno (nao no externo_controlador de login). */
export const logado = (page: Page) =>
  /\/eproc\/controlador\.php/.test(page.url()) && !/externo_controlador/.test(page.url());

export async function loginManual(page: Page, perfil: PerfilTribunal) {
  if (logado(page)) { console.log("[eproc-agent] sessao ativa:", page.url()); return; }
  // Nunca navegar para URL interna sem hash: o eproc responde "Link sem assinatura" e derruba a sessao.
  await page.goto(perfil.urls.login, { waitUntil: "domcontentloaded" }).catch(() => {});
  console.log("[eproc-agent] Faca login no navegador. Quando o PAINEL DO ADVOGADO estiver aberto, pressione ENTER aqui.");
  for (;;) {
    await new Promise<void>((r) => process.stdin.once("data", () => r()));
    if (logado(page)) break;
    console.log("[eproc-agent] ainda em", page.url(), "- conclua o login e pressione ENTER de novo.");
  }
  console.log("[eproc-agent] sessao confirmada:", page.url());
}
