// Confronta alegações que circularam sobre o 2º turno com os dados oficiais por seção e com a auditoria das urnas.
// Uso: node gerar_alegacoes.js <pasta_out> <pasta_an> <arquivo_saida.json>
const fs = require('fs');
const path = require('path');
const [OUT, AN, SAIDA] = process.argv.slice(2);

function parseLine(line, sep = ';') {
  const out = []; let i = 0; const n = line.length;
  while (i <= n) {
    if (line[i] === '"') { let j = i + 1, s = ''; while (j < n) { if (line[j] === '"') { if (line[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += line[j++]; } out.push(s); i = j + 2; }
    else { let j = line.indexOf(sep, i); if (j < 0) j = n; out.push(line.slice(i, j)); i = j + 1; }
  }
  return out;
}
const linhas = fs.readFileSync(path.join(OUT, 'secoes_2turno.csv'), 'utf8').replace(/^﻿/, '').split('\n').filter(Boolean);
const H = Object.fromEntries(parseLine(linhas[0]).map((k, i) => [k, i]));
const S = linhas.slice(1).map((l) => { const f = parseLine(l); return { uf: f[H.uf], cod: +f[H.cod_municipio], mun: f[H.municipio], L: +f[H.lula], F: +f[H.flavio], L1: +f[H.lula_1t], F1: +f[H.flavio_1t], O1: +f[H.outros_1t] }; });
const soma = (a, k) => a.reduce((x, s) => x + s[k], 0);
const REG = { N: ['AC', 'AM', 'AP', 'PA', 'RO', 'RR', 'TO'], NE: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'] };

const ara = S.filter((s) => s.uf === 'RJ' && s.mun === 'ARARUAMA');
const zF = S.filter((s) => s.F === 0 && s.L > 0), zL = S.filter((s) => s.L === 0 && s.F > 0);
const M = {}; for (const s of S) { if (s.uf === 'ZZ') continue; const k = s.uf + '|' + s.cod; const m = M[k] || (M[k] = { uf: s.uf, mun: s.mun, L: 0, F: 0, L1: 0, F1: 0 }); m.L += s.L; m.F += s.F; m.L1 += s.L1; m.F1 += s.F1; }
const viradas = Object.values(M).filter((m) => m.F1 > m.L1 && m.L > m.F), viradasF = Object.values(M).filter((m) => m.L1 > m.F1 && m.F > m.L);
const ba = S.filter((s) => s.uf === 'BA'), sc = S.filter((s) => s.uf === 'SC');
const lerJ = (f) => (fs.existsSync(path.join(AN, f)) ? JSON.parse(fs.readFileSync(path.join(AN, f), 'utf8')) : null);
const est = lerJ('estatisticas.json'), urn = lerJ('urnas.json');
const L = soma(S, 'L'), F = soma(S, 'F');

const out = {
  margem: L - F,
  araruama: { secoes: ara.length, L: soma(ara, 'L'), F: soma(ara, 'F'), L1: soma(ara, 'L1'), F1: soma(ara, 'F1'), minF: Math.min(...ara.map((s) => s.F)), minL: Math.min(...ara.map((s) => s.L)) },
  zerados: { flavio: zF.length, lulaNelas: soma(zF, 'L'), norte: zF.filter((s) => REG.N.includes(s.uf)).length, nordeste: zF.filter((s) => REG.NE.includes(s.uf)).length, lula: zL.length },
  viradas: { lula: viradas.length, flavio: viradasF.length, exemplos: viradas.filter((m) => ['RIO DE JANEIRO', 'OSASCO', 'COTIA', 'ARARAQUARA'].includes(m.mun)).map((m) => ({ ...m })) },
  bahia: { L1: soma(ba, 'L1'), L: soma(ba, 'L'), F1: soma(ba, 'F1'), F: soma(ba, 'F') },
  sc: { L1: soma(sc, 'L1'), L: soma(sc, 'L'), F1: soma(sc, 'F1'), F: soma(sc, 'F') },
  modeloUrna: est && est.modeloUrna.tabela,
  pos17: urn && urn.totais.pos17 != null && { total: urn.totais.pos17, apos18: urn.totais.pos18, apos19: urn.totais.pos19, secoes: urn.totais.secoesPos17, porUF: urn.totais.pos17UF },
};
fs.writeFileSync(SAIDA, JSON.stringify(out));
console.log(JSON.stringify(out, null, 1).slice(0, 1500));
