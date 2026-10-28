// Monta a pasta do repositório público: site (para o Vercel), scripts, certificados e dados intermediários compactados.
// Uso: node montar_repositorio.js <pasta_projeto> <pasta_tse26> <pasta_destino>
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const [PROJ, T, DEST] = process.argv.slice(2);

const copia = (de, para) => { fs.mkdirSync(path.dirname(para), { recursive: true }); fs.copyFileSync(de, para); };
const gz = (de, para) => { fs.mkdirSync(path.dirname(para), { recursive: true }); fs.writeFileSync(para, zlib.gzipSync(fs.readFileSync(de), { level: 9 })); };
const copiaPasta = (de, para, filtro = () => true) => {
  for (const f of fs.readdirSync(de)) {
    const a = path.join(de, f), b = path.join(para, f);
    if (fs.statSync(a).isDirectory()) copiaPasta(a, b, filtro); else if (filtro(f)) copia(a, b);
  }
};

fs.rmSync(path.join(DEST, 'site'), { recursive: true, force: true });
fs.rmSync(path.join(DEST, 'dados'), { recursive: true, force: true });

// site estático: a página recebe o esqueleto <!doctype html> que o artifact adiciona automaticamente
// SITE_URL: endereço público do site (as redes sociais exigem o endereço completo da imagem de prévia)
const SITE = (process.env.SITE_URL || 'https://auditoria-presidente-2026.vercel.app').replace(/\/$/, '');
const html = fs.readFileSync(path.join(PROJ, 'app', 'index.html'), 'utf8');
const desc = 'Resultado do 2º turno presidencial de 2026 por município, replay da apuração e auditoria independente das 499 mil urnas com dados públicos do TSE.';
const meta = [
  '<meta charset="utf-8">', '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">', `<meta name="description" content="${desc}">`,
  '<meta property="og:type" content="website">', '<meta property="og:locale" content="pt_BR">', '<meta property="og:title" content="Apuração 2026 · Lula 51,79% × Flávio 48,21%">',
  `<meta property="og:description" content="${desc}">`, `<meta property="og:url" content="${SITE}/">`, `<meta property="og:image" content="${SITE}/og.png">`,
  '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">', '<meta property="og:image:alt" content="Lula 51,79% × Flávio 48,21%; 499.178 urnas auditadas">',
  '<meta name="twitter:card" content="summary_large_image">', `<meta name="twitter:image" content="${SITE}/og.png">`,
].join('\n');
fs.mkdirSync(path.join(DEST, 'site'), { recursive: true });
fs.writeFileSync(path.join(DEST, 'site', 'index.html'), `<!doctype html>\n<html lang="pt-BR">\n<head>\n${meta}\n</head>\n<body style="margin:0">\n${html}\n</body>\n</html>\n`);
copiaPasta(path.join(PROJ, 'app', 'data'), path.join(DEST, 'site', 'data'));
copia(path.join(PROJ, 'app', 'og.png'), path.join(DEST, 'site', 'og.png'));

// scripts e certificados
for (const f of ['processar_tse.js', 'gerar_app.js', 'analises_estatisticas.js', 'modelo_esperado.js', 'auditar_urnas.js', 'ed521.js', 'consolidar_urnas.js', 'gerar_zerados.js', 'gerar_especiais.js', 'gerar_anomalias_app.js', 'gerar_alegacoes.js', 'gerar_urnas_site.js', 'extrair_secao.js', 'montar_repositorio.js'])
  copia(path.join(PROJ, f), path.join(DEST, 'scripts', f));
copiaPasta(path.join(PROJ, 'certificados'), path.join(DEST, 'certificados'));
copia(path.join(PROJ, 'README.md'), path.join(DEST, 'README.md'));

// dados intermediários (compactados)
gz(path.join(T, 'out', 'secoes_2turno.csv'), path.join(DEST, 'dados', 'secoes_2turno.csv.gz'));
for (const f of ['municipios.csv', 'zonas.csv', 'ufs.csv', 'anomalias.csv']) copia(path.join(T, 'out', f), path.join(DEST, 'dados', 'resultados', f));
for (const f of fs.readdirSync(path.join(T, 'an'))) gz(path.join(T, 'an', f), path.join(DEST, 'dados', 'analises', f + '.gz'));
for (const [pasta, nome] of [['urnaout', 'urnas_2turno'], ['urnaout1t', 'urnas_1turno']]) {
  const arqs = fs.existsSync(path.join(T, pasta)) ? fs.readdirSync(path.join(T, pasta)) : [];
  if (arqs.length < 28) { console.log(`${nome}: incompleto (${arqs.length}/28), fica de fora`); continue; } // só publica turno completo
  for (const f of arqs) gz(path.join(T, pasta, f), path.join(DEST, 'dados', nome, f + '.gz'));
}
copia(path.join(T, 'raw', 'mun_tse.csv'), path.join(DEST, 'dados', 'referencia', 'municipios_tse_ibge_corrigido.csv'));

fs.writeFileSync(path.join(DEST, 'vercel.json'), JSON.stringify({
  $schema: 'https://openapi.vercel.sh/vercel.json', buildCommand: null, outputDirectory: 'site', framework: null, cleanUrls: true,
  headers: [{ source: '/data/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }] }],
}, null, 2) + '\n');
fs.writeFileSync(path.join(DEST, '.gitignore'), 'node_modules/\n.vercel/\n.env*\n*.zip\n'); // nunca publicar credenciais locais

let total = 0; const conta = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (f !== '.git') conta(p); } else { const s = fs.statSync(p).size; total += s; if (s > 50e6) console.log('ATENÇÃO, arquivo grande:', p, (s / 1e6).toFixed(1), 'MB'); } } };
conta(DEST); console.log('repositório montado:', (total / 1e6).toFixed(1), 'MB');
