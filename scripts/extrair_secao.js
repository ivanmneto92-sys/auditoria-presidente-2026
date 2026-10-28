// Extrai os arquivos de uma única seção do zip de urnas do TSE sem baixar o zip inteiro (requisições parciais).
// Uso: node extrair_secao.js <UF> <cod_municipio> <zona> <secao> <pasta_destino>
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const [uf, mun, zona, secao, DEST] = process.argv.slice(2);
const URL = `https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2026/arqurnatot/bu_imgbu_logjez_rdv_vscmr_2026_2t_${uf}.zip`;
const faixa = (a, b) => execFileSync('curl', ['-s', '-f', '-r', `${a}-${b}`, URL], { maxBuffer: 1 << 30 });
const tam = +/content-length:\s*(\d+)/i.exec(execFileSync('curl', ['-sI', URL]).toString())[1];
const tail = faixa(tam - 70000, tam - 1);
const e = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
let cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
const loc = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]));
if (loc >= 0) { const z = Number(tail.readBigUInt64LE(loc + 8)); const r = faixa(z, z + 55); cdSize = Number(r.readBigUInt64LE(40)); cdOff = Number(r.readBigUInt64LE(48)); }
const cd = faixa(cdOff, cdOff + cdSize - 1);
const pref = `o03221${uf.toLowerCase()}${String(mun).padStart(5, '0')}${String(zona).padStart(4, '0')}${String(secao).padStart(4, '0')}`;
fs.mkdirSync(DEST, { recursive: true });
for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50;) {
  const method = cd.readUInt16LE(p + 10); let csz = cd.readUInt32LE(p + 20); const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
  let off = cd.readUInt32LE(p + 42); const name = cd.toString('latin1', p + 46, p + 46 + nl);
  let x = p + 46 + nl; const xe = x + xl;
  while (x < xe) { const id = cd.readUInt16LE(x), l = cd.readUInt16LE(x + 2); let q = x + 4; if (id === 1) { if (cd.readUInt32LE(p + 24) === 0xffffffff) q += 8; if (csz === 0xffffffff) { csz = Number(cd.readBigUInt64LE(q)); q += 8; } if (off === 0xffffffff) off = Number(cd.readBigUInt64LE(q)); } x += 4 + l; }
  if (name.startsWith(pref)) {
    const lh = faixa(off, off + 29); const ini = off + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
    const raw = faixa(ini, ini + csz - 1); fs.writeFileSync(path.join(DEST, name), method === 8 ? zlib.inflateRawSync(raw) : raw);
    console.log('extraído', name);
  }
  p = xe + cl;
}
