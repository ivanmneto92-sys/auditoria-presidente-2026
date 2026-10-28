// Auditoria dos arquivos de urna do TSE (Presidente 2026): logs, boletim (imagem), registro digital do voto,
// manifesto de hashes assinado pela urna e certificado da urna. Lê cada estado direto do download, sem gravar o zip.
// Uso: CERTS=<pasta_certificados> TURNO=<1|2> node auditar_urnas.js <ignorado> <pasta_saida> [UF ...]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const TMP = process.argv[2], OUT = process.argv[3];
const UFS = process.argv.slice(4).length ? process.argv.slice(4) : ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO', 'ZZ'];
if (require.main === module) fs.mkdirSync(OUT, { recursive: true });
// TURNO=1 ou 2 (padrão 2); CERTS = pasta com acurna.pem, acue2020.pem e acue2022.pem (autoridades intermediárias do TSE)
const TURNO = process.env.TURNO || '2', DIA = TURNO === '1' ? '04/10/2026' : '25/10/2026';
const URL = (uf) => `https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2026/arqurnatot/bu_imgbu_logjez_rdv_vscmr_2026_${TURNO}t_${uf}.zip`;

// ---------------- leitor de zip (com zip64) lendo do disco por partes ----------------
function abrirZip(file) {
  const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size;
  const ler = (pos, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos); return b; };
  const tail = ler(Math.max(0, size - 70000), Math.min(size, 70000));
  let e = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (e < 0) throw new Error('EOCD não encontrado');
  let cdCount = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
  const loc = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]));
  if (loc >= 0 && (cdOff === 0xffffffff || cdCount === 0xffff)) {
    const z64 = Number(tail.readBigUInt64LE(loc + 8)); const r = ler(z64, 56);
    cdCount = Number(r.readBigUInt64LE(32)); cdSize = Number(r.readBigUInt64LE(40)); cdOff = Number(r.readBigUInt64LE(48));
  }
  const cd = ler(cdOff, cdSize); const ents = [];
  for (let p = 0, i = 0; i < cdCount; i++) {
    const method = cd.readUInt16LE(p + 10); let csz = cd.readUInt32LE(p + 20), usz = cd.readUInt32LE(p + 24);
    const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
    let off = cd.readUInt32LE(p + 42); const name = cd.toString('latin1', p + 46, p + 46 + nl);
    let x = p + 46 + nl; const xe = x + xl;
    while (x < xe) {
      const id = cd.readUInt16LE(x), l = cd.readUInt16LE(x + 2); let q = x + 4;
      if (id === 1) { if (usz === 0xffffffff) { usz = Number(cd.readBigUInt64LE(q)); q += 8; } if (csz === 0xffffffff) { csz = Number(cd.readBigUInt64LE(q)); q += 8; } if (off === 0xffffffff) { off = Number(cd.readBigUInt64LE(q)); } }
      x += 4 + l;
    }
    ents.push({ name, method, csz, usz, off }); p = xe + cl;
  }
  const extrair = (en) => {
    const lh = ler(en.off, 30); const start = en.off + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
    const raw = ler(start, en.csz); return en.method === 8 ? zlib.inflateRawSync(raw) : raw;
  };
  return { ents, extrair, fechar: () => fs.closeSync(fd) };
}
// zip pequeno inteiramente em memória (o log.jez)
function zipMem(b) {
  const out = {}; let p = 0;
  while (p + 30 <= b.length && b.readUInt32LE(p) === 0x04034b50) {
    const method = b.readUInt16LE(p + 8), csz = b.readUInt32LE(p + 18), nl = b.readUInt16LE(p + 26), xl = b.readUInt16LE(p + 28);
    const name = b.toString('latin1', p + 30, p + 30 + nl), s = p + 30 + nl + xl;
    const raw = b.subarray(s, s + csz); out[name] = method === 8 ? zlib.inflateRawSync(raw) : raw; p = s + csz;
  }
  return out;
}

// ---------------- DER ----------------
function rd(b, o) {
  const t = b[o]; let p = o + 1; let tag = t & 0x1f;
  if (tag === 0x1f) { tag = 0; while (b[p] & 0x80) tag = (tag << 7) | (b[p++] & 0x7f); tag = (tag << 7) | b[p++]; }
  let len = b[p++]; if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + b[p++]; }
  return { t, cls: t >> 6, cons: !!(t & 0x20), tag, start: p, end: p + len };
}
const kids = (b, n) => { const r = []; let s = n.start; while (s < n.end) { const k = rd(b, s); r.push(k); s = k.end; } return r; };
const root = (b) => rd(b, 0);
const intv = (b, n) => b.readIntBE(n.start, Math.min(6, n.end - n.start));

// Registro Digital do Voto: contagem de votos para Presidente (cargo 1)
function rdvPresidente(b) {
  const top = kids(b, root(b)); const corpo = kids(b, top[2]); const eleicoes = kids(b, corpo[4]);
  const cont = new Map(); let total = 0;
  for (const el of eleicoes) {
    for (const lista of kids(b, kids(b, el)[1])) {
      const k = kids(b, lista); const cargo = b[k[0].start];
      if (cargo !== 1) continue;
      for (const v of kids(b, k[2])) {
        const vk = kids(b, v); const tipo = b[vk[0].start]; const dig = vk[1] ? b.toString('latin1', vk[1].start, vk[1].end) : '';
        const chave = tipo + ':' + dig; cont.set(chave, (cont.get(chave) || 0) + 1); total++;
      }
    }
  }
  return { cont, total };
}
// Manifesto de hashes assinado pela própria urna (bloco cujo identificador começa com "UEAO"/"ueao" no .vsc).
// Urnas novas assinam com Ed521 (certificado em PEM com OID próprio do TSE); as antigas, com ECDSA P-521 (X.509 padrão).
// Nos dois casos a mensagem assinada é SHA-512(hash SHA-512 do manifesto).
function manifesto(b) {
  const blocos = kids(b, root(b));
  for (const bl of blocos) {
    const k = kids(b, bl); if (k.length < 5) continue;
    const info = kids(b, k[2]); const id = kids(b, info[0]);
    if (!/^ueao/i.test(b.toString('latin1', id[0].start, id[0].end))) continue;
    const conteudo = b.subarray(k[3].start, k[3].end);
    const assin = kids(b, info[3]);
    const hashAssinado = b.subarray(assin[1].start, assin[1].end), assinatura = b.subarray(assin[2].start, assin[2].end);
    const cert = b.subarray(k[4].start, k[4].end);
    const lista = new Map();
    const c = rd(conteudo, 0); const seq = kids(conteudo, kids(conteudo, c)[0]);
    for (const it of seq) { const ik = kids(conteudo, it); const nome = conteudo.toString('latin1', ik[0].start, ik[0].end); const hk = kids(conteudo, ik[1]); lista.set(nome, conteudo.subarray(hk[1].start, hk[1].end)); }
    return { conteudo, hashAssinado, assinatura, cert, lista };
  }
  return null;
}
const ed521 = require('./ed521.js');
function chaveEd521(pem) {
  const der = Buffer.from(pem.toString('latin1').replace(/-----[^-]+-----|\s/g, ''), 'base64');
  const cert = rd(der, 0); const tbs = kids(der, cert)[0];
  const spki = kids(der, tbs).find((n) => n.t === 0x30 && kids(der, n).some((x) => x.t === 0x03));
  const bits = kids(der, spki).find((x) => x.t === 0x03);
  return der.subarray(bits.start + 1, bits.end);
}
// cadeia: o certificado da urna foi emitido (assinado) por uma das autoridades intermediárias do TSE?
const derDePem = (pem) => Buffer.from(pem.toString('latin1').replace(/-----[^-]+-----|\s/g, ''), 'base64');
const ACS = (() => {
  const dir = process.env.CERTS; if (!dir) return null;
  const ler = (n) => fs.readFileSync(path.join(dir, n + '.pem'));
  return { ed: [['AC UE2022', chaveEd521(ler('acue2022'))], ['AC UE2020', chaveEd521(ler('acue2020'))]], urna: new crypto.X509Certificate(ler('acurna')) };
})();
function verificarCadeia(cert) {
  if (!ACS) return { ok: null, ac: null };
  if (cert.subarray(0, 10).toString('latin1').startsWith('-----BEGIN')) {
    const d = derDePem(cert); const raiz = rd(d, 0); const k = kids(d, raiz);
    // o TBSCertificate é o primeiro filho: começa onde começa o conteúdo do certificado
    const tbsTLV = d.subarray(raiz.start, k[0].end), sig = d.subarray(k[2].start + 1, k[2].end);
    for (const [nome, chave] of ACS.ed) if (ed521.verificar(chave, tbsTLV, sig)) return { ok: 1, ac: nome };
    return { ok: 0, ac: null };
  }
  const x = new crypto.X509Certificate(cert);
  return x.verify(ACS.urna.publicKey) ? { ok: 1, ac: 'AC URNA' } : { ok: 0, ac: null };
}
function verificarAssinatura(mf) {
  const msg = crypto.createHash('sha512').update(mf.hashAssinado).digest();
  if (mf.cert.subarray(0, 10).toString('latin1').startsWith('-----BEGIN')) {
    return { esquema: 'Ed521', ok: ed521.verificar(chaveEd521(mf.cert), msg, mf.assinatura) ? 1 : 0 };
  }
  const x = new crypto.X509Certificate(mf.cert);
  return { esquema: 'ECDSA', ok: crypto.verify('sha512', mf.hashAssinado, { key: x.publicKey, dsaEncoding: 'der' }, mf.assinatura) ? 1 : 0 };
}

// ---------------- imagem do boletim ----------------
function lerImgBu(b) {
  const t = b.toString('latin1');
  const n = (re) => { const m = re.exec(t); return m ? +m[1] : null; };
  const hh = (re) => { const m = re.exec(t); return m ? m[1] : null; };
  const r = {
    aptos: n(/Eleitores aptos\s+(\d+)/), comp: n(/Comparecimento\s+(\d+)/), bio: n(/Habilita..o biom.trica\s+(\d+)/), biog: n(/Habilita..o biogr.fica\s+(\d+)/),
    semBio: n(/Habilita..o sem biometria\s+(\d+)/), abert: hh(/Hor.rio de abertura\s+(\d\d:\d\d:\d\d)/), fech: hh(/Hor.rio de fechamento\s+(\d\d:\d\d:\d\d)/), L: null, F: null, br: null, nu: null,
  };
  // o cabeçalho do cargo é "-----PRESIDENTE-----" (não confundir com municípios como "Presidente Figueiredo")
  const mc = /-{3,}PRESIDENTE-{3,}/.exec(t); const i = mc ? mc.index : -1;
  if (i >= 0) {
    const bloco = t.slice(i, t.indexOf('Total Apurado', i) + 40);
    for (const m of bloco.matchAll(/^\s+(.+?)\s+(\d{2})\s+(\d+)\s*$/gm)) { if (m[2] === '13') r.L = +m[3]; if (m[2] === '22') r.F = +m[3]; }
    r.br = n.call(null, /Brancos\s+(\d+)/.exec(bloco) ? /Brancos\s+(\d+)/ : /$^/) ?? null;
    const mb = /Brancos\s+(\d+)/.exec(bloco), mn = /Nulos\s+(\d+)/.exec(bloco); r.br = mb ? +mb[1] : null; r.nu = mn ? +mn[1] : null;
    if (r.L == null) r.L = 0; if (r.F == null) r.F = 0;
  }
  return r;
}

// ---------------- log ----------------
const seg = (s) => +s.slice(0, 2) * 3600 + +s.slice(3, 5) * 60 + +s.slice(6, 8);
// textos: o log da urna e, quando houve troca por urna de contingência, o log da urna original embutido
function lerLog(textos) {
  const r = { votos: 0, primeiro: null, ultimo: null, mesHab: 0, mesHabUlt: 0, manual: 0, rapidos: 0, durMed: null, maiorRajada: 0, ligada: 0, erros: 0, tardios: 0, porHora: new Array(24).fill(0), mesPorHora: new Array(24).fill(0), substituida: 0, contingencia: 0, logs: textos.length };
  let hab = null, ultVoto = null, run = 1, abre = null; const durs = [], votos = [], mesT = [];
  const dia = [];
  // o mesmo log pode vir em mais de uma cópia (mídia externa + log completo): linhas idênticas contam uma vez só
  const vistas = new Set();
  for (const txt of textos) for (const linha of txt.split('\n')) if (linha.startsWith(DIA) && !vistas.has(linha)) { vistas.add(linha); dia.push(linha); }
  dia.sort((a, b) => (a.slice(11, 19) < b.slice(11, 19) ? -1 : a.slice(11, 19) > b.slice(11, 19) ? 1 : 0));
  for (const linha of dia) {
    if (/conting.ncia executada|Modo de carga da UE - Urna de conting/i.test(linha)) r.contingencia = 1;
    const f = linha.split('\t'); const s = seg(f[0].slice(11)); const msg = f[4] || '';
    if (f[1] === 'ERRO') r.erros++;
    if (abre == null && msg.startsWith('Aguardando digita') && msg.includes('identificador do eleitor')) abre = s;
    if (msg === 'Eleitor foi habilitado') hab = s;
    else if (msg === 'O voto do eleitor foi computado') {
      r.votos++; votos.push(s); r.porHora[Math.floor(s / 3600)]++;
      if (hab != null) durs.push(s - hab);
      if (ultVoto != null) { if (s - ultVoto <= 15) { run++; if (run > r.maiorRajada) r.maiorRajada = run; } else run = 1; }
      ultVoto = s; hab = null;
    } else if (/^Mes.rio \d+ habilitou o eleitor/.test(msg)) { r.mesHab++; mesT.push(s); r.mesPorHora[Math.floor(s / 3600)]++; }
    else if (msg.startsWith('Solicita') && msg.includes('habilita') && msg.includes('manual')) r.manual++;
    else if (msg.startsWith('Urna ligada em')) r.ligada++;
    else if (/substitu/i.test(msg) && /urna/i.test(msg)) r.substituida++;
  }
  if (votos.length) {
    r.primeiro = votos[0]; r.ultimo = votos[votos.length - 1];
    // A votação vai das 8h às 17h de Brasília em todo o país; o log usa a hora local da urna.
    // A abertura (primeira espera por eleitor) arredondada à hora cheia dá as 8h de Brasília no fuso local.
    const oito = abre != null ? Math.round(abre / 3600) * 3600 : Math.floor(r.primeiro / 3600) * 3600;
    const fecha = oito + 9 * 3600;
    r.fusoOffset = Math.round(oito / 3600) - 8; // 0 = horário de Brasília, -1 = Amazonas etc., -2 = Acre
    r.pos17 = votos.filter((v) => v >= fecha).length; r.pos18 = votos.filter((v) => v >= fecha + 3600).length; r.pos19 = votos.filter((v) => v >= fecha + 7200).length;
    r.tardios = votos.filter((v) => v > fecha + 3600).length;
    r.mesHabUlt = mesT.filter((v) => v > fecha - 3600).length;
  }
  if (durs.length) { durs.sort((a, b) => a - b); r.durMed = durs[durs.length >> 1]; r.rapidos = durs.filter((d) => d <= 3).length; }
  return r;
}

// ---------------- processamento de um estado (direto do download, sem gravar o zip) ----------------
// Os cabeçalhos locais do zip do TSE trazem o tamanho de cada arquivo, então dá para ler em sequência.
function processarUF(uf) {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    console.log(`[${uf}] baixando e analisando em fluxo…`);
    const p = spawn('curl', ['-s', '-f', URL(uf)]);
    let buf = Buffer.alloc(0), fim = false, n = 0, bytes = 0;
    // Em duas etapas: os 4 arquivos principais são analisados assim que chegam e liberados da memória;
    // a imagem do boletim (que no zip do 1º turno vem toda no final) é conferida quando chegar.
    const abertos = new Map(), NUCLEO = ['bu.dat', 'rdv.dat', 'log.jez', 'vota.vsc'];
    const linhas = []; const horas = { votos: new Array(24).fill(0), mes: new Array(24).fill(0) };
    const fecha = (g) => {
      if (!g.r) g.r = analisar(g, horas);
      if (g.f['imgbu.dat']) completarImgBu(g.r, g.f['imgbu.dat']);
      abertos.delete(g.pref); linhas.push(g.r);
      if (++n % 20000 === 0) console.log(`[${uf}] ${n} seções, ${(bytes / 1e9).toFixed(1)} GB`);
    };
    const avanca = (g) => {
      if (!g.r && NUCLEO.every((k) => g.f[k])) { g.r = analisar(g, horas); for (const k of NUCLEO) delete g.f[k]; }
      if (g.r && g.f['imgbu.dat']) fecha(g);
    };
    p.stdout.on('data', (chunk) => {
      if (fim) return;
      bytes += chunk.length; buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      let o = 0;
      while (buf.length - o >= 30) {
        const sig = buf.readUInt32LE(o);
        if (sig !== 0x04034b50) { fim = true; break; } // diretório central: acabou
        const method = buf.readUInt16LE(o + 8), csz = buf.readUInt32LE(o + 18), nl = buf.readUInt16LE(o + 26), xl = buf.readUInt16LE(o + 28);
        const total = 30 + nl + xl + csz; if (buf.length - o < total) break;
        const name = buf.toString('latin1', o + 30, o + 30 + nl);
        const raw = buf.subarray(o + 30 + nl + xl, o + total);
        const m = /^(o\d{5}([a-z]{2})(\d{5})(\d{4})(\d{4}))-(\w+)\.(\w+)$/.exec(name);
        if (m) {
          let g = abertos.get(m[1]);
          if (!g) { g = { pref: m[1], mun: +m[3], zona: +m[4], secao: +m[5], f: {} }; abertos.set(m[1], g); }
          // guarda compactado até a seção ficar completa (descompactar aqui estourava a memória em estados grandes)
          g.f[`${m[6]}.${m[7]}`] = { method, raw: Buffer.from(raw) };
          avanca(g);
        }
        o += total;
      }
      buf = o ? Buffer.from(buf.subarray(o)) : buf;
      if (fim) p.kill();
    });
    p.on('close', (code) => {
      for (const g of [...abertos.values()]) fecha(g);
      if (!fim && code) return reject(new Error('curl saiu com código ' + code));
      const campos = CAMPOS;
      fs.writeFileSync(path.join(OUT, `${uf}.json`), JSON.stringify({ uf, campos, horas, secoes: linhas.map((r) => campos.map((c) => r[c] ?? null)) }));
      console.log(`[${uf}] pronto: ${linhas.length} seções, ${(bytes / 1e9).toFixed(2)} GB lidos`);
      resolve();
    });
  });
}
const CAMPOS = ['mun', 'zona', 'secao', 'aptos', 'comp', 'bio', 'biog', 'semBio', 'abert', 'fech', 'L', 'F', 'br', 'nu', 'rdvTotal', 'rdvL', 'rdvF', 'manifestoOk', 'hashOk', 'hashConf', 'votos', 'primeiro', 'ultimo', 'mesHab', 'mesHabUlt', 'manual', 'rapidos', 'durMed', 'maiorRajada', 'ligada', 'erros', 'tardios', 'pos17', 'pos18', 'pos19', 'fusoOffset', 'substituida', 'contingencia', 'logs', 'assinaturaOk', 'esquema', 'cadeiaOk', 'ac', 'erroLeitura'];

// segunda etapa: imagem do boletim que chegou depois dos arquivos principais
function completarImgBu(r, e) {
  if (r.L !== undefined && !r._hashImg) return; // já lida na primeira etapa
  try {
    const img = e.method === 8 ? zlib.inflateRawSync(e.raw) : e.raw;
    Object.assign(r, lerImgBu(img));
    if (r._hashImg) { r.hashConf = (r.hashConf || 0) + 1; if (!crypto.createHash('sha512').update(img).digest().equals(r._hashImg)) r.hashOk = 0; else if (r.hashOk == null) r.hashOk = 1; }
  } catch (err) { r.erroLeitura = String(err.message).slice(0, 80); }
  delete r._hashImg;
}

function analisar(g, horas) {
  const pref = g.pref;
  {
    const cache = {};
    const ler = (k) => { const e = g.f[k]; if (!e) return null; if (!cache[k]) cache[k] = e.method === 8 ? zlib.inflateRawSync(e.raw) : e.raw; return cache[k]; };
    const r = { mun: g.mun, zona: g.zona, secao: g.secao };
    try {
      const img = ler('imgbu.dat'); if (img) Object.assign(r, lerImgBu(img));
      const rdv = ler('rdv.dat');
      if (rdv) { const c = rdvPresidente(rdv); r.rdvTotal = c.total; r.rdvL = 0; r.rdvF = 0; for (const [k, v] of c.cont) { if (k.endsWith(':13')) r.rdvL += v; if (k.endsWith(':22')) r.rdvF += v; } }
      const vsc = ler('vota.vsc'); const bu = ler('bu.dat');
      if (vsc) {
        const mf = manifesto(vsc);
        if (mf) {
          r.manifestoOk = crypto.createHash('sha512').update(mf.conteudo).digest().equals(mf.hashAssinado) ? 1 : 0;
          let ok = 1, conf = 0;
          for (const [k, buf] of [['bu.dat', bu], ['rdv.dat', rdv], ['imgbu.dat', img], ['log.jez', null]]) {
            const h = mf.lista.get(`${pref}-${k}`); if (!h) continue;
            const dado = k === 'log.jez' ? ler('log.jez') : buf;
            if (!dado) { if (k === 'imgbu.dat') r._hashImg = h; continue; } // imagem chega depois: guarda só o hash esperado
            conf++; if (!crypto.createHash('sha512').update(dado).digest().equals(h)) ok = 0;
          }
          r.hashOk = conf ? ok : null; r.hashConf = conf;
          try { const cc = verificarCadeia(mf.cert); r.cadeiaOk = cc.ok; r.ac = cc.ac; } catch (e) { r.cadeiaOk = null; r.ac = 'erro: ' + String(e.message).slice(0, 40); }
          try { const v = verificarAssinatura(mf); r.assinaturaOk = v.ok; r.esquema = v.esquema; } catch (e) { r.assinaturaOk = null; r.esquema = 'erro: ' + String(e.message).slice(0, 40); }
        }
      }
      const lj = ler('log.jez');
      if (lj) {
        const textos = [];
        const coletar = (z, prof) => { for (const [k, v] of Object.entries(z)) { if (k.endsWith('.dat')) textos.push(v.toString('latin1')); else if (k.endsWith('.jez') && prof < 3) { try { coletar(zipMem(v), prof + 1); } catch (e) {} } } };
        coletar(zipMem(lj), 0);
        if (textos.length) { const lg = lerLog(textos); lg.porHora.forEach((v, i) => (horas.votos[i] += v)); lg.mesPorHora.forEach((v, i) => (horas.mes[i] += v)); delete lg.porHora; delete lg.mesPorHora; Object.assign(r, lg); }
      }
    } catch (e) { r.erroLeitura = String(e.message).slice(0, 80); }
    return r;
  }
}

module.exports = { manifesto, verificarAssinatura, verificarCadeia, lerImgBu, lerLog, rdvPresidente };
if (require.main === module) (async () => {
  for (const uf of UFS) {
    if (fs.existsSync(path.join(OUT, `${uf}.json`))) { console.log(`[${uf}] já processado`); continue; }
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      try { await processarUF(uf); break; } catch (e) { console.log(`[${uf}] falhou (tentativa ${tentativa}): ${e.message}`); }
    }
  }
  console.log('FIM');
})();
