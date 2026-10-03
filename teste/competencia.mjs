import { escolherCompetencia } from '../dist/catalogo.js';

// Catalogo sintetico com tres comarcas de perfis diferentes, que e o que o lote encontra
// de verdade: uma capital com vara especializada, uma comarca media, e uma so com Juizado.
const cat = {
  tribunal: 'tjms', comarcas: [],
  porComarca: {
    'Campo Grande': {
      comarca: 'Campo Grande', capturadoEm: '', ritos: ['RITO ORDINÁRIO (COMUM)', 'JUIZADO ESPECIAL ESTADUAL'],
      areas: {
        'RITO ORDINÁRIO (COMUM) :: Cível - Bancária': ['PROCEDIMENTO COMUM CÍVEL', 'MONITÓRIA'],
        'RITO ORDINÁRIO (COMUM) :: Cível': ['PROCEDIMENTO COMUM CÍVEL'],
        'JUIZADO ESPECIAL ESTADUAL :: Juizado Especial Cível': ['PROCEDIMENTO DO JUIZADO ESPECIAL CÍVEL'],
      },
    },
    'Dourados': {
      comarca: 'Dourados', capturadoEm: '', ritos: ['RITO ORDINÁRIO (COMUM)', 'JUIZADO ESPECIAL ESTADUAL'],
      areas: {
        'RITO ORDINÁRIO (COMUM) :: Cível': ['PROCEDIMENTO COMUM CÍVEL'],
        'JUIZADO ESPECIAL ESTADUAL :: Juizado Especial Cível': ['PROCEDIMENTO DO JUIZADO ESPECIAL CÍVEL'],
      },
    },
    'Bonito': {
      comarca: 'Bonito', capturadoEm: '', ritos: ['JUIZADO ESPECIAL ESTADUAL'],
      areas: { 'JUIZADO ESPECIAL ESTADUAL :: Juizado Especial Cível': ['PROCEDIMENTO DO JUIZADO ESPECIAL CÍVEL'] },
    },
    'Corumbá': {
      comarca: 'Corumbá', capturadoEm: '', ritos: ['RITO ORDINÁRIO (COMUM)'],
      areas: { 'RITO ORDINÁRIO (COMUM) :: Família': ['DIVÓRCIO LITIGIOSO'] },
    },
  },
};

const PREF = [
  { rito: 'RITO ORDINÁRIO (COMUM)',    area: 'Cível - Bancária',       classeCNJ: 'PROCEDIMENTO COMUM CÍVEL' },
  { rito: 'RITO ORDINÁRIO (COMUM)',    area: 'Cível',                  classeCNJ: 'PROCEDIMENTO COMUM CÍVEL' },
  { rito: 'JUIZADO ESPECIAL ESTADUAL', area: 'Juizado Especial Cível', classeCNJ: 'PROCEDIMENTO DO JUIZADO ESPECIAL CÍVEL' },
];

const casos = [
  ['capital com vara especializada pega a 1a da lista', 'Campo Grande', PREF, { area: 'Cível - Bancária', posicao: 0 }],
  ['comarca sem vara bancaria cai na 2a', 'Dourados', PREF, { area: 'Cível', posicao: 1 }],
  ['comarca so com Juizado cai na 3a', 'Bonito', PREF, { area: 'Juizado Especial Cível', posicao: 2 }],
  ['comarca sem nenhuma das opcoes -> erro, nao chute', 'Corumbá', PREF, { erro: true }],
  ['comarca nao catalogada -> erro', 'Naviraí', PREF, { erro: true }],
  ['acento e hifen nao atrapalham', 'Campo Grande',
    [{ rito: 'Rito Ordinario (Comum)', area: 'Civel Bancaria', classeCNJ: 'Procedimento Comum Civel' }],
    { area: 'Cível - Bancária', posicao: 0 }],
  ['classe que nao existe naquela area -> nao usa a area, desce na lista', 'Campo Grande',
    [{ rito: 'RITO ORDINÁRIO (COMUM)', area: 'Cível - Bancária', classeCNJ: 'EXECUÇÃO FISCAL' }, PREF[1]],
    { area: 'Cível', posicao: 1 }],
  ['lista de preferencia vazia -> erro', 'Campo Grande', [], { erro: true }],
];

let falhas = 0;
for (const [desc, comarca, pref, esp] of casos) {
  const r = escolherCompetencia(cat, comarca, pref);
  let ok, obtido;
  if (esp.erro) { ok = 'erro' in r; obtido = 'erro' in r ? `erro: ${r.erro.split('\n')[0]}` : `escolheu ${r.escolhida.area}`; }
  else if ('erro' in r) { ok = false; obtido = `erro: ${r.erro.split('\n')[0]}`; }
  else { ok = r.escolhida.area === esp.area && r.posicao === esp.posicao; obtido = `${r.escolhida.area} (opcao ${r.posicao + 1})`; }
  if (!ok) falhas++;
  console.log(`${ok ? 'OK  ' : 'FALHA'} | ${desc}`);
  console.log(`       ${obtido}`);
}
console.log(`\n${casos.length - falhas}/${casos.length} passaram`);
process.exit(falhas ? 1 : 0);
