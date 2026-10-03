import { z } from "zod";

/** Endereco para cadastro de parte nova (tela "Novo" / Cadastro de Pessoa). */
export const EnderecoSchema = z.object({
  tipo: z.enum(["Residencial", "Comercial"]).default("Residencial"),
  cep: z.string().min(8),
  logradouro: z.string().min(2).max(50),
  numero: z.string().min(1).max(10),
  complemento: z.string().max(50).optional(),
  bairro: z.string().min(2).max(25),
  pais: z.string().default("Brasil"),
  uf: z.string().length(2),
  cidade: z.string().min(2),
});

/**
 * Qualificacao completa, exigida para CADASTRAR parte inexistente.
 * Obrigatorios de formulario no eproc TJMS (label .infraLabelObrigatorio):
 * nome, sexo, estadoCivil, dataNascimento, nacionalidade.
 * Endereco e contato nao sao obrigatorios de formulario, mas sao obrigatorios de negocio:
 * sem endereco o reu nao e citado.
 * NAO existem campos de LGBTI / identidade de genero / orientacao sexual aqui de proposito:
 * o eproc ja os deixa em "Nao informado" e o agente nao deve inferir dado sensivel de peticao.
 */
export const QualificacaoSchema = z.object({
  sexo: z.enum(["Feminino", "Masculino", "Intersexo"]),
  estadoCivil: z.enum(["Casado", "Companheiro", "Divorciado", "Não Informado", "Separado", "Solteiro", "União Estável", "Viúvo"]),
  dataNascimento: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, "use dd/mm/aaaa"),
  nacionalidade: z.string().default("Brasileiro"),
  profissao: z.string().max(30).optional(),
  mae: z.string().max(50).optional(),
  pai: z.string().max(50).optional(),
  documento: z.object({
    tipo: z.string(),                              // ex.: Registro Geral
    numero: z.string().max(32),
  }).optional(),
  endereco: EnderecoSchema.optional(),
  contato: z.object({
    tipo: z.enum(["Telefone", "E-mail", "Celular"]),
    valor: z.string().max(100),
  }).optional(),
});
export type Qualificacao = z.infer<typeof QualificacaoSchema>;

export const ParteSchema = z.object({
  tipo: z.enum(["PF", "PJ", "ENTIDADE"]).default("PF"),
  documento: z.string().optional(),
  nome: z.string().min(2),
  semDocumento: z.boolean().default(false),
  motivoSemDocumento: z.string().optional(),     // ESTRANGEIRO SEM CPF, MENOR DE IDADE, SEM DOCUMENTOS...
  principal: z.boolean().default(true),
  justicaGratuita: z.boolean().default(false),   // so para autores
  /** P5: so cadastra parte inexistente quando explicitamente autorizado no pedido. */
  cadastrarSeNaoExistir: z.boolean().default(false),
  /**
   * P8: escotilha para divergencia PARCIAL de nome (sobrenome a mais ou a menos, grafia).
   * NAO cobre divergencia grave — documento que nao bate, nenhuma palavra em comum ou data de
   * nascimento diferente abortam sempre, com ou sem isto. Fica registrado no relatorio quando usado.
   */
  aceitarNomeDivergente: z.boolean().default(false),
  /**
   * P8: data de nascimento SO para conferencia de homonimo na etapa 3.
   * Nao serve para cadastrar — cadastro exige qualificacao completa (QualificacaoSchema).
   * Existe separada porque no lote a peticao quase sempre traz a data e quase nunca traz
   * sexo/estado civil, e exigir a qualificacao inteira so para conferir seria travar as 400.
   */
  dataNascimento: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, "use dd/mm/aaaa").optional(),
  qualificacao: QualificacaoSchema.optional(),
});

export const DocumentoSchema = z.object({
  arquivo: z.string(),
  tipo: z.string(),                              // ex.: PETIÇÃO INICIAL, PROCURAÇÃO
  sigilo: z.enum(["0", "1"]).default("0"),
});

export const PedidoSchema = z.object({
  id: z.string(),
  tribunal: z.string(),
  acao: z.object({
    comarca: z.string(),
    rito: z.string().default("RITO ORDINÁRIO (COMUM)"),
    area: z.string(),
    classeCNJ: z.string(),
    /**
     * P2: codigo CNJ do assunto — e o ID do no na arvore jsTree do eproc.
     * Selecionar por codigo e deterministico. Selecionar por texto e ambiguo:
     * "Indenizacao por Dano Moral" existe em Direito Administrativo (010206),
     * Direito Civil (022003) e Direito do Consumidor (060503).
     */
    /**
     * OPCIONAL desde 11/09/2026. Quando vem, manda: selecao deterministica por ID do no.
     * Quando NAO vem, o agente resolve na hora contra a arvore daquela comarca+area:
     * filtra por `assuntoPrincipal` e so aceita se restar EXATAMENTE UMA folha. Duas ou mais,
     * ou nenhuma, ele para aquela comarca e lista os candidatos — nunca escolhe no ambiguo.
     * O codigo resolvido fica em cache por comarca+area+termo e nao e resolvido de novo.
     * Isto existe porque o lote atravessa comarcas que ninguem catalogou ainda, e a arvore
     * muda com a competencia: fixar um codigo global seria adivinhar.
     */
    assuntoCodigo: z.string().regex(/^(?:\d{2}){2,6}$/,
      "codigo CNJ do assunto: pares de digitos, 2 a 6 niveis (ex.: 022003 com 3 niveis, 02190338 com 4)").optional(),
    assuntoPrincipal: z.string(),                                    // termo de filtro E chave da resolucao automatica
    /**
     * Conferencia do ramo. Vazio desliga a conferencia — util quando o ramo varia por comarca
     * e e justamente o que se quer descobrir. Quando preenchido, folha fora do ramo para a comarca.
     */
    assuntoRamo: z.string().default(""),
    assuntosSecundarios: z.array(z.string()).default([]),            // codigo de 6 digitos ou texto
    valorCausa: z.string(),
    valorNaoSeAplica: z.boolean().default(false),
    nivelSigilo: z.enum(["0", "1"]).default("0"),
  }),
  partes: z.object({
    autores: z.array(ParteSchema).min(1),
    reus: z.array(ParteSchema).min(1),
  }),
  documentos: z.array(DocumentoSchema).min(1),
  marcacoes: z.object({
    liminarTutela: z.boolean().default(false),
    prioridadeDoencaGrave: z.boolean().default(false),
    prioridadeIdoso: z.boolean().default(false),
    prioridadeDeficiente: z.boolean().default(false),
    prioridadeCrianca: z.boolean().default(false),
    lei14289: z.boolean().default(false),
    juizoDigital: z.boolean().default(false),
    semInteresseConciliar: z.boolean().default(false),
  }).default({}),
  /**
   * P3: a tabela de documentos da etapa 5 e server-side e presa a conta — sobrevive a Cancelar,
   * troca de sessao e troca de navegador. Se houver residuo, o padrao e ABORTAR.
   * Apagar arquivo do usuario sem ele pedir e pior que parar.
   */
  limparResiduais: z.boolean().default(false),
  finalizacao: z.enum(["parar", "salvar_distribuicao_futura"]).default("parar"),
  notificar: z.object({ whatsapp: z.string().optional() }).optional(),
});
export type Pedido = z.infer<typeof PedidoSchema>;
export type Parte = z.infer<typeof ParteSchema>;

/**
 * MODELO DE ACAO — a parte do cadastro que e igual em todas as acoes de um mesmo tipo.
 * Nao e especifico de acao bancaria: e o formato para QUALQUER tipo repetitivo.
 * O que varia acao a acao (partes, valor, comarca, documentos) vem da planilha do lote;
 * o que varia de COMARCA para comarca (area, classe, codigo do assunto) o agente resolve
 * contra o proprio tribunal. O modelo so declara politica.
 */
export const CompetenciaSchema = z.object({
  rito: z.string(),
  area: z.string(),
  classeCNJ: z.string(),
});
export type Competencia = z.infer<typeof CompetenciaSchema>;

export const ModeloAcaoSchema = z.object({
  nome: z.string(),
  /**
   * Ordem de preferencia. O agente usa a PRIMEIRA que existir na comarca.
   * Campo Grande tem Vara Bancaria; a maioria das comarcas nao tem e cai na proxima da lista.
   */
  preferenciaCompetencia: z.array(CompetenciaSchema).min(1),
  /** Termo do assunto, como o tribunal escreve. E o filtro E a chave da resolucao por comarca. */
  assuntoPrincipal: z.string(),
  /** Conferencia do ramo. Vazio desliga — use vazio quando o ramo varia por comarca. */
  assuntoRamo: z.string().default(""),
  assuntosSecundarios: z.array(z.string()).default([]),
  /** Override por comarca, quando o advogado ja fixou o codigo. Chave: nome da comarca. */
  assuntoCodigoPorComarca: z.record(z.string()).default({}),
  nivelSigilo: z.enum(["0", "1"]).default("0"),
  marcacoes: z.record(z.boolean()).default({}),
  finalizacao: z.enum(["parar", "salvar_distribuicao_futura"]).default("parar"),
  tipoAutorPadrao: z.enum(["PF", "PJ", "ENTIDADE"]).default("PF"),
  tipoReuPadrao: z.enum(["PF", "PJ", "ENTIDADE"]).default("PJ"),
  /** nome -> documento. Fallback para quando a peca nao traz o numero. Autor ou reu, tanto faz. */
  partesConhecidas: z.record(z.string()).default({}),
  tiposDocumento: z.record(z.object({ sigilo: z.enum(["0", "1"]).default("0") })).default({}),
}).passthrough();   // deixa passar as chaves _nota_*, que sao documentacao dentro do JSON
export type ModeloAcao = z.infer<typeof ModeloAcaoSchema>;

export const PerfilTribunalSchema = z.object({
  id: z.string(),
  nome: z.string(),
  baseUrl: z.string().url(),
  calibradoEm: z.string().optional(),
  urls: z.record(z.string()),
  seletores: z.record(z.array(z.string())),
  funcoesPagina: z.record(z.string()).optional(),
  assuntosConhecidos: z.record(z.string()).optional(),
  observacoes: z.array(z.string()).optional(),
});
export type PerfilTribunal = z.infer<typeof PerfilTribunalSchema>;

export type Etapa = "login" | "menu" | "dados_acao" | "assuntos" | "partes_autores" | "partes_reus" | "documentos" | "conferencia";

export class EtapaError extends Error {
  constructor(public etapa: Etapa, public chave: string, msg: string) {
    super(`[${etapa}] ${chave}: ${msg}`);
  }
}
