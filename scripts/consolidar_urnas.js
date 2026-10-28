// Consolida a auditoria dos arquivos de urna em indicadores e alertas por seção.
// Cruza com os dados abertos (votos por seção) e com o perfil do eleitorado (eleitores com biometria).
// Uso: TURNO=<1|2> node consolidar_urnas.js <pasta_urnaout> <pasta_out> <pasta_an>   (grava urnas.json ou urnas_1t.json)
const fs = require('fs');
const path = require('path');
const [UO, OUT, AN] = process.argv.slice(2);
const TURNO = process.env.TURNO || '2', SUF = TURNO === '1' ? '_1t' : '';

function parseLine(line, sep = ';') {
  const out = []; let i = 0; const n = line.length;
  while (i <= n) {
    if (line[i] === '"') { let j = i + 1, s = ''; while (j < n) { if (line[j] === '"') { if (line[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += line[j++]; } out.push(s); i = j + 2; }
    else { let j = line.indexOf(sep, i); if (j < 0) j = n; out.push(line.slice(i, j)); i = j + 1; }
  }
  return out;
}
const chave = (uf, mun, zona, sec) => `${uf}|${+mun}|${+zona}|${+sec}`;

const linhas = fs.readFileSync(path.join(OUT, 'secoes_2turno.csv'), 'utf8').replace(/^﻿/, '').split('\n').filter(Boolean);
const H = Object.fromEntries(parseLine(linhas[0]).map((k, i) => [k, i]));
const ABERTOS = new Map();
for (const l of linhas.slice(1)) { const f = parseLine(l); ABERTOS.set(chave(f[H.uf], f[H.cod_municipio], f[H.zona], f[H.secao]), { nome: f[H.municipio], local: f[H.local], lat: +f[H.lat] || null, lon: +f[H.lon] || null, L: +f[H['lula' + SUF]], F: +f[H['flavio' + SUF]], comp: +f[H['comparecimento' + SUF]], aptos: +f[H['aptos' + SUF]], agregadas: f[H.secoes_agregadas] }); }
const PERFIL = fs.existsSync(path.join(AN, 'perfil_secao.json')) ? JSON.parse(fs.readFileSync(path.join(AN, 'perfil_secao.json'), 'utf8')) : {};

const TIPOS = {
  RDV_DIVERGE: { g: 3, t: 'Registro digital do voto não bate com o boletim' },
  BU_DIVERGE: { g: 3, t: 'Boletim da urna não bate com os dados divulgados pelo TSE' },
  HASH_FALHA: { g: 3, t: 'Arquivo da urna não bate com o hash assinado' },
  ASSINATURA_FALHA: { g: 3, t: 'Assinatura digital da urna não confere' },
  CADEIA_FALHA: { g: 3, t: 'Certificado da urna não foi emitido por uma autoridade do TSE' },
  LOG_DIVERGE: { g: 2, t: 'Votos no log diferentes do comparecimento' },
  LIBERACAO_MESARIO: { g: 2, t: 'Muitos eleitores liberados pelo mesário (sem a digital do eleitor)' },
  BIOMETRIA_BAIXA: { g: 2, t: 'Poucos votaram com biometria, apesar de quase todos terem digital cadastrada' },
  VOTO_RAPIDO: { g: 2, t: 'Votos computados em até 3 segundos após a liberação' },
  RAJADA: { g: 2, t: 'Sequência de 6+ votos com menos de 15 segundos entre eles' },
  VOTO_TARDIO: { g: 1, t: 'Votos mais de 1 hora após o horário de encerramento' },
  REINICIOS: { g: 1, t: 'Urna ligada 3 ou mais vezes no dia da eleição' },
  CONTINGENCIA: { g: 1, t: 'Urna substituída por urna de contingência durante a votação' },
};

const indicadores = [], horas = { votos: new Array(24).fill(0), mes: new Array(24).fill(0) };
const totais = { secoes: 0, cedula: 0, comLog: 0, comRdv: 0, hashConferidos: 0, hashOk: 0, assinConferidas: 0, assinOk: 0, ed521: 0, ecdsa: 0, cadeiaConferidas: 0, cadeiaOk: 0, porAC: {}, contingencia: 0, pos17: 0, pos18: 0, pos19: 0, secoesPos17: 0, pos17UF: {}, fusos: {}, rdvConferidos: 0, rdvOk: 0, buConferidos: 0, buOk: 0, comp: 0, bio: 0, biog: 0, semBio: 0, mesHab: 0 };
for (const f of fs.readdirSync(UO).filter((f) => f.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(path.join(UO, f), 'utf8')); const uf = d.uf;
  d.horas.votos.forEach((v, i) => (horas.votos[i] += v)); d.horas.mes.forEach((v, i) => (horas.mes[i] += v));
  for (const row of d.secoes) {
    const r = Object.fromEntries(d.campos.map((c, i) => [c, row[i]]));
    const k = chave(uf, r.mun, r.zona, r.secao); const a = ABERTOS.get(k) || {}; const p = PERFIL[k];
    totais.secoes++;
    const x = { uf, mun: r.mun, nome: a.nome, zona: r.zona, secao: r.secao, local: a.local, lat: a.lat, lon: a.lon, comp: r.comp, alertas: [] };
    const al = (t, det) => x.alertas.push([t, det]);
    // seções que votaram em cédula (exterior, sistema de apuração) não têm boletim eletrônico
    if (r.comp == null && !r.rdvTotal) { totais.cedula++; continue; }
    if (r.rdvTotal != null) { totais.rdvConferidos++; if (r.rdvL === r.L && r.rdvF === r.F && r.rdvTotal === r.comp) totais.rdvOk++; else al('RDV_DIVERGE', `RDV: Lula ${r.rdvL}, Flávio ${r.rdvF}, ${r.rdvTotal} votos · boletim: ${r.L}, ${r.F}, ${r.comp}`); }
    if (r.L != null && a.L != null) { totais.buConferidos++; if (r.L === a.L && r.F === a.F && r.comp === a.comp) totais.buOk++; else al('BU_DIVERGE', `boletim: Lula ${r.L}, Flávio ${r.F}, comparecimento ${r.comp} · TSE: ${a.L}, ${a.F}, ${a.comp}`); }
    if (r.hashOk != null) { totais.hashConferidos++; if (r.hashOk === 1 && r.manifestoOk === 1) totais.hashOk++; else al('HASH_FALHA', `${r.hashConf} arquivos conferidos`); }
    if (r.assinaturaOk != null) { totais.assinConferidas++; if (r.assinaturaOk === 1) totais.assinOk++; else al('ASSINATURA_FALHA', `esquema ${r.esquema}`); if (r.esquema === 'Ed521') totais.ed521++; if (r.esquema === 'ECDSA') totais.ecdsa++; }
    if (r.cadeiaOk != null) { totais.cadeiaConferidas++; if (r.cadeiaOk === 1) { totais.cadeiaOk++; totais.porAC[r.ac] = (totais.porAC[r.ac] || 0) + 1; } else al('CADEIA_FALHA', 'nenhuma das autoridades AC URNA, AC UE2020 ou AC UE2022 assinou o certificado'); }
    if (r.contingencia) { totais.contingencia++; al('CONTINGENCIA', `${r.logs} logs no arquivo (urna original + substituta)`); }
    const obs = r.contingencia ? ' (houve troca de urna)' : '';
    if (r.votos != null) {
      totais.comLog++;
      // votos depois do horário oficial (17h, 18h e 19h de Brasília), contados no log de cada urna
      totais.pos17 += r.pos17 || 0; totais.pos18 += r.pos18 || 0; totais.pos19 += r.pos19 || 0; if (r.pos17) totais.secoesPos17++;
      if (r.pos17) totais.pos17UF[uf] = (totais.pos17UF[uf] || 0) + r.pos17;
      totais.fusos[r.fusoOffset] = (totais.fusos[r.fusoOffset] || 0) + 1;
      if (r.votos !== r.comp) al('LOG_DIVERGE', `log: ${r.votos} votos · boletim: ${r.comp}`);
      if (r.comp >= 50 && r.mesHab / r.comp >= 0.25) al('LIBERACAO_MESARIO', `${r.mesHab} de ${r.comp} eleitores (${Math.round(100 * r.mesHab / r.comp)}%) liberados pelo mesário${r.mesHabUlt ? `, ${r.mesHabUlt} na última hora` : ''}${obs}`);
      if (r.rapidos >= 5) al('VOTO_RAPIDO', `${r.rapidos} votos em até 3 s (mediana da seção: ${r.durMed} s)`);
      if (r.maiorRajada >= 6) al('RAJADA', `${r.maiorRajada} votos seguidos com menos de 15 s entre eles`);
      if (r.tardios >= 1) al('VOTO_TARDIO', `${r.tardios} voto(s) mais de 1 h após o encerramento`);
      if (r.ligada >= 3) al('REINICIOS', `urna ligada ${r.ligada} vezes no dia`);
    }
    if (p && r.comp >= 50 && r.bio != null) {
      const cad = p[9] / p[0], usou = r.bio / r.comp;
      x.bioCad = Math.round(cad * 1000) / 10; x.bioUso = Math.round(usou * 1000) / 10;
      if (cad >= 0.9 && usou < cad - 0.4) al('BIOMETRIA_BAIXA', `${x.bioUso}% votaram com digital; ${x.bioCad}% têm digital cadastrada${obs}`);
    }
    totais.comp += r.comp || 0; totais.bio += r.bio || 0; totais.biog += r.biog || 0; totais.semBio += r.semBio || 0; totais.mesHab += r.mesHab || 0;
    x.mesHab = r.mesHab; x.durMed = r.durMed; x.primeiro = r.primeiro; x.ultimo = r.ultimo; x.contingencia = r.contingencia || 0;
    if (x.alertas.length) indicadores.push(x);
  }
}
const cont = {}; for (const x of indicadores) for (const [t] of x.alertas) cont[t] = (cont[t] || 0) + 1;
console.log(totais); console.log(cont);
const ordem = (x) => -Math.max(...x.alertas.map(([t]) => TIPOS[t].g)) * 1000 - x.alertas.length;
indicadores.sort((a, b) => ordem(a) - ordem(b));
fs.writeFileSync(path.join(AN, `urnas${SUF}.json`), JSON.stringify({ tipos: TIPOS, totais, contagem: cont, horas, casos: indicadores.slice(0, 6000), totalCasos: indicadores.length }));
console.log('gravado', indicadores.length, 'seções com alerta');
