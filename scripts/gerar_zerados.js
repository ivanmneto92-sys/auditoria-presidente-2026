// Lista todas as seções em que um candidato teve votos e o outro 0 (e, à parte, de 1 a 9 com 100+ válidos).
// Uso: node gerar_zerados.js <pasta_out> <arquivo_saida.json>
const fs = require('fs');
const path = require('path');
const [OUT, SAIDA] = process.argv.slice(2);

function parseLine(line, sep = ';') {
  const out = []; let i = 0; const n = line.length;
  while (i <= n) {
    if (line[i] === '"') { let j = i + 1, s = ''; while (j < n) { if (line[j] === '"') { if (line[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += line[j++]; } out.push(s); i = j + 2; }
    else { let j = line.indexOf(sep, i); if (j < 0) j = n; out.push(line.slice(i, j)); i = j + 1; }
  }
  return out;
}
// tipo de local pelo nome (escolas indígenas, presídios etc. costumam ter voto muito homogêneo)
const TIPOS = [
  ['Aldeia / terra indígena', /IND[IÍ]GEN|ALDEIA|ALDEAMENTO|TERRA IND|POVO /i],
  ['Presídio / unidade socioeducativa', /CDP|PENITENCI|PRISIONAL|PRES[IÍ]DIO|CADEIA|DETEN|SOCIOEDUC|CASE |FUNDAC|INTERNA..O/i],
  ['Assentamento / comunidade rural', /ASSENTAMENTO|COMUNIDADE|POVOADO|S[IÍ]TIO|FAZENDA|VILA RURAL|RIBEIRINH|AGROVILA|ZONA RURAL/i],
  ['Quilombola', /QUILOMB/i],
  ['Hospital / voto em trânsito', /HOSPITAL|TR[AÂ]NSITO/i],
];
const tipoLocal = (nome) => (TIPOS.find(([, re]) => re.test(nome || '')) || ['Escola / outro'])[0];

const linhas = fs.readFileSync(path.join(OUT, 'secoes_2turno.csv'), 'utf8').replace(/^﻿/, '').split('\n').filter(Boolean);
const H = Object.fromEntries(parseLine(linhas[0]).map((k, i) => [k, i]));
const zero = [], quase = [];
for (const l of linhas.slice(1)) {
  const f = parseLine(l);
  const L = +f[H.lula], F = +f[H.flavio], v = L + F;
  if (!v) continue;
  const min = Math.min(L, F);
  const ehZero = min === 0, ehQuase = !ehZero && min < 10 && v >= 100;
  if (!ehZero && !ehQuase) continue;
  const r = {
    uf: f[H.uf], mun: +f[H.cod_municipio], nome: f[H.municipio], zona: +f[H.zona], secao: +f[H.secao], local: f[H.local], bairro: f[H.bairro],
    L, F, aptos: +f[H.aptos], comp: +f[H.comparecimento], L1: +f[H.lula_1t], F1: +f[H.flavio_1t], O1: +f[H.outros_1t],
    perdedor: L < F ? 'Lula' : 'Flávio', tipo: tipoLocal(f[H.local] + ' ' + (f[H.bairro] || '')),
  };
  (ehZero ? zero : quase).push(r);
}
const ordena = (a, b) => (b.L + b.F) - (a.L + a.F);
zero.sort(ordena); quase.sort(ordena);
const resumo = (lista) => {
  const porTipo = {}, porUF = {}; let mesmo1t = 0;
  for (const r of lista) {
    porTipo[r.tipo] = (porTipo[r.tipo] || 0) + 1; porUF[r.uf] = (porUF[r.uf] || 0) + 1;
    // no 1º turno, o mesmo candidato já tinha menos de 5% dos votos da seção?
    const v1 = r.L1 + r.F1 + r.O1, p1 = v1 ? (r.perdedor === 'Lula' ? r.L1 : r.F1) / v1 : null;
    r.perdedor1t = p1 == null ? null : Math.round(p1 * 1000) / 10;
    if (p1 != null && p1 < 0.05) mesmo1t++;
  }
  return { total: lista.length, lulaZerado: lista.filter((r) => r.perdedor === 'Lula').length, flavioZerado: lista.filter((r) => r.perdedor === 'Flávio').length, porTipo, porUF, mesmo1t };
};
const out = { zero: { ...resumo(zero), casos: zero }, quase: { ...resumo(quase), casos: quase } };
fs.writeFileSync(SAIDA, JSON.stringify(out));
console.log('zerados:', out.zero.total, '(Lula', out.zero.lulaZerado, '/ Flávio', out.zero.flavioZerado, ') tipos', out.zero.porTipo, 'já baixo no 1º turno:', out.zero.mesmo1t);
console.log('1 a 9 votos:', out.quase.total, 'tipos', out.quase.porTipo, 'já baixo no 1º turno:', out.quase.mesmo1t);
