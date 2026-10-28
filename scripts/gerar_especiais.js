// Resultado por tipo oficial de seção (cadastro de locais do TSE): convencional, preso provisório, voto em trânsito, temporária.
// Uso: node gerar_especiais.js <pasta_raw> <pasta_out> <arquivo_saida.json>
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
const NOME = { 1: 'Convencional', 2: 'Voto em trânsito', 3: 'Preso provisório', 4: 'Temporária' };

(async () => {
  const tipo = new Map();
  await new Promise((res) => {
    const p = spawn('unzip', ['-p', path.join(RAW, 'LOC.zip'), 'eleitorado_local_votacao_2026_BRASIL.csv']); p.stdout.setEncoding('latin1'); let h = null;
    readline.createInterface({ input: p.stdout }).on('line', (l) => {
      const f = parseLine(l); if (!h) { h = Object.fromEntries(f.map((k, i) => [k, i])); return; }
      if (f[h.NR_TURNO] !== '2' || f[h.CD_TIPO_SECAO_AGREGADA] === '2') return; // seções agregadas votam na principal
      tipo.set(chave(f[h.SG_UF], f[h.CD_MUNICIPIO], f[h.NR_ZONA], f[h.NR_SECAO]), +f[h.CD_TIPO_LOCAL]);
    }).on('close', res);
  });
  const linhas = fs.readFileSync(path.join(OUT, 'secoes_2turno.csv'), 'utf8').replace(/^﻿/, '').split('\n').filter(Boolean);
  const H = Object.fromEntries(parseLine(linhas[0]).map((k, i) => [k, i]));
  const tot = {}, porUF = {}, casos = [];
  const novo = () => ({ secoes: 0, aptos: 0, comp: 0, L: 0, F: 0, bn: 0, L1: 0, F1: 0, O1: 0, aptos1: 0, comp1: 0 });
  const soma = (a, s) => { a.secoes++; for (const k of ['aptos', 'comp', 'L', 'F', 'bn', 'L1', 'F1', 'O1', 'aptos1', 'comp1']) a[k] += s[k]; };
  for (const l of linhas.slice(1)) {
    const f = parseLine(l);
    const s = { uf: f[H.uf], mun: +f[H.cod_municipio], nome: f[H.municipio], zona: +f[H.zona], secao: +f[H.secao], local: f[H.local], bairro: f[H.bairro], lat: +f[H.lat] || null, lon: +f[H.lon] || null,
      aptos: +f[H.aptos], comp: +f[H.comparecimento], L: +f[H.lula], F: +f[H.flavio], bn: +f[H.brancos] + +f[H.nulos], L1: +f[H.lula_1t] || 0, F1: +f[H.flavio_1t] || 0, O1: +f[H.outros_1t] || 0, aptos1: +f[H.aptos_1t] || 0, comp1: +f[H.comparecimento_1t] || 0 };
    const t = tipo.get(chave(s.uf, s.mun, s.zona, s.secao)) || 1;
    soma(tot[t] || (tot[t] = novo()), s);
    if (t !== 1) { const k = `${t}|${s.uf}`; soma(porUF[k] || (porUF[k] = novo()), s); s.tipo = t; casos.push(s); }
  }
  const out = { nomes: NOME, totais: tot, porUF: Object.entries(porUF).map(([k, v]) => ({ tipo: +k.split('|')[0], uf: k.split('|')[1], ...v })), casos };
  fs.writeFileSync(SAIDA, JSON.stringify(out));
  for (const [t, a] of Object.entries(tot)) console.log(NOME[t], a.secoes, 'seções |', a.aptos, 'aptos | comparecimento', (100 * a.comp / a.aptos).toFixed(1) + '% (1ºT ' + (100 * a.comp1 / a.aptos1).toFixed(1) + '%) | Lula', (100 * a.L / (a.L + a.F)).toFixed(1) + '% | Lula 1ºT entre os dois', (100 * a.L1 / (a.L1 + a.F1)).toFixed(1) + '% | brancos+nulos', (100 * a.bn / a.comp).toFixed(1) + '%');
})();
