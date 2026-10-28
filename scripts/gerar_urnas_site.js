// Gera, para o site, a auditoria de cada urna ("Confira a sua urna"): um arquivo por estado e por turno.
// Uso: node gerar_urnas_site.js <pasta_urnaout> <turno 1|2> <pasta_saida>
const fs = require('fs');
const path = require('path');
const [UO, TURNO, SAIDA] = process.argv.slice(2);
const DEST = path.join(SAIDA, TURNO);
fs.mkdirSync(DEST, { recursive: true });

// flags: 1 assinatura válida · 2 todos os hashes conferem · 4 certificado emitido pelo TSE · 8 recontagem (RDV) = boletim
//        16 urna de contingência · 32 esquema ECDSA (senão Ed521)
// ac: 2 = AC UE2022, 0 = AC UE2020, 1 = AC URNA · horários em minutos do dia, no fuso local da urna
const CAMPOS = ['mun', 'zona', 'secao', 'flags', 'ac', 'hashConf', 'L', 'F', 'comp', 'bio', 'biog', 'semBio', 'mesHab', 'abert', 'fech', 'primeiro', 'ultimo', 'pos17', 'fuso'];
const min = (hhmm) => (hhmm ? +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5) : null);
const AC = { 'AC UE2022': 2, 'AC UE2020': 0, 'AC URNA': 1 };
const compacta = (r) => {
  const flags = (r.assinaturaOk === 1 ? 1 : 0) | (r.hashOk === 1 ? 2 : 0) | (r.cadeiaOk === 1 ? 4 : 0) |
    (r.rdvTotal != null && r.rdvL === r.L && r.rdvF === r.F && r.rdvTotal === r.comp ? 8 : 0) | (r.contingencia ? 16 : 0) | (r.esquema === 'ECDSA' ? 32 : 0);
  return [r.mun, r.zona, r.secao, flags, AC[r.ac] ?? null, r.hashConf, r.L, r.F, r.comp, r.bio, r.biog, r.semBio, r.mesHab,
    min(r.abert), min(r.fech), r.primeiro != null ? Math.round(r.primeiro / 60) : null, r.ultimo != null ? Math.round(r.ultimo / 60) : null, r.pos17, r.fusoOffset];
};
let total = 0, n = 0;
for (const f of fs.readdirSync(UO).filter((x) => x.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(path.join(UO, f), 'utf8'));
  const linhas = d.secoes.map((row) => compacta(Object.fromEntries(d.campos.map((c, i) => [c, row[i]]))));
  const arq = path.join(DEST, f); fs.writeFileSync(arq, JSON.stringify({ campos: CAMPOS, secoes: linhas }));
  total += fs.statSync(arq).size; n += linhas.length;
}
console.log(`turno ${TURNO}: ${n} urnas, ${(total / 1e6).toFixed(1)} MB em ${DEST}`);
