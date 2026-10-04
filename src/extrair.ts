import { readFileSync } from "node:fs";

/**
 * Texto de um PDF. Com `maxPaginas`, so as primeiras paginas (classificar documento).
 * Sem ele, a peca inteira: o VALOR DA CAUSA e os pedidos ficam no FIM da inicial, e ler so as
 * 6 primeiras paginas deixava valor_causa vazio (visto em 04/10 na amostra de Campo Grande).
 */
export async function textoPdf(caminho: string, maxPaginas = 0): Promise<string> {
  const mod: any = await import("pdf-parse");
  const pdfParse = mod.default ?? mod;
  const data = await pdfParse(readFileSync(caminho), maxPaginas ? { max: maxPaginas } : {});
  return (data.text || "").replace(/\s+\n/g, "\n").trim();
}

/** Inicio (enderecamento, partes) + fim (pedidos, valor da causa) dentro do limite de caracteres. */
export function inicioEFim(texto: string, limite = 24000): string {
  if (texto.length <= limite) return texto;
  const cabeca = Math.floor(limite * 0.6);
  return texto.slice(0, cabeca) + "\n\n[... trecho do meio omitido ...]\n\n" + texto.slice(-(limite - cabeca));
}

export interface Extraido {
  comarca: string | null;
  rito: string | null;              // JUIZADO ESPECIAL ESTADUAL | RITO ORDINÁRIO (COMUM) | null
  /**
   * Listas, nao objetos unicos: litisconsorcio ativo ou passivo e comum e nao e excecao.
   * `documento` sai como veio da peca; quem limpa para digitos e o lote.
   */
  autores: { nome: string; documento: string; nascimento: string | null }[];
  reus: { nome: string; documento: string }[];
  valorCausa: string | null;        // "5000,00"
  justicaGratuita: boolean | null;
  tutela: boolean | null;
  /**
   * Como a PROPRIA peticao se nomeia ("acao revisional de contrato bancario",
   * "indenizacao por dano moral"). NAO e codigo CNJ e nao vira assuntoCodigo sozinho:
   * serve para o lote flagrar divergencia contra o assunto do modelo ANTES de rodar 400 vezes.
   */
  assuntoDeclarado: string | null;
  /** O que faltou ou ficou ambiguo, um item por pendencia. Lista vazia = nada a conferir. */
  pendencias: string[];
  confianca: number;                // 0..1
  observacoes: string;
}

const SISTEMA = `Voce extrai dados de peticoes iniciais brasileiras para cadastro no eproc.
Responda SOMENTE um JSON com as chaves: comarca, rito, autores[{nome,documento,nascimento}], reus[{nome,documento}], valorCausa, justicaGratuita, tutela, assuntoDeclarado, pendencias, confianca, observacoes.
Regras: comarca = cidade do enderecamento ("Juizo de Direito da ... Comarca de X" / "Juizado Especial Civel de X"); rito = "JUIZADO ESPECIAL ESTADUAL" se enderecada a Juizado Especial, "RITO ORDINÁRIO (COMUM)" se a vara comum, null se nao ficar claro;
cpf/cnpj apenas digitos; valorCausa no formato "1234,56"; justicaGratuita true se ha pedido de gratuidade; tutela true se ha pedido de tutela de urgencia/liminar;
autores e reus sao LISTAS: inclua TODOS os do polo, na ordem em que a peca traz, mesmo que seja um so;
documento = CPF ou CNPJ, so digitos, string vazia se a peca nao trouxer;
nascimento no formato dd/mm/aaaa, null se a peticao nao trouxer;
assuntoDeclarado = como a propria peticao nomeia a acao, na letra dela, sem traduzir para o vocabulario do CNJ;
pendencias = SOMENTE o que impede ou arrisca o CADASTRO no eproc: comarca ou rito incertos, parte sem nome, CPF/CNPJ ausente ou ilegivel, valor da causa ausente ou ambiguo, mais de um valor possivel (ex.: "CPF do autor ausente"); lista vazia se nada disso faltou;
NAO sao pendencia (vao em observacoes, se quiser): numero da vara em branco no enderecamento (e normal, a distribuicao sorteia), data de nascimento ausente, numero de contrato, dados de merito, tabelas ou imagens que nao vieram no texto;
confianca entre 0 e 1 refletindo a certeza global; observacoes com o que ficou ambiguo. Nunca invente: use null quando o texto nao trouxer o dado.`;

export async function extrairDaPeticao(texto: string): Promise<Extraido> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY nao definida no .env");
  const model = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 1500, system: SISTEMA,
      messages: [{ role: "user", content: `TEXTO DA PETICAO:\n\n${inicioEFim(texto)}` }] }),
  });
  if (!r.ok) throw new Error(`API Anthropic ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j: any = await r.json();
  const raw = (j.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
  const limpo = raw.replace(/```json|```/g, "").trim();
  const ini = limpo.indexOf("{"), fim = limpo.lastIndexOf("}");
  const ex = JSON.parse(limpo.slice(ini, fim + 1)) as Extraido;
  // O modelo as vezes omite chave. Normaliza para o lote nao quebrar em undefined.
  if (!Array.isArray(ex.pendencias)) ex.pendencias = [];
  if (!Array.isArray(ex.autores)) ex.autores = [];
  if (!Array.isArray(ex.reus)) ex.reus = [];
  for (const p of [...ex.autores, ...ex.reus]) p.documento = String(p.documento ?? "");
  if (ex.assuntoDeclarado === undefined) ex.assuntoDeclarado = null;
  return ex;
}

/**
 * Classificacao pelo NOME do arquivo. Caminho rapido, e so isso.
 *
 * Nao da para contar com ele: a amostra real da colega vem como `1_INIC1_marianna.pdf` e
 * `2_PROC1.pdf`, que nenhuma lista de palavras razoavel adivinha com seguranca. Por isso
 * existe `classificarDocumento`, que cai no TEXTO quando o nome nao decide.
 * Abreviacoes que aparecem de verdade em cartorio e escritorio entram aqui (INIC, EXORD, PROC).
 */
export function tipoPeloNome(nome: string): string | null {
  const n = nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const tem = (re: RegExp) => re.test(n);
  if (tem(/(^|[^a-z])(inic|inicial|peticao|exord|vestibular)/)) return "PETIÇÃO INICIAL";
  if (tem(/(^|[^a-z])(proc|procura)/) && !tem(/processo/)) return "PROCURAÇÃO";
  if (tem(/hipossuf|gratuid|declara/)) return "DECLARAÇÃO";
  if (tem(/(^|[^a-z])(rg|cpf|cnh|identidade|identific)/)) return "DOCUMENTO DE IDENTIFICAÇÃO";
  if (tem(/comprov|endereco|residencia/)) return "COMPROVANTE DE RESIDÊNCIA";
  if (tem(/contrato|extrato|fatura|boleto|documento/)) return "DOCUMENTO";
  return null;
}

/**
 * Classificacao pelo TEXTO da primeira pagina. Usada quando o nome nao decide.
 * Padroes de forma, nao de materia: servem para qualquer tipo de acao.
 */
export function tipoPeloTexto(texto: string): string | null {
  const t = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (/EXCELENTISSIM|MERITISSIM|\bAO JUIZO\b|\bJUIZ DE DIREITO\b|DA-SE A CAUSA|VALOR DA CAUSA/.test(t)
      && /(PROPOR|AJUIZAR|VEM,? RESPEITOSAMENTE|REQUER)/.test(t)) return "PETIÇÃO INICIAL";
  if (/\bPROCURACAO\b|OUTORGANTE|AD JUDICIA/.test(t)) return "PROCURAÇÃO";
  if (/HIPOSSUFICIENCIA|DECLARO,? PARA OS DEVIDOS FINS|DECLARACAO DE POBREZA/.test(t)) return "DECLARAÇÃO";
  if (/REGISTRO GERAL|CARTEIRA DE IDENTIDADE|CARTEIRA NACIONAL DE HABILITACAO|REPUBLICA FEDERATIVA DO BRASIL/.test(t))
    return "DOCUMENTO DE IDENTIFICAÇÃO";
  if (/COMPROVANTE DE (RESIDENCIA|ENDERECO)|CONTA DE (ENERGIA|AGUA|LUZ)|FATURA/.test(t))
    return "COMPROVANTE DE RESIDÊNCIA";
  return null;
}

export interface DocClassificado { arquivo: string; tipo: string | null; porTexto: boolean; }

/**
 * Nome primeiro (barato), texto depois (seguro), e nunca inventa: o que nao se decide volta
 * com tipo null e vira pendencia na planilha, com o nome do arquivo. Chutar o tipo de um
 * documento faz o tribunal recusar o upload — ja aconteceu, com "Ja foi inserido um documento
 * com o tipo 'Peticao Inicial'".
 */
export async function classificarDocumento(caminho: string, nome: string): Promise<DocClassificado> {
  const porNome = tipoPeloNome(nome);
  if (porNome) return { arquivo: nome, tipo: porNome, porTexto: false };
  try {
    const t = await textoPdf(caminho, 1);
    const porTexto = tipoPeloTexto(t);
    if (porTexto) return { arquivo: nome, tipo: porTexto, porTexto: true };
  } catch { /* PDF ilegivel: cai em null e vira pendencia */ }
  return { arquivo: nome, tipo: null, porTexto: false };
}
