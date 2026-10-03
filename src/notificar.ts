import type { Relatorio } from "./agent.js";

export async function notificar(rel: Relatorio) {
  const url = process.env.WEBHOOK_URL;
  if (!url) return;
  const texto = rel.status === "pronto_para_conferencia"
    ? `eproc-agent: acao ${rel.pedidoId} cadastrada e aguardando conferencia. Confira e clique em Protocolar.`
    : `eproc-agent: acao ${rel.pedidoId} FALHOU na etapa ${rel.etapaFalha}: ${rel.mensagem}`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(process.env.WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.WEBHOOK_TOKEN}` } : {}) },
      body: JSON.stringify({ ...rel, texto }),
    });
  } catch (e) { console.warn("webhook falhou:", e); }
}
