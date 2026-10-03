import type { Page } from "playwright";
import { writeFileSync } from "node:fs";
import type { PerfilTribunal } from "./types.js";

const SCRIPT = `(() => {
  const labelDe = (el) => {
    const id = el.getAttribute("id");
    const byFor = id ? (document.querySelector('label[for="' + id + '"]') || {}).textContent : null;
    const pai = el.closest("label") ? el.closest("label").textContent : null;
    const prev = el.previousElementSibling ? el.previousElementSibling.textContent : null;
    return (byFor || pai || prev || "").trim().slice(0, 80);
  };
  return Array.from(document.querySelectorAll("input, select, textarea, button, a.btn, a[href*='acao=']"))
    .filter((el) => el.offsetParent !== null)
    .map((e) => ({
      tag: e.tagName.toLowerCase(),
      type: e.type || null,
      name: e.name || null,
      id: e.id || null,
      value: e.value ? String(e.value).slice(0, 40) : null,
      texto: (e.textContent || "").trim().slice(0, 60) || null,
      label: labelDe(e),
      opcoes: e.tagName === "SELECT" ? Array.from(e.options).slice(0, 40).map((o) => (o.textContent || "").trim()) : undefined,
    }));
})()`;

export async function descobrirCampos(page: Page, perfil: PerfilTribunal, arquivoSaida: string) {
  console.log("Navegue manualmente ate a tela que quer mapear e pressione ENTER no terminal...");
  await new Promise<void>((r) => process.stdin.once("data", () => r()));
  const campos = await page.evaluate(SCRIPT);
  const saida = { url: page.url(), titulo: await page.title(), tribunal: perfil.id, campos };
  writeFileSync(arquivoSaida, JSON.stringify(saida, null, 2));
  console.log(`Mapeados ${(campos as any[]).length} elementos -> ${arquivoSaida}`);
}
