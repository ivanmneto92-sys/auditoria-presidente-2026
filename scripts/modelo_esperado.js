// Bloco C: perfil do eleitorado por seção, modelo de voto esperado e eleitores × população do Censo 2022.
// Uso: node modelo_esperado.js <pasta_raw> <pasta_out> <pasta_saida>
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, execFileSync } = require('child_process');
const [RAW, OUT, AN] = process.argv.slice(2);
const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO', 'ZZ'];

function parseLine(line, sep = ';') {
  const out = []; let i = 0; const n = line.length;
  while (i <= n) {
    if (line[i] === '"') { let j = i + 1, s = ''; while (j < n) { if (line[j] === '"') { if (line[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += line[j++]; } out.push(s); i = j + 2; }
    else { let j = line.indexOf(sep, i); if (j < 0) j = n; out.push(line.slice(i, j)); i = j + 1; }
  }
  return out;
}
const chave = (uf, mun, zona, sec) => `${uf}|${+mun}|${+zona}|${+sec}`;

// ---------- perfil por seção ----------
async function perfil() {
  const arq = path.join(AN, 'perfil_secao.json');
  if (fs.existsSync(arq)) return new Map(Object.entries(JSON.parse(fs.readFileSync(arq, 'utf8'))));
  const P = new Map();
  for (const uf of UFS) {
    const zip = path.join(RAW, `perfil_${uf}.zip`);
    if (!fs.existsSync(zip)) execFileSync('curl', ['-s', '-f', '-o', zip, `https://cdn.tse.jus.br/estatistica/sead/odsele/perfil_eleitor_secao/perfil_eleitor_secao_2026_${uf}.zip`]);
    await new Promise((res) => {
      const p = spawn('unzip', ['-p', zip, `perfil_eleitor_secao_2026_${uf}.csv`]); p.stdout.setEncoding('latin1');
      let h = null;
      readline.createInterface({ input: p.stdout }).on('line', (l) => {
        const f = parseLine(l); if (!h) { h = Object.fromEntries(f.map((k, i) => [k, i])); return; }
        const k = chave(f[h.SG_UF], f[h.CD_MUNICIPIO], f[h.NR_ZONA], f[h.NR_SECAO]);
        let x = P.get(k); if (!x) { x = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; P.set(k, x); }
        const q = +f[h.QT_ELEITORES], idade = +f[h.CD_FAIXA_ETARIA], esc = +f[h.CD_GRAU_ESCOLARIDADE];
        // [total, mulheres, 16-24, 25-44, 45-59, 60+, escolaridade baixa, superior, casados, com biometria, deficiência]
        x[0] += q; if (f[h.CD_GENERO] === '4') x[1] += q;
        if (idade < 2500) x[2] += q; else if (idade < 4500) x[3] += q; else if (idade < 6000) x[4] += q; else x[5] += q;
        if (esc >= 1 && esc <= 3) x[6] += q; if (esc === 7 || esc === 8) x[7] += q;
        if (f[h.CD_ESTADO_CIVIL] === '3') x[8] += q; x[9] += +f[h.QT_ELEITORES_BIOMETRIA]; x[10] += +f[h.QT_ELEITORES_DEFICIENCIA];
      }).on('close', res);
    });
    fs.unlinkSync(zip);
    console.log('perfil', uf, P.size);
  }
  fs.writeFileSync(arq, JSON.stringify(Object.fromEntries(P)));
  return P;
}

// ---------- mínimos quadrados ponderados (equações normais + Cholesky) ----------
function mqp(X, y, w) {
  const k = X[0].length, A = Array.from({ length: k }, () => new Float64Array(k)), b = new Float64Array(k);
  for (let i = 0; i < X.length; i++) { const xi = X[i], wi = w[i]; for (let a = 0; a < k; a++) { b[a] += wi * xi[a] * y[i]; for (let c = 0; c <= a; c++) A[a][c] += wi * xi[a] * xi[c]; } }
  for (let a = 0; a < k; a++) for (let c = 0; c < a; c++) A[c][a] = A[a][c];
  for (let a = 0; a < k; a++) A[a][a] += 1e-6;
  const L = Array.from({ length: k }, () => new Float64Array(k));
  for (let i = 0; i < k; i++) for (let j = 0; j <= i; j++) { let s = A[i][j]; for (let m = 0; m < j; m++) s -= L[i][m] * L[j][m]; L[i][j] = i === j ? Math.sqrt(s) : s / L[j][j]; }
  const z = new Float64Array(k); for (let i = 0; i < k; i++) { let s = b[i]; for (let m = 0; m < i; m++) s -= L[i][m] * z[m]; z[i] = s / L[i][i]; }
  const beta = new Float64Array(k); for (let i = k - 1; i >= 0; i--) { let s = z[i]; for (let m = i + 1; m < k; m++) s -= L[m][i] * beta[m]; beta[i] = s / L[i][i]; }
  return beta;
}

(async () => {
  const P = await perfil();
  // seções + brancos/nulos do 1º turno
  const bn1 = new Map();
  await new Promise((res) => {
    const p = spawn('unzip', ['-p', path.join(RAW, 'DET.zip'), 'detalhe_votacao_secao_2026_BR.csv']); p.stdout.setEncoding('latin1'); let h = null;
    readline.createInterface({ input: p.stdout }).on('line', (l) => { const f = parseLine(l); if (!h) { h = Object.fromEntries(f.map((k, i) => [k, i])); return; } if (f[h.NR_TURNO] !== '1' || f[h.CD_CARGO] !== '1') return; bn1.set(chave(f[h.SG_UF], f[h.CD_MUNICIPIO], f[h.NR_ZONA], f[h.NR_SECAO]), +f[h.QT_VOTOS_BRANCOS] + +f[h.QT_VOTOS_NULOS]); }).on('close', res);
  });
  const linhas = fs.readFileSync(path.join(OUT, 'secoes_2turno.csv'), 'utf8').replace(/^﻿/, '').split('\n').filter(Boolean);
  const H = Object.fromEntries(parseLine(linhas[0]).map((k, i) => [k, i]));
  const S = linhas.slice(1).map((l) => { const f = parseLine(l); return { uf: f[H.uf], mun: +f[H.cod_municipio], nome: f[H.municipio], zona: +f[H.zona], secao: +f[H.secao], local: f[H.local], lat: +f[H.lat] || null, lon: +f[H.lon] || null, aptos: +f[H.aptos], comp: +f[H.comparecimento], L: +f[H.lula], F: +f[H.flavio], L1: +f[H.lula_1t], F1: +f[H.flavio_1t], O1: +f[H.outros_1t], aptos1: +f[H.aptos_1t], comp1: +f[H.comparecimento_1t] }; });
  const logit = (p) => Math.log(p / (1 - p)); const cl = (p) => Math.min(0.995, Math.max(0.005, p));

  // ---------- 9. modelo de voto esperado ----------
  const munSoma = new Map();
  for (const s of S) { const k = `${s.uf}|${s.mun}`; const m = munSoma.get(k) || { L: 0, F: 0 }; m.L += s.L; m.F += s.F; munSoma.set(k, m); }
  const X = [], y = [], w = [], ref = [];
  for (const s of S) {
    const p = P.get(chave(s.uf, s.mun, s.zona, s.secao)); const b = bn1.get(chave(s.uf, s.mun, s.zona, s.secao));
    const v = s.L + s.F, v1 = s.L1 + s.F1 + s.O1;
    if (!p || !p[0] || v < 30 || s.L1 + s.F1 < 20 || b == null || !s.aptos1) continue;
    const m = munSoma.get(`${s.uf}|${s.mun}`), mloo = (m.L - s.L) / (m.L + m.F - v);
    if (!(m.L + m.F - v > 0)) continue;
    const t = p[0];
    X.push([1, logit(cl(s.L1 / (s.L1 + s.F1))), s.O1 / v1, b / (s.comp1 || 1), s.comp1 / s.aptos1, logit(cl(mloo)), p[1] / t, p[2] / t, p[3] / t, p[5] / t, p[6] / t, p[7] / t, p[8] / t, p[9] / t]);
    y.push(logit(cl(s.L / v))); w.push(v); ref.push(s);
  }
  console.log('modelo: ajustando com', X.length, 'seções');
  const beta = mqp(X, y, w);
  const pred = X.map((x) => x.reduce((a, xi, i) => a + xi * beta[i], 0));
  // variância extra além da binomial (método dos momentos, robusto pela mediana)
  const resid = y.map((yi, i) => yi - pred[i]);
  const varBin = ref.map((s, i) => { const p = 1 / (1 + Math.exp(-pred[i])); return 1 / ((s.L + s.F) * p * (1 - p)); });
  const ex = resid.map((r, i) => r * r - varBin[i]).sort((a, b) => a - b); const tau2 = Math.max(0, ex[ex.length >> 1]);
  let sse = 0, sst = 0; const ym = y.reduce((a, v, i) => a + v * w[i], 0) / w.reduce((a, b) => a + b, 0);
  y.forEach((yi, i) => { sse += w[i] * resid[i] ** 2; sst += w[i] * (yi - ym) ** 2; });
  const casos = [];
  ref.forEach((s, i) => {
    const z = resid[i] / Math.sqrt(varBin[i] + tau2);
    if (Math.abs(z) >= 5) { const pe = 1 / (1 + Math.exp(-pred[i])); casos.push({ uf: s.uf, mun: s.mun, nome: s.nome, zona: s.zona, secao: s.secao, local: s.local, lat: s.lat, lon: s.lon, L: s.L, F: s.F, lulaReal: Math.round(1000 * s.L / (s.L + s.F)) / 10, lulaEsperado: Math.round(1000 * pe) / 10, z: Math.round(z * 10) / 10 }); }
  });
  casos.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  const nomes = ['constante', 'Lula no 1º turno (logit)', 'outros candidatos no 1º turno', 'brancos e nulos no 1º turno', 'comparecimento no 1º turno', 'resto do município no 2º turno (logit)', '% mulheres', '% 16 a 24 anos', '% 25 a 44 anos', '% 60 anos ou mais', '% escolaridade baixa', '% ensino superior', '% casados', '% com biometria'];
  const modelo = { secoes: X.length, r2: Math.round((1 - sse / sst) * 10000) / 10000, erroTipico: Math.round(Math.sqrt(tau2) * 1000) / 1000, coeficientes: nomes.map((n, i) => ({ variavel: n, valor: Math.round(beta[i] * 1000) / 1000 })), total: casos.length, casos: casos.slice(0, 2000) };
  console.log('modelo: R²', modelo.r2, 'casos |z|≥5:', casos.length);

  // ---------- 10. eleitores × população (Censo 2022) ----------
  const url = 'https://apisidra.ibge.gov.br/values/t/9514/n6/all/v/93/p/2022/c2/6794/c287/100362,93070,93084,6567,6568/c286/113635?formato=json';
  const sidra = JSON.parse(execFileSync('curl', ['-s', '-f', url], { maxBuffer: 1e9 }).toString());
  const pop = new Map();
  for (const r of sidra.slice(1)) { const c = r.D1C, cat = r.D5C, v = +r.V || 0; const x = pop.get(c) || { total: 0, menos12: 0 }; if (cat === '100362') x.total = v; else x.menos12 += v; pop.set(c, x); }
  const t2i = new Map(); fs.readFileSync(path.join(RAW, 'mun_tse.csv'), 'utf8').split(/\r?\n/).slice(1).forEach((l) => { const f = l.split(','); if (f[4]) t2i.set(`${f[1]}|${+f[0]}`, f[4]); });
  const aptosMun = new Map(); for (const s of S) { if (s.uf === 'ZZ') continue; const k = `${s.uf}|${s.mun}`; const a = aptosMun.get(k) || { uf: s.uf, mun: s.mun, nome: s.nome, aptos: 0 }; a.aptos += s.aptos; aptosMun.set(k, a); }
  const censo = [];
  for (const [k, a] of aptosMun) { const p = pop.get(t2i.get(k)); if (!p || !p.total) continue; const adultos = p.total - p.menos12; censo.push({ ...a, ibge: t2i.get(k), populacao: p.total, aptos12: adultos, razao: Math.round((a.aptos / adultos) * 1000) / 1000 }); }
  censo.sort((a, b) => b.razao - a.razao);
  const acima = censo.filter((c) => c.razao > 1);
  console.log('censo:', censo.length, 'municípios,', acima.length, 'com mais eleitores que pessoas de 16+');

  fs.writeFileSync(path.join(AN, 'modelo.json'), JSON.stringify({ modelo, censo: { municipios: censo.length, acima1: acima.length, acima11: censo.filter((c) => c.razao > 1.1).length, lista: censo } }));
  console.log('gravado');
})();
