// Gera os dados do app de apuração a partir de secoes_2turno.csv, anomalias.csv e das malhas do IBGE.
// Uso: node gerar_app.js <pasta_raw> <pasta_out> <pasta_app>
const fs = require('fs');
const path = require('path');
const [RAW, OUT, APP] = process.argv.slice(2);
const DATA = path.join(APP, 'data');
fs.mkdirSync(path.join(DATA, 'uf'), { recursive: true });

function parseLine(line, sep = ';') {
  const out = []; let i = 0; const n = line.length;
  while (i <= n) {
    if (line[i] === '"') {
      let j = i + 1, s = '';
      while (j < n) { if (line[j] === '"') { if (line[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += line[j++]; }
      out.push(s); i = j + 2;
    } else { let j = line.indexOf(sep, i); if (j < 0) j = n; out.push(line.slice(i, j)); i = j + 1; }
  }
  return out;
}
const readCsv = (file, sep = ';') => {
  const lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split('\n').filter(Boolean);
  const h = parseLine(lines[0], sep); const idx = Object.fromEntries(h.map((k, i) => [k, i]));
  return lines.slice(1).map((l) => { const f = parseLine(l, sep); const o = {}; for (const k in idx) o[k] = f[idx[k]]; return o; });
};

// ---------- relógio da apuração: baldes de 5 minutos a partir das 17h ----------
const T0 = Date.UTC(2026, 9, 25, 17, 0), PASSO = 5 * 60e3;
const balde = (s) => {
  const m = /(\d+)\/(\d+)\/(\d+) (\d+):(\d+)/.exec(s || ''); if (!m) return null;
  return Math.max(0, Math.floor((Date.UTC(+m[3], m[2] - 1, +m[1], +m[4], +m[5]) - T0) / PASSO));
};

const REG = { N: ['AC', 'AM', 'AP', 'PA', 'RO', 'RR', 'TO'], NE: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'], CO: ['DF', 'GO', 'MS', 'MT'], SE: ['ES', 'MG', 'RJ', 'SP'], S: ['PR', 'RS', 'SC'], EX: ['ZZ'] };

// TSE -> IBGE
const tse2ibge = new Map();
fs.readFileSync(path.join(RAW, 'mun_tse.csv'), 'utf8').split(/\r?\n/).slice(1).forEach((l) => { const f = l.split(','); if (f[4]) tse2ibge.set(`${f[1]}|${+f[0]}`, f[4]); });

console.log('lendo seções...');
const secs = readCsv(path.join(OUT, 'secoes_2turno.csv'));
console.log(secs.length, 'seções');

const anoms = readCsv(path.join(OUT, 'anomalias.csv'));
const anomSec = new Map(); const anomMun = new Map();
for (const a of anoms) {
  const mk = `${a.uf}|${a.cod_municipio}`;
  anomMun.set(mk, (anomMun.get(mk) || 0) + 1);
  if (a.secao) { const k = `${mk}|${a.zona}|${a.secao}`; if (!anomSec.has(k)) anomSec.set(k, []); anomSec.get(k).push(a.tipo); }
}

const MUN = new Map(), UFX = new Map(), TL = [];
let maxB = 0;
const novo = () => ({ secoes: 0, aptos: 0, comp: 0, bn: 0, L: 0, F: 0, L1: 0, F1: 0, O1: 0, aptos1: 0, comp1: 0 });
const soma = (a, s) => {
  a.secoes++; a.aptos += +s.aptos; a.comp += +s.comparecimento; a.bn += +s.brancos + +s.nulos; a.L += +s.lula; a.F += +s.flavio;
  a.L1 += +s.lula_1t || 0; a.F1 += +s.flavio_1t || 0; a.O1 += +s.outros_1t || 0; a.aptos1 += +s.aptos_1t || 0; a.comp1 += +s.comparecimento_1t || 0;
};

for (const s of secs) {
  const mk = `${s.uf}|${+s.cod_municipio}`;
  let m = MUN.get(mk);
  if (!m) { m = Object.assign(novo(), { uf: s.uf, cod: +s.cod_municipio, nome: s.municipio, ibge: tse2ibge.get(mk) || null, zonas: new Map(), tl: new Map() }); MUN.set(mk, m); }
  soma(m, s);
  let z = m.zonas.get(+s.zona); if (!z) { z = novo(); m.zonas.set(+s.zona, z); } soma(z, s);
  const b = balde(s.recebimento_bu);
  if (b != null) {
    maxB = Math.max(maxB, b);
    const t = m.tl.get(b) || [0, 0, 0]; t[0] += +s.lula; t[1] += +s.flavio; t[2]++; m.tl.set(b, t);
    const g = TL[b] || (TL[b] = [0, 0, 0, 0]); g[0] += +s.lula; g[1] += +s.flavio; g[2]++; g[3] += +s.comparecimento;
  }
  if (!UFX.has(s.uf)) UFX.set(s.uf, []);
  UFX.get(s.uf).push(s);
}

// ---------- brasil.json ----------
const r1 = (x) => Math.round(x * 1e4) / 1e4;
const munis = [...MUN.values()].map((m) => {
  // série acumulada da apuração [balde, L, F, seções]
  let L = 0, F = 0, n = 0; const tl = [];
  [...m.tl.keys()].sort((a, b) => a - b).forEach((b) => { const t = m.tl.get(b); L += t[0]; F += t[1]; n += t[2]; tl.push([b, L, F, n]); });
  return [m.uf, m.cod, m.nome, m.ibge, m.secoes, m.aptos, m.comp, m.bn, m.L, m.F, m.L1, m.F1, m.O1, m.aptos1, m.comp1, anomMun.get(`${m.uf}|${m.cod}`) || 0, tl,
    [...m.zonas].map(([z, a]) => [z, a.secoes, a.aptos, a.comp, a.L, a.F, a.L1, a.F1])];
});
let acc = [0, 0, 0, 0]; const timeline = [];
for (let b = 0; b <= maxB; b++) { const g = TL[b] || [0, 0, 0, 0]; acc = acc.map((v, i) => v + g[i]); timeline.push([...acc]); }

const tipos = readCsv(path.join(path.dirname(OUT), 'ds', 'tipos_anomalia.csv'), ',');
fs.writeFileSync(path.join(DATA, 'brasil.json'), JSON.stringify({
  t0: '2026-10-25T17:00:00-03:00', passo_min: 5, regioes: REG, totalSecoes: secs.length,
  campos: ['uf', 'cod', 'nome', 'ibge', 'secoes', 'aptos', 'comp', 'brancos_nulos', 'lula', 'flavio', 'lula1', 'flavio1', 'outros1', 'aptos1', 'comp1', 'anomalias', 'apuracao', 'zonas'],
  munis, timeline, tipos,
}));
console.log('brasil.json', (fs.statSync(path.join(DATA, 'brasil.json')).size / 1e6).toFixed(2), 'MB', 'baldes', maxB + 1);

// ---------- uf/XX.json: locais e seções ----------
for (const [uf, list] of UFX) {
  const locIdx = new Map(), locais = [], secoes = [];
  for (const s of list) {
    const lk = `${s.cod_municipio}|${s.zona}|${s.local}`;
    let li = locIdx.get(lk);
    if (li == null) { li = locais.length; locIdx.set(lk, li); locais.push([+s.cod_municipio, +s.zona, s.local, s.bairro, s.lat ? r1(+s.lat) : null, s.lon ? r1(+s.lon) : null]); }
    const ak = `${s.uf}|${s.cod_municipio}|${s.zona}|${s.secao}`;
    secoes.push([li, +s.secao, +s.aptos, +s.comparecimento, +s.lula, +s.flavio, +s.brancos + +s.nulos, +s.lula_1t || 0, +s.flavio_1t || 0, (s.recebimento_bu || '').slice(11, 16), s.modelo_urna.replace('UE ', ''), anomSec.get(ak) || 0]);
  }
  fs.writeFileSync(path.join(DATA, 'uf', uf + '.json'), JSON.stringify({ campos_local: ['cod', 'zona', 'nome', 'bairro', 'lat', 'lon'], campos_secao: ['local', 'secao', 'aptos', 'comp', 'lula', 'flavio', 'brancos_nulos', 'lula1', 'flavio1', 'hora_bu', 'urna', 'anomalias'], locais, secoes }));
}
console.log('arquivos por UF gravados');

// ---------- anomalias.json ----------
fs.writeFileSync(path.join(DATA, 'anomalias.json'), JSON.stringify(anoms.map((a) => [a.tipo, a.uf, +a.cod_municipio, a.municipio, a.zona ? +a.zona : null, a.secao ? +a.secao : null, a.local, a.lula === '' ? null : +a.lula, a.flavio === '' ? null : +a.flavio, a.detalhe, a.lat ? r1(+a.lat) : null, a.lon ? r1(+a.lon) : null])));

// ---------- malhas: inteiros (graus × 1000) ----------
const q = (geom) => {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  return polys.map((p) => p.map((ring) => {
    const out = []; let px, py;
    for (const [x, y] of ring) { const a = Math.round(x * 1000), b = Math.round(y * 1000); if (a !== px || b !== py) { out.push(a, b); px = a; py = b; } }
    return out;
  }).filter((r) => r.length >= 8));
};
const gm = JSON.parse(fs.readFileSync(path.join(RAW, 'br_mun.json'), 'utf8'));
fs.writeFileSync(path.join(DATA, 'malha_municipios.json'), JSON.stringify(gm.features.map((f) => [f.properties.codarea, q(f.geometry)])));
const gu = JSON.parse(fs.readFileSync(path.join(RAW, 'br_uf.json'), 'utf8'));
fs.writeFileSync(path.join(DATA, 'malha_ufs.json'), JSON.stringify(gu.features.map((f) => [f.properties.codarea, q(f.geometry)])));
for (const f of fs.readdirSync(DATA)) if (f.endsWith('.json')) console.log(f, (fs.statSync(path.join(DATA, f)).size / 1e6).toFixed(2), 'MB');
const semIbge = munis.filter((m) => !m[3] && m[0] !== 'ZZ').length;
console.log('municípios sem código IBGE:', semIbge);
