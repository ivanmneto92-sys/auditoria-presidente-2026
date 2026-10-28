// Bloco B: análises estatísticas com os dados por seção já baixados.
// 1 votos sem origem · 2 impressão digital · 3 modelo de urna pareado · 4 urnas tardias · 5 último dígito · 6 vizinhança
// Uso: node analises_estatisticas.js <pasta_raw> <pasta_out> <arquivo_saida.json>
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const [RAW, OUT, SAIDA] = process.argv.slice(2);

function parseLine(line, sep = ';') {
  const out = []; let i = 0; const n = line.length;
  while (i <= n) {
    if (line[i] === '"') { let j = i + 1, s = ''; while (j < n) { if (line[j] === '"') { if (line[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += line[j++]; } out.push(s); i = j + 2; }
    else { let j = line.indexOf(sep, i); if (j < 0) j = n; out.push(line.slice(i, j)); i = j + 1; }
  }
  return out;
}
const chave = (uf, mun, zona, sec) => `${uf}|${+mun}|${+zona}|${+sec}`;

(async () => {
  // brancos + nulos do 1º turno por seção
  console.log('lendo brancos e nulos do 1º turno…');
  const bn1 = new Map();
  await new Promise((res) => {
    const p = spawn('unzip', ['-p', path.join(RAW, 'DET.zip'), 'detalhe_votacao_secao_2026_BR.csv']);
    p.stdout.setEncoding('latin1');
    let h = null;
    readline.createInterface({ input: p.stdout }).on('line', (l) => {
      const f = parseLine(l); if (!h) { h = Object.fromEntries(f.map((k, i) => [k, i])); return; }
      if (f[h.NR_TURNO] !== '1' || f[h.CD_CARGO] !== '1') return;
      bn1.set(chave(f[h.SG_UF], f[h.CD_MUNICIPIO], f[h.NR_ZONA], f[h.NR_SECAO]), +f[h.QT_VOTOS_BRANCOS] + +f[h.QT_VOTOS_NULOS]);
    }).on('close', res);
  });

  console.log('lendo seções…');
  const linhas = fs.readFileSync(path.join(OUT, 'secoes_2turno.csv'), 'utf8').replace(/^﻿/, '').split('\n').filter(Boolean);
  const H = Object.fromEntries(parseLine(linhas[0]).map((k, i) => [k, i]));
  const S = linhas.slice(1).map((l) => {
    const f = parseLine(l);
    return {
      uf: f[H.uf], mun: +f[H.cod_municipio], nome: f[H.municipio], zona: +f[H.zona], secao: +f[H.secao], local: f[H.local], lat: +f[H.lat] || null, lon: +f[H.lon] || null,
      aptos: +f[H.aptos], comp: +f[H.comparecimento], L: +f[H.lula], F: +f[H.flavio], bn: +f[H.brancos] + +f[H.nulos],
      L1: +f[H.lula_1t], F1: +f[H.flavio_1t], O1: +f[H.outros_1t], aptos1: +f[H.aptos_1t], comp1: +f[H.comparecimento_1t],
      modelo: f[H.modelo_urna], receb: f[H.recebimento_bu],
    };
  });
  for (const s of S) s.bn1 = bn1.get(chave(s.uf, s.mun, s.zona, s.secao)) ?? null;
  console.log(S.length, 'seções');
  const R = {};
  const pct = (x) => Math.round(x * 1000) / 10;
  const id = (s) => ({ uf: s.uf, mun: s.mun, nome: s.nome, zona: s.zona, secao: s.secao, local: s.local, lat: s.lat, lon: s.lon });

  // ---------- 1. votos sem origem ----------
  // Ganho líquido de um candidato do 1º para o 2º turno só pode vir de: votos de outros candidatos, brancos/nulos,
  // eleitores que não votaram no 1º turno, ou eleitores do adversário que trocaram de lado.
  // Marcamos seções onde o ganho exige trocas acima de 10% do eleitorado do adversário.
  {
    const casos = []; let avaliadas = 0;
    for (const s of S) {
      if (s.bn1 == null || !s.aptos1 || s.L + s.F < 50) continue;
      avaliadas++;
      const novos = Math.max(0, s.comp - s.comp1) + Math.abs(s.aptos - s.aptos1);
      const estoque = s.O1 + s.bn1 + novos;
      for (const [quem, g, adv1] of [['Flávio', s.F - s.F1, s.L1], ['Lula', s.L - s.L1, s.F1]]) {
        const trocas = g - estoque;
        if (trocas > Math.max(15, 0.1 * adv1)) casos.push({ ...id(s), quem, ganho: g, estoque, trocas, adv1, L1: s.L1, F1: s.F1, O1: s.O1, bn1: s.bn1, L: s.L, F: s.F, comp1: s.comp1, comp: s.comp, perc: pct(trocas / adv1) });
      }
    }
    casos.sort((a, b) => b.perc - a.perc);
    R.semOrigem = { avaliadas, total: casos.length, porCandidato: { Lula: casos.filter((c) => c.quem === 'Lula').length, Flávio: casos.filter((c) => c.quem === 'Flávio').length }, casos: casos.slice(0, 3000) };
    console.log('1. votos sem origem:', casos.length);
  }

  // ---------- 2. impressão digital (comparecimento × percentual) ----------
  {
    const N = 50, REG = { N: ['AC', 'AM', 'AP', 'PA', 'RO', 'RR', 'TO'], NE: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'], CO: ['DF', 'GO', 'MS', 'MT'], SE: ['ES', 'MG', 'RJ', 'SP'], S: ['PR', 'RS', 'SC'] };
    const regDe = {}; for (const [r, ufs] of Object.entries(REG)) for (const u of ufs) regDe[u] = r;
    const grades = {}; const nova = () => ({ L: new Array(N * N).fill(0), F: new Array(N * N).fill(0) });
    grades.BR = nova(); for (const r of Object.keys(REG)) grades[r] = nova();
    const cauda = [];
    for (const s of S) {
      if (s.aptos < 50 || s.L + s.F < 30) continue;
      const t = Math.min(0.9999, s.comp / s.aptos), v = s.comp || 1;
      const bx = Math.floor(t * N);
      for (const [k, votos] of [['L', s.L], ['F', s.F]]) {
        const by = Math.min(N - 1, Math.floor((votos / v) * N));
        grades.BR[k][by * N + bx]++; if (regDe[s.uf]) grades[regDe[s.uf]][k][by * N + bx]++;
      }
      if (t >= 0.95 && Math.max(s.L, s.F) / v >= 0.9) cauda.push({ ...id(s), comparecimento: pct(t), lider: s.L > s.F ? 'Lula' : 'Flávio', perc: pct(Math.max(s.L, s.F) / v), L: s.L, F: s.F, aptos: s.aptos, comp: s.comp });
    }
    R.impressao = { N, grades, cauda: cauda.sort((a, b) => b.comparecimento - a.comparecimento) };
    console.log('2. impressão digital: cauda', cauda.length);
  }

  // ---------- 3. modelo de urna, comparando seções da mesma escola ----------
  {
    const porLocal = new Map();
    for (const s of S) { if (s.L + s.F < 50) continue; const k = `${s.uf}|${s.mun}|${s.zona}|${s.local}`; if (!porLocal.has(k)) porLocal.set(k, []); porLocal.get(k).push(s); }
    const acc = {}, bruto = {};
    for (const s of S) { if (s.L + s.F < 50) continue; const b = bruto[s.modelo] || (bruto[s.modelo] = { n: 0, L: 0, F: 0 }); b.n++; b.L += s.L; b.F += s.F; }
    let locais = 0;
    for (const lista of porLocal.values()) {
      const modelos = new Set(lista.map((s) => s.modelo)); if (modelos.size < 2) continue;
      locais++;
      const media = lista.reduce((a, s) => a + s.L, 0) / lista.reduce((a, s) => a + s.L + s.F, 0);
      for (const s of lista) {
        const d = s.L / (s.L + s.F) - media; const a = acc[s.modelo] || (acc[s.modelo] = { n: 0, soma: 0, soma2: 0 });
        a.n++; a.soma += d; a.soma2 += d * d;
      }
    }
    const tabela = Object.keys(bruto).sort().map((m) => {
      const a = acc[m] || { n: 0, soma: 0, soma2: 0 }; const media = a.n ? a.soma / a.n : null;
      const dp = a.n > 1 ? Math.sqrt((a.soma2 - a.n * media * media) / (a.n - 1)) : null;
      return { modelo: m, secoes: bruto[m].n, lulaBruto: pct(bruto[m].L / (bruto[m].L + bruto[m].F)), secoesPareadas: a.n, desvioPareado: media == null ? null : Math.round(media * 10000) / 100, ic95: dp == null ? null : Math.round((1.96 * dp / Math.sqrt(a.n)) * 10000) / 100 };
    });
    R.modeloUrna = { locaisComparados: locais, tabela };
    console.log('3. modelo de urna:', JSON.stringify(tabela));
  }

  // ---------- 4. urnas que chegaram tarde ----------
  {
    const b = new Map();
    for (const s of S) {
      const m = /(\d\d)\/(\d\d)\/\d{4} (\d\d):(\d\d)/.exec(s.receb || ''); if (!m || s.L + s.F < 1 || s.L1 + s.F1 < 1) continue;
      let min = (+m[3]) * 60 + +m[4]; if (+m[1] > 25) min += 1440; const q = Math.floor(min / 15) * 15;
      const x = b.get(q) || { secoes: 0, L: 0, F: 0, L1: 0, F1: 0 }; x.secoes++; x.L += s.L; x.F += s.F; x.L1 += s.L1; x.F1 += s.F1; b.set(q, x);
    }
    let acum = 0;
    R.tardias = [...b.entries()].sort((a, c) => a[0] - c[0]).map(([q, x]) => {
      acum += x.secoes;
      return { hora: `${String(Math.floor(q / 60) % 24).padStart(2, '0')}:${String(q % 60).padStart(2, '0')}`, secoes: x.secoes, acumulado: acum, lula2t: pct(x.L / (x.L + x.F)), lula1t: pct(x.L1 / (x.L1 + x.F1)), variacao: Math.round((x.L / (x.L + x.F) - x.L1 / (x.L1 + x.F1)) * 1000) / 10 };
    });
    console.log('4. urnas tardias:', R.tardias.length, 'faixas');
  }

  // ---------- 5. último dígito ----------
  {
    // O esperado não é 10% por dígito: quando a quantidade de seções cai conforme o total cresce,
    // os dígitos menores aparecem um pouco mais. O esperado vem da própria distribuição suavizada (média móvel de 21 valores).
    const teste = (vals) => {
      const c = new Array(10).fill(0); for (const v of vals) c[v % 10]++;
      const n = vals.length; if (!n) return { n: 0, contagem: c, esperado: c, qui2: 0, p: 1 };
      let max = 0, min = Infinity; for (const v of vals) { if (v > max) max = v; if (v < min) min = v; }
      const hist = new Float64Array(max + 12); for (const v of vals) hist[v]++;
      const esp = new Array(10).fill(0);
      for (let v = min; v <= max; v++) { let s = 0, k = 0; for (let j = v - 10; j <= v + 10; j++) if (j >= min && j <= max) { s += hist[j]; k++; } esp[v % 10] += s / k; }
      const tot = esp.reduce((a, x) => a + x, 0); for (let d = 0; d < 10; d++) esp[d] *= n / tot;
      const chi = c.reduce((a, x, d) => a + (x - esp[d]) ** 2 / esp[d], 0);
      // p-valor do qui-quadrado com 9 g.l. (série de Wilson-Hilferty)
      const z = (Math.cbrt(chi / 9) - (1 - 2 / 81)) / Math.sqrt(2 / 81);
      const p = 0.5 * erfc(z / Math.SQRT2);
      return { n, contagem: c, esperado: esp.map((x) => Math.round(x)), qui2: Math.round(chi * 10) / 10, p: Math.round(p * 10000) / 10000 };
    };
    function erfc(x) { const t = 1 / (1 + 0.5 * Math.abs(x)); const r = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))); return x >= 0 ? r : 2 - r; }
    const ufs = [...new Set(S.map((s) => s.uf))].sort();
    R.ultimoDigito = {
      brasil: { lula: teste(S.filter((s) => s.L >= 100).map((s) => s.L)), flavio: teste(S.filter((s) => s.F >= 100).map((s) => s.F)), comparecimento: teste(S.filter((s) => s.comp >= 100).map((s) => s.comp)) },
      porUF: ufs.map((uf) => { const x = S.filter((s) => s.uf === uf); return { uf, lula: teste(x.filter((s) => s.L >= 100).map((s) => s.L)), flavio: teste(x.filter((s) => s.F >= 100).map((s) => s.F)) }; }),
    };
    console.log('5. último dígito BR:', R.ultimoDigito.brasil.lula.p, R.ultimoDigito.brasil.flavio.p);
  }

  // ---------- 6. local de votação × vizinhos num raio de 2 km ----------
  {
    const L = new Map();
    for (const s of S) {
      if (s.lat == null || s.lon == null) continue;
      const k = `${s.uf}|${s.mun}|${s.zona}|${s.local}`; let x = L.get(k);
      if (!x) { x = { uf: s.uf, mun: s.mun, nome: s.nome, zona: s.zona, local: s.local, lat: s.lat, lon: s.lon, L: 0, F: 0, L1: 0, F1: 0, secoes: 0 }; L.set(k, x); }
      x.L += s.L; x.F += s.F; x.L1 += s.L1; x.F1 += s.F1; x.secoes++;
    }
    const locs = [...L.values()].filter((x) => x.L + x.F >= 100);
    const grade = new Map(), C = 0.02; const cel = (a, b) => `${Math.floor(a / C)}|${Math.floor(b / C)}`;
    for (const x of locs) { const k = cel(x.lat, x.lon); if (!grade.has(k)) grade.set(k, []); grade.get(k).push(x); }
    const dist = (a, b) => { const dy = (a.lat - b.lat) * 111.2, dx = (a.lon - b.lon) * 111.2 * Math.cos(a.lat * Math.PI / 180); return Math.hypot(dx, dy); };
    for (const x of locs) {
      const gy = Math.floor(x.lat / C), gx = Math.floor(x.lon / C); let nl = 0, nf = 0, n1l = 0, n1f = 0, viz = 0;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const y of grade.get(`${gy + i}|${gx + j}`) || []) {
        if (y === x || (y.lat === x.lat && y.lon === x.lon)) continue;
        if (dist(x, y) <= 2) { nl += y.L; nf += y.F; n1l += y.L1; n1f += y.F1; viz++; }
      }
      if (viz >= 3 && nl + nf >= 500) { x.pv = nl / (nl + nf); x.d = x.L / (x.L + x.F) - x.pv; x.viz = viz; x.dv1 = x.L1 + x.F1 && n1l + n1f ? x.L1 / (x.L1 + x.F1) - n1l / (n1l + n1f) : null; }
    }
    const comViz = locs.filter((x) => x.d != null);
    const ds = comViz.map((x) => x.d).sort((a, b) => a - b); const med = ds[ds.length >> 1];
    const mad = [...ds.map((d) => Math.abs(d - med))].sort((a, b) => a - b)[ds.length >> 1] * 1.4826;
    const casos = [];
    for (const x of comViz) {
      const n = x.L + x.F, z = (x.d - med) / Math.sqrt(x.pv * (1 - x.pv) / n + mad * mad);
      x.z = z;
      // só marca se o desvio também não existia no 1º turno (se já era diferente no 1º turno, é perfil do bairro)
      if (Math.abs(z) >= 3.5 && (x.dv1 == null || Math.abs(x.d - x.dv1) > 0.1)) casos.push({ uf: x.uf, mun: x.mun, nome: x.nome, zona: x.zona, local: x.local, lat: x.lat, lon: x.lon, secoes: x.secoes, lula: pct(x.L / n), vizinhos: pct(x.pv), z: Math.round(z * 10) / 10, viz: x.viz, difPrimeiroTurno: x.dv1 == null ? null : pct(x.dv1), difSegundoTurno: pct(x.d) });
    }
    casos.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    R.vizinhanca = { locaisAvaliados: comViz.length, desvioTipico: pct(mad), total: casos.length, casos: casos.slice(0, 2000) };
    console.log('6. vizinhança:', comViz.length, 'locais avaliados,', casos.length, 'casos');
  }

  fs.writeFileSync(SAIDA, JSON.stringify(R));
  console.log('gravado', SAIDA, (fs.statSync(SAIDA).size / 1e6).toFixed(2), 'MB');
})();
