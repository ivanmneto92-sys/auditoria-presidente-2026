// Processa os dados abertos do TSE (Eleição Presidencial 2026, 2º turno) por seção,
// agrega por local de votação / zona / município / UF e marca anomalias estatísticas.
// Uso: node processar_tse.js <pasta_dados_brutos> <pasta_saida>
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const RAW = process.argv[2];
const OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });

// ---------- leitura de CSV dentro de zip (latin1, separador ;) ----------
function parseLine(line) {
  const out = [];
  let i = 0, n = line.length;
  while (i <= n) {
    if (line[i] === '"') {
      let j = i + 1, s = '';
      while (j < n) {
        if (line[j] === '"') { if (line[j + 1] === '"') { s += '"'; j += 2; continue; } break; }
        s += line[j++];
      }
      out.push(s); i = j + 2;
    } else {
      let j = line.indexOf(';', i); if (j < 0) j = n;
      out.push(line.slice(i, j)); i = j + 1;
    }
  }
  return out;
}

function readZipCsv(zip, entry, onRow) {
  return new Promise((resolve, reject) => {
    const p = spawn('unzip', ['-p', path.join(RAW, zip), entry]);
    p.stdout.setEncoding('latin1');
    const rl = readline.createInterface({ input: p.stdout, crlfDelay: Infinity });
    let header = null, count = 0;
    rl.on('line', (l) => {
      const f = parseLine(l);
      if (!header) { header = {}; f.forEach((h, k) => (header[h] = k)); return; }
      count++; onRow(f, header);
    });
    rl.on('close', () => { console.log(`  ${entry}: ${count} linhas`); resolve(); });
    p.on('error', reject);
  });
}

const key = (uf, mun, zona, sec) => `${uf}|${+mun}|${+zona}|${+sec}`;
const num = (s) => { const v = parseInt(s, 10); return isNaN(v) ? 0 : v; };
const coord = (s) => { const v = parseFloat(String(s).replace(',', '.')); return isNaN(v) || v === -1 ? null : v; };

// ---------- estruturas ----------
const S = new Map(); // seção -> registro
function sec(uf, mun, zona, secao) {
  const k = key(uf, mun, zona, secao);
  let r = S.get(k);
  if (!r) {
    r = { uf, mun: +mun, zona: +zona, secao: +secao, t1: null, t2: null, L1: 0, F1: 0, O1: 0, L2: 0, F2: 0 };
    S.set(k, r);
  }
  return r;
}
const munNome = new Map();

(async () => {
  console.log('1/3 Detalhe por seção (aptos, comparecimento, brancos, nulos)...');
  await readZipCsv('DET.zip', 'detalhe_votacao_secao_2026_BR.csv', (f, h) => {
    if (f[h.CD_CARGO] !== '1') return;
    const t = f[h.NR_TURNO];
    const r = sec(f[h.SG_UF], f[h.CD_MUNICIPIO], f[h.NR_ZONA], f[h.NR_SECAO]);
    munNome.set(`${f[h.SG_UF]}|${+f[h.CD_MUNICIPIO]}`, f[h.NM_MUNICIPIO]);
    r['t' + t] = {
      aptos: num(f[h.QT_APTOS]), comp: num(f[h.QT_COMPARECIMENTO]), abst: num(f[h.QT_ABSTENCOES]),
      nom: num(f[h.QT_VOTOS_NOMINAIS]), br: num(f[h.QT_VOTOS_BRANCOS]), nu: num(f[h.QT_VOTOS_NULOS]),
      anu: num(f[h.QT_VOTOS_ANULADOS_APU_SEP]), local: num(f[h.NR_LOCAL_VOTACAO]),
      nmLocal: f[h.NM_LOCAL_VOTACAO], receb: f[h.DT_RECEBIMENTO_BU_HOR_TSE], origem: f[h.DS_ORIGEM_VOTO],
      inst: f[h.ST_SECAO_INSTALADA] === 'Sim', anul: f[h.ST_SECAO_ANULADA] !== 'Não', urna: f[h.DS_MODELO_URNA],
    };
  });

  console.log('2/3 Votos por candidato por seção (1º e 2º turno)...');
  await readZipCsv('BR.zip', 'votacao_secao_2026_BR.csv', (f, h) => {
    if (f[h.CD_CARGO] !== '1') return;
    const nr = f[h.NR_VOTAVEL];
    if (nr === '95' || nr === '96') return;
    const r = sec(f[h.SG_UF], f[h.CD_MUNICIPIO], f[h.NR_ZONA], f[h.NR_SECAO]);
    const v = num(f[h.QT_VOTOS]);
    if (f[h.NR_TURNO] === '2') { if (nr === '13') r.L2 += v; else if (nr === '22') r.F2 += v; }
    else { if (nr === '13') r.L1 += v; else if (nr === '22') r.F1 += v; else r.O1 += v; }
  });

  console.log('3/3 Locais de votação (coordenadas, seções agregadas)...');
  const agregadas = new Map(); // seção principal -> [seções agregadas]
  await readZipCsv('LOC.zip', 'eleitorado_local_votacao_2026_BRASIL.csv', (f, h) => {
    if (f[h.NR_TURNO] !== '2') return;
    const k = key(f[h.SG_UF], f[h.CD_MUNICIPIO], f[h.NR_ZONA], f[h.NR_SECAO]);
    if (f[h.CD_TIPO_SECAO_AGREGADA] === '2') {
      const pk = key(f[h.SG_UF], f[h.CD_MUNICIPIO], f[h.NR_ZONA], f[h.NR_SECAO_PRINCIPAL]);
      if (!agregadas.has(pk)) agregadas.set(pk, []);
      agregadas.get(pk).push(+f[h.NR_SECAO]);
      return;
    }
    const r = S.get(k); if (!r) return;
    r.lat = coord(f[h.NR_LATITUDE]); r.lon = coord(f[h.NR_LONGITUDE]);
    r.bairro = f[h.NM_BAIRRO]; r.end = f[h.DS_ENDERECO]; r.eleitCad = num(f[h.QT_ELEITOR_SECAO]);
  });
  for (const [pk, l] of agregadas) { const r = S.get(pk); if (r) r.agreg = l; }

  // ---------- agregações ----------
  const blank = () => ({ secoes: 0, aptos: 0, comp: 0, abst: 0, br: 0, nu: 0, L: 0, F: 0, L1: 0, F1: 0, O1: 0, comp1: 0, anom: 0 });
  const add = (a, r) => {
    a.secoes++; a.aptos += r.t2.aptos; a.comp += r.t2.comp; a.abst += r.t2.abst; a.br += r.t2.br; a.nu += r.t2.nu;
    a.L += r.L2; a.F += r.F2; a.L1 += r.L1; a.F1 += r.F1; a.O1 += r.O1; a.comp1 += r.t1 ? r.t1.comp : 0;
  };
  const BR = blank(), UF = new Map(), MUN = new Map(), ZON = new Map(), LOC = new Map();
  const get = (m, k, extra) => { let a = m.get(k); if (!a) { a = Object.assign(blank(), extra); m.set(k, a); } return a; };

  const secs = [...S.values()].filter((r) => r.t2);
  for (const r of secs) {
    add(BR, r);
    add(get(UF, r.uf, { uf: r.uf }), r);
    add(get(MUN, `${r.uf}|${r.mun}`, { uf: r.uf, mun: r.mun, nome: munNome.get(`${r.uf}|${r.mun}`) }), r);
    add(get(ZON, `${r.uf}|${r.zona}`, { uf: r.uf, zona: r.zona }), r);
    const lk = `${r.uf}|${r.mun}|${r.zona}|${r.t2.local}`;
    const lo = get(LOC, lk, { uf: r.uf, mun: r.mun, zona: r.zona, local: r.t2.local, nome: r.t2.nmLocal, bairro: r.bairro });
    add(lo, r);
    if (lo.lat == null && r.lat != null) { lo.lat = r.lat; lo.lon = r.lon; }
    r.lk = lk;
  }

  // ---------- coordenadas dos municípios (TSE -> IBGE -> lat/lon) ----------
  const ibgeLL = new Map();
  fs.readFileSync(path.join(RAW, 'mun_ibge.csv'), 'utf8').split(/\r?\n/).slice(1).forEach((l) => {
    const f = l.split(','); if (f.length > 3) ibgeLL.set(f[0], [+f[2], +f[3]]);
  });
  fs.readFileSync(path.join(RAW, 'mun_tse.csv'), 'utf8').split(/\r?\n/).slice(1).forEach((l) => {
    const f = l.split(','); const m = MUN.get(`${f[1]}|${+f[0]}`); const ll = ibgeLL.get(f[4]);
    if (m && ll) { m.lat = ll[0]; m.lon = ll[1]; }
  });

  // ---------- anomalias ----------
  // Cada anomalia: tipo, gravidade (1 = informativo, 2 = atenção, 3 = inconsistência aritmética/forte desvio)
  const TIPOS = {
    COMP_MAIOR_APTOS: 'Comparecimento maior que eleitores aptos',
    SOMA_DIVERGENTE: 'Soma de votos (13+22+brancos+nulos) diferente do comparecimento',
    NOMINAIS_DIVERGENTE: 'Votos nominais declarados diferentes da soma 13+22',
    APTOS_MUDOU: 'Eleitores aptos mudaram mais de 10 entre 1º e 2º turno',
    EMPATE_SECAO: 'Empate exato entre os candidatos na seção (≥ 20 votos válidos)',
    ZERO_VOTOS: 'Candidato com 0 votos na seção (≥ 30 votos válidos)',
    MENOS_10: 'Candidato com 1 a 9 votos na seção (≥ 100 votos válidos)',
    DESVIO_LOCAL: 'Resultado muito diferente das outras seções do mesmo local de votação (|z| ≥ 6)',
    VIRADA_ATIPICA: 'Variação 1º→2º turno muito diferente da variação da zona (≥ 30 p.p.)',
    COMPARECIMENTO_SALTO: 'Comparecimento mudou mais de 25 p.p. entre turnos',
    COMPARECIMENTO_ALTO: 'Comparecimento ≥ 97% (≥ 50 aptos)',
    BRANCOS_NULOS_ALTO: 'Brancos + nulos ≥ 25% do comparecimento (≥ 100 votantes)',
    NAO_INSTALADA: 'Seção não instalada ou anulada',
    ORIGEM_NAO_URNA: 'Votos não vieram da urna normal (RED, contingência, apuração manual)',
    VOTOS_ANULADOS: 'Votos anulados em apuração separada',
    BU_TARDIO: 'Boletim de urna recebido pelo TSE após 23h59 do dia da eleição',
    EMPATE_ZONA: 'Empate exato no total da zona eleitoral',
    EMPATE_MUNICIPIO: 'Empate exato no total do município',
    ZONA_MENOS_10: 'Candidato com menos de 10 votos em toda a zona',
    MUNICIPIO_MENOS_10: 'Candidato com menos de 10 votos em todo o município',
  };
  const GRAV = {
    COMP_MAIOR_APTOS: 3, SOMA_DIVERGENTE: 3, NOMINAIS_DIVERGENTE: 3, APTOS_MUDOU: 2, EMPATE_SECAO: 1, ZERO_VOTOS: 2,
    MENOS_10: 1, DESVIO_LOCAL: 2, VIRADA_ATIPICA: 2, COMPARECIMENTO_SALTO: 2, COMPARECIMENTO_ALTO: 1,
    BRANCOS_NULOS_ALTO: 1, NAO_INSTALADA: 1, ORIGEM_NAO_URNA: 1, VOTOS_ANULADOS: 2, BU_TARDIO: 1,
    EMPATE_ZONA: 2, EMPATE_MUNICIPIO: 2, ZONA_MENOS_10: 3, MUNICIPIO_MENOS_10: 3,
  };
  const anoms = [];
  const flag = (r, tipo, det) => {
    anoms.push({ tipo, g: GRAV[tipo], uf: r.uf, mun: r.mun, nome: munNome.get(`${r.uf}|${r.mun}`), zona: r.zona,
      secao: r.secao ?? null, local: r.t2?.nmLocal ?? null, L: r.L2 ?? r.L, F: r.F2 ?? r.F, det, lat: r.lat ?? null, lon: r.lon ?? null });
    if (r.lk) LOC.get(r.lk).anom++;
  };

  // mediana de virada por zona
  const swingZ = new Map();
  for (const r of secs) {
    const v1 = r.L1 + r.F1, v2 = r.L2 + r.F2;
    if (v1 >= 100 && v2 >= 100) {
      r.swing = r.L2 / v2 - r.L1 / v1;
      const zk = `${r.uf}|${r.zona}`; if (!swingZ.has(zk)) swingZ.set(zk, []); swingZ.get(zk).push(r.swing);
    }
  }
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const swingMed = new Map([...swingZ].map(([k, a]) => [k, med(a)]));
  const BU_LIMITE = new Date(2026, 9, 25, 23, 59, 59);
  const parseDt = (s) => { const m = /(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+)/.exec(s || ''); return m ? new Date(+m[3], m[2] - 1, +m[1], +m[4], +m[5], +m[6]) : null; };
  const pct = (x) => (100 * x).toFixed(1) + '%';

  for (const r of secs) {
    const t = r.t2, val = r.L2 + r.F2;
    if (!t.inst || t.anul) { flag(r, 'NAO_INSTALADA', t.inst ? 'seção anulada' : 'seção não instalada'); continue; }
    if (t.comp > t.aptos) flag(r, 'COMP_MAIOR_APTOS', `${t.comp} votantes para ${t.aptos} aptos`);
    const soma = val + t.br + t.nu + t.anu;
    if (soma !== t.comp) flag(r, 'SOMA_DIVERGENTE', `13+22+brancos+nulos = ${soma}, comparecimento = ${t.comp}`);
    if (t.nom !== val) flag(r, 'NOMINAIS_DIVERGENTE', `nominais = ${t.nom}, 13+22 = ${val}`);
    if (r.t1 && Math.abs(r.t1.aptos - t.aptos) > 10) flag(r, 'APTOS_MUDOU', `1º turno ${r.t1.aptos} → 2º turno ${t.aptos}`);
    if (val >= 20 && r.L2 === r.F2) flag(r, 'EMPATE_SECAO', `${r.L2} × ${r.F2}`);
    if (val >= 30 && (r.L2 === 0 || r.F2 === 0)) flag(r, 'ZERO_VOTOS', `${r.L2 === 0 ? 'Lula' : 'Flávio'} com 0 de ${val} válidos`);
    else if (val >= 100 && (r.L2 < 10 || r.F2 < 10)) flag(r, 'MENOS_10', `${r.L2 < 10 ? 'Lula' : 'Flávio'} com ${Math.min(r.L2, r.F2)} de ${val} válidos`);
    if (t.aptos >= 50 && t.comp / t.aptos >= 0.97) flag(r, 'COMPARECIMENTO_ALTO', `${pct(t.comp / t.aptos)} (${t.comp}/${t.aptos})`);
    if (t.comp >= 100 && (t.br + t.nu) / t.comp >= 0.25) flag(r, 'BRANCOS_NULOS_ALTO', `${pct((t.br + t.nu) / t.comp)} brancos+nulos`);
    if (!/^Urna Eletr/.test(t.origem)) flag(r, 'ORIGEM_NAO_URNA', t.origem);
    if (t.anu > 0) flag(r, 'VOTOS_ANULADOS', `${t.anu} votos anulados`);
    const dt = parseDt(t.receb); if (dt && dt > BU_LIMITE) flag(r, 'BU_TARDIO', `recebido em ${t.receb}`);
    if (r.t1 && r.t1.aptos >= 50 && r.t1.inst !== false) {
      const d = t.comp / t.aptos - r.t1.comp / r.t1.aptos;
      if (Math.abs(d) >= 0.25) flag(r, 'COMPARECIMENTO_SALTO', `${pct(r.t1.comp / r.t1.aptos)} → ${pct(t.comp / t.aptos)}`);
    }
    if (r.swing != null) {
      const m = swingMed.get(`${r.uf}|${r.zona}`), d = r.swing - m;
      if (Math.abs(d) >= 0.30) flag(r, 'VIRADA_ATIPICA', `Lula 1ºT ${pct(r.L1 / (r.L1 + r.F1))} → 2ºT ${pct(r.L2 / val)} (zona variou ${(m * 100).toFixed(1)} p.p.)`);
    }
  }

  // desvio dentro do mesmo local de votação (binomial: seção vs. demais seções do local)
  for (const r of secs) {
    const val = r.L2 + r.F2; if (val < 50 || !r.lk) continue;
    const lo = LOC.get(r.lk); const nr = lo.L + lo.F - val; if (nr < 150) continue;
    const p = (lo.L - r.L2) / nr; if (p <= 0.01 || p >= 0.99) continue;
    const z = (r.L2 / val - p) / Math.sqrt(p * (1 - p) / val);
    if (Math.abs(z) >= 6) flag(r, 'DESVIO_LOCAL', `Lula ${pct(r.L2 / val)} na seção × ${pct(p)} nas demais do local (z = ${z.toFixed(1)})`);
  }
  // ---------- quantos casos seriam esperados por acaso ----------
  const lgam = (n) => { let x = n + 1, t = x + 5.5, s2 = 1.000000000190015, c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; t -= (x + 0.5) * Math.log(t); for (let j = 0; j < 6; j++) s2 += c[j] / (x + 1 + j); return -t + Math.log(2.5066282746310005 * s2 / x); };
  const pmf = (k, n, p) => Math.exp(lgam(n) - lgam(k) - lgam(n - k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
  const esperado = { EMPATE_SECAO: 0, ZERO_VOTOS: 0, MENOS_10: 0 };
  for (const r of secs) {
    const val = r.L2 + r.F2; if (!r.lk || val < 20 || !r.t2.inst) continue;
    const lo = LOC.get(r.lk); let nr = lo.L + lo.F - val, p;
    if (nr >= 50) p = (lo.L - r.L2) / nr; else { const z = ZON.get(r.uf + '|' + r.zona); p = (z.L - r.L2) / (z.L + z.F - val); }
    p = Math.min(Math.max(p, 0.002), 0.998);
    if (val % 2 === 0) esperado.EMPATE_SECAO += pmf(val / 2, val, p);
    if (val >= 30) esperado.ZERO_VOTOS += pmf(0, val, p) + pmf(val, val, p);
    if (val >= 100) { let q = 0; for (let k = 1; k < 10; k++) q += pmf(k, val, p) + pmf(val - k, val, p); esperado.MENOS_10 += q; }
  }
  console.log('Esperado por acaso:', esperado);
  // zona / município
  for (const z of ZON.values()) {
    if (z.L === z.F && z.L > 0) flag(z, 'EMPATE_ZONA', `${z.L} × ${z.F}`);
    if (z.L + z.F >= 100 && (z.L < 10 || z.F < 10)) flag(z, 'ZONA_MENOS_10', `Lula ${z.L} × Flávio ${z.F}`);
  }
  for (const m of MUN.values()) {
    if (m.L === m.F && m.L > 0) flag(m, 'EMPATE_MUNICIPIO', `${m.L} × ${m.F}`);
    if (m.L + m.F >= 100 && (m.L < 10 || m.F < 10)) flag(m, 'MUNICIPIO_MENOS_10', `Lula ${m.L} × Flávio ${m.F}`);
  }

  // ---------- saída ----------
  const cont = {}; for (const a of anoms) cont[a.tipo] = (cont[a.tipo] || 0) + 1;
  console.log('\nTotal seções 2º turno:', secs.length);
  console.log('Brasil:', BR);
  console.log('Anomalias por tipo:', cont);

  const r4 = (x) => (x == null ? null : Math.round(x * 1e4) / 1e4);
  const pick = (a) => [a.secoes, a.aptos, a.comp, a.br, a.nu, a.L, a.F, a.L1, a.F1, a.O1, a.anom];
  const data = {
    gerado: new Date().toISOString(),
    campos: ['secoes', 'aptos', 'comparecimento', 'brancos', 'nulos', 'lula', 'flavio', 'lula1t', 'flavio1t', 'outros1t', 'anomalias'],
    brasil: pick(BR),
    ufs: [...UF.values()].map((u) => [u.uf, ...pick(u)]),
    municipios: [...MUN.values()].map((m) => [m.uf, m.mun, m.nome, r4(m.lat), r4(m.lon), ...pick(m)]),
    zonas: [...ZON.values()].map((z) => [z.uf, z.zona, ...pick(z)]),
    locais: [...LOC.values()].filter((l) => l.lat != null).map((l) => [l.uf, l.mun, l.zona, l.nome, l.bairro || '', r4(l.lat), r4(l.lon), l.secoes, l.aptos, l.comp, l.L, l.F, l.anom]),
    tipos: TIPOS, gravidade: GRAV, contagem: cont, esperado,
    anomalias: anoms.map((a) => [a.tipo, a.uf, a.mun, a.nome, a.zona, a.secao, a.local, a.L, a.F, a.det, r4(a.lat), r4(a.lon)]),
  };
  fs.writeFileSync(path.join(OUT, 'dados.json'), JSON.stringify(data));

  const esc = (v) => (v == null ? '' : /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = (file, head, rows) => fs.writeFileSync(path.join(OUT, file), '﻿' + [head, ...rows].map((r) => r.map(esc).join(';')).join('\n'));
  csv('anomalias.csv', ['tipo', 'descricao', 'gravidade', 'uf', 'cod_municipio', 'municipio', 'zona', 'secao', 'local', 'lula', 'flavio', 'detalhe', 'lat', 'lon'],
    anoms.map((a) => [a.tipo, TIPOS[a.tipo], a.g, a.uf, a.mun, a.nome, a.zona, a.secao, a.local, a.L, a.F, a.det, a.lat, a.lon]));
  csv('secoes_2turno.csv', ['uf', 'cod_municipio', 'municipio', 'zona', 'secao', 'local', 'bairro', 'lat', 'lon', 'aptos', 'comparecimento', 'abstencoes', 'lula', 'flavio', 'brancos', 'nulos', 'lula_1t', 'flavio_1t', 'outros_1t', 'aptos_1t', 'comparecimento_1t', 'origem', 'modelo_urna', 'recebimento_bu', 'secoes_agregadas'],
    secs.map((r) => [r.uf, r.mun, munNome.get(`${r.uf}|${r.mun}`), r.zona, r.secao, r.t2.nmLocal, r.bairro, r.lat, r.lon, r.t2.aptos, r.t2.comp, r.t2.abst, r.L2, r.F2, r.t2.br, r.t2.nu, r.L1, r.F1, r.O1, r.t1?.aptos, r.t1?.comp, r.t2.origem, r.t2.urna, r.t2.receb, (r.agreg || []).join(' ')]));
  const aggCsv = (file, extraHead, rows, extra) => csv(file, [...extraHead, 'secoes', 'aptos', 'comparecimento', 'brancos', 'nulos', 'lula', 'flavio', 'lula_1t', 'flavio_1t', 'outros_1t', 'anomalias'], rows.map((a) => [...extra(a), ...pick(a)]));
  aggCsv('municipios.csv', ['uf', 'cod_municipio', 'municipio'], [...MUN.values()], (m) => [m.uf, m.mun, m.nome]);
  aggCsv('zonas.csv', ['uf', 'zona'], [...ZON.values()], (z) => [z.uf, z.zona]);
  aggCsv('ufs.csv', ['uf'], [...UF.values()], (u) => [u.uf]);
  console.log('Arquivos gravados em', OUT);
})();
