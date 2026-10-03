/**
 * Carrega o .env do diretorio corrente.
 *
 * Ate 11/09/2026 NINGUEM carregava: o .env tinha ANTHROPIC_API_KEY, CADENCIA_SEGUNDOS,
 * PROFILE_DIR e TRIBUNAL preenchidos, e todos chegavam como undefined em process.env.
 * O sintoma era "ANTHROPIC_API_KEY nao definida no .env" com a chave visivelmente la dentro,
 * e a cadencia caindo silenciosamente no padrao. Importar este modulo PRIMEIRO resolve.
 *
 * process.loadEnvFile e nativo do Node (>= 20.6). Sem .env, segue com o ambiente do shell.
 */
try {
  (process as any).loadEnvFile?.(".env");
} catch {
  // .env ausente e situacao normal (VPS com variaveis de ambiente de verdade).
}

export function exigir(nome: string, para: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`${nome} nao definida. Coloque no .env do projeto (ou no ambiente) — e usada para ${para}.`);
  return v;
}
