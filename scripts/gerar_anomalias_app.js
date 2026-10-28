// Junta as análises (estatísticas, modelo/censo e auditoria das urnas) num arquivo para o menu Anomalias do app.
// Uso: node gerar_anomalias_app.js <pasta_an> <arquivo_saida>
const fs = require('fs');
const path = require('path');
const [AN, SAIDA] = process.argv.slice(2);
const ler = (f) => JSON.parse(fs.readFileSync(path.join(AN, f), 'utf8'));
const est = ler('estatisticas.json'), mod = ler('modelo.json');
const urnas = (f) => {
  if (!fs.existsSync(path.join(AN, f))) return null;
  const u = ler(f);
  return { tipos: u.tipos, totais: u.totais, contagem: u.contagem, horas: u.horas, totalCasos: u.totalCasos,
    casos: u.casos.slice(0, 5000).map((x) => [x.uf, x.mun, x.nome, x.zona, x.secao, x.local, x.comp, x.alertas, x.bioCad ?? null, x.bioUso ?? null, x.contingencia || 0]) };
};

const censo = mod.censo;
const hist = new Array(30).fill(0); // razão de 0,5 a 2,0 em passos de 0,05 (extremos agrupados)
for (const c of censo.lista) hist[Math.max(0, Math.min(29, Math.floor((c.razao - 0.5) / 0.05)))]++;

const saida = {
  gerado: new Date().toISOString(),
  alegacoes: fs.existsSync(path.join(AN, 'alegacoes.json')) ? ler('alegacoes.json') : null,
  especiais: fs.existsSync(path.join(AN, 'especiais.json')) ? ler('especiais.json') : null,
  zerados: fs.existsSync(path.join(AN, 'zerados.json')) ? ler('zerados.json') : null,
  semOrigem: est.semOrigem,
  impressao: est.impressao,
  modeloUrna: est.modeloUrna,
  tardias: est.tardias,
  ultimoDigito: est.ultimoDigito,
  vizinhanca: est.vizinhanca,
  modelo: mod.modelo,
  censo: { municipios: censo.municipios, acima1: censo.acima1, acima11: censo.acima11, histograma: hist, mediana: censo.lista.map((c) => c.razao).sort((a, b) => a - b)[censo.lista.length >> 1], lista: censo.lista.slice(0, 400) },
  urnas: urnas('urnas.json'),
  urnas1t: urnas('urnas_1t.json'),
};
fs.writeFileSync(SAIDA, JSON.stringify(saida));
console.log('gravado', SAIDA, (fs.statSync(SAIDA).size / 1e6).toFixed(2), 'MB');
