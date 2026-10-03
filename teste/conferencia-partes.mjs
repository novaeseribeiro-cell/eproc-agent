import { conferirParteRetornada } from '../dist/agent.js';

const casos = [
  // [descricao, linha do tribunal, parte, esperado: 'ok' | 'parcial' | 'grave']
  ['PF exata',
   'Física 111.444.777-35 ANTONIO CARLOS PEREIRA Data Nascim.: 05/06/1986 - Mãe: MARIA APARECIDA PEREIRA RÉU Sim Não Incluir',
   { tipo:'PF', documento:'11144477735', nome:'ANTONIO CARLOS PEREIRA' }, 'ok'],

  ['PF com acento e caixa diferente',
   'Física 529.982.247-25 BEATRIZ HELENA DOS SANTOS SOUZA Data Nascim.: 24/08/1986',
   { tipo:'PF', documento:'52998224725', nome:'Beatriz Helena dos Santos Souza' }, 'ok'],

  ['PF sobrenome a mais no pedido -> parcial',
   'Física 529.982.247-25 BEATRIZ HELENA DOS SANTOS',
   { tipo:'PF', documento:'52998224725', nome:'BEATRIZ HELENA DOS SANTOS SOUZA' }, 'parcial'],

  ['PF homonimo com nascimento diferente -> GRAVE',
   'Física 529.982.247-25 BEATRIZ HELENA DOS SANTOS SOUZA Data Nascim.: 11/03/1974',
   { tipo:'PF', documento:'52998224725', nome:'BEATRIZ HELENA DOS SANTOS SOUZA',
     qualificacao:{ dataNascimento:'24/08/1986' } }, 'grave'],

  ['PF homonimo, nascimento no nivel da parte (caminho do lote) -> GRAVE',
   'Física 529.982.247-25 BEATRIZ HELENA DOS SANTOS SOUZA Data Nascim.: 11/03/1974',
   { tipo:'PF', documento:'52998224725', nome:'BEATRIZ HELENA DOS SANTOS SOUZA',
     dataNascimento:'24/08/1986' }, 'grave'],

  ['PF nascimento no nivel da parte que CONFERE -> ok',
   'Física 529.982.247-25 BEATRIZ HELENA DOS SANTOS SOUZA Data Nascim.: 24/08/1986',
   { tipo:'PF', documento:'52998224725', nome:'BEATRIZ HELENA DOS SANTOS SOUZA',
     dataNascimento:'24/08/1986' }, 'ok'],

  ['PJ banco com sufixo S.A. -> ok',
   'Jurídica 60.746.948/0001-12 BANCO BRADESCO S.A.',
   { tipo:'PJ', documento:'60746948000112', nome:'BANCO BRADESCO' }, 'ok'],

  ['PJ banco ERRADO (CNPJ do modelo trocado) -> GRAVE',
   'Jurídica 60.701.190/0001-04 ITAU UNIBANCO S.A.',
   { tipo:'PJ', documento:'60701190000104', nome:'BANCO BRADESCO' }, 'grave'],

  ['documento nao aparece na linha -> GRAVE',
   'Física 111.222.333-44 ANTONIO CARLOS PEREIRA',
   { tipo:'PF', documento:'11144477735', nome:'ANTONIO CARLOS PEREIRA' }, 'grave'],

  ['PJ LTDA vs sem LTDA -> ok',
   'Jurídica 12.345.678/0001-99 SERRARIA PONTE BONITA LTDA',
   { tipo:'PJ', documento:'12345678000199', nome:'Serraria Ponte Bonita' }, 'ok'],

  ['PJ banco trocado compartilhando a palavra BANCO -> GRAVE',
   'Jurídica 90.400.888/0001-42 BANCO SANTANDER (BRASIL) S.A.',
   { tipo:'PJ', documento:'90400888000142', nome:'BANCO BRADESCO' }, 'grave'],

  ['PJ com palavra a mais no pedido -> GRAVE (nao ignoravel)',
   'Jurídica 12.345.678/0001-99 SERRARIA PONTE LTDA',
   { tipo:'PJ', documento:'12345678000199', nome:'Serraria Ponte Bonita' }, 'grave'],

  ['PF continua parcial (ignoravel)',
   'Física 111.111.111-11 MARIA DA SILVA',
   { tipo:'PF', documento:'11111111111', nome:'MARIA DA SILVA SANTOS' }, 'parcial'],
];

let falhas = 0;
for (const [desc, linha, parte, esperado] of casos) {
  const r = conferirParteRetornada(linha, parte);
  const obtido = r.ok ? 'ok' : (r.grave ? 'grave' : 'parcial');
  const passou = obtido === esperado;
  if (!passou) falhas++;
  console.log(`${passou ? 'OK  ' : 'FALHA'} | ${desc}`);
  console.log(`       esperado=${esperado} obtido=${obtido}${r.motivo ? ' :: ' + r.motivo : ''}`);
}
console.log(`\n${casos.length - falhas}/${casos.length} passaram`);
process.exit(falhas ? 1 : 0);
