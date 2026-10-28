# Auditoria independente · Presidente 2026

Resultado do 2º turno presidencial de 2026 por município, replay da apuração e auditoria das urnas eletrônicas, feitos só com dados públicos do TSE e do IBGE.

**Site:** em publicação

> Uma anomalia, neste projeto, é um ponto para conferir no boletim de urna, não uma prova de fraude. Sempre que possível, cada verificação é comparada com o que seria esperado por acaso.

## Resultado da auditoria

A auditoria completa dos dois turnos está sendo processada; os números finais entram aqui quando terminar.

## O que tem aqui

| Pasta | Conteúdo |
|---|---|
| `site/` | O app publicado (HTML estático + dados em JSON). É o que o Vercel serve. |
| `scripts/` | Todos os scripts (Node.js, sem dependências externas). |
| `certificados/` | Certificados públicos das autoridades certificadoras intermediárias do TSE (AC URNA, AC UE2020, AC UE2022). |
| `dados/secoes_2turno.csv.gz` | As 499 mil seções: votos nos dois turnos, aptos, comparecimento, local, coordenadas, modelo da urna e horário do boletim. |
| `dados/urnas_2turno/`, `dados/urnas_1turno/` | Resultado da auditoria de cada urna, por estado. |
| `dados/analises/` | Saída das análises estatísticas, do modelo de voto esperado, do Censo, dos presídios e dos zerados. |
| `dados/resultados/` | Totais por município, zona e estado, e a lista das verificações básicas. |
| `dados/referencia/` | Tabela de municípios TSE → IBGE corrigida (a tabela pública usada como base tinha 7 municípios trocados). |

## Como reproduzir

Requisitos: Node.js 20 ou mais recente, `curl` e `unzip`, cerca de 30 GB livres.

1. Baixe do [portal de dados abertos do TSE](https://dadosabertos.tse.jus.br/) os arquivos `votacao_secao_2026_BR.zip`, `detalhe_votacao_secao_2026.zip` e `eleitorado_local_votacao_2026.zip` para uma pasta `raw/`, além das malhas do IBGE e da tabela de municípios (veja o começo de cada script).
2. `node scripts/processar_tse.js raw out`: consolida as seções e gera as verificações básicas.
3. `node scripts/analises_estatisticas.js raw out an/estatisticas.json`: votos sem origem, impressão digital, modelo de urna, urnas tardias, último dígito e vizinhança.
4. `node scripts/modelo_esperado.js raw out an`: perfil do eleitorado, modelo de voto esperado e comparação com o Censo 2022.
5. `CERTS=certificados TURNO=2 node scripts/auditar_urnas.js x urnaout [UF ...]` (e o mesmo com `TURNO=1`): baixa e audita os arquivos de cada urna em fluxo, sem gravar os zips. Leva cerca de uma hora por turno com quatro processos em paralelo, um grupo de estados em cada.
6. `TURNO=2 node scripts/consolidar_urnas.js urnaout out an` (e `TURNO=1` com a pasta do 1º turno).
7. `node scripts/gerar_zerados.js`, `gerar_especiais.js`, `gerar_app.js` e `gerar_anomalias_app.js` geram os dados do site.

Para conferir uma única seção sem baixar o zip do estado: `node scripts/extrair_secao.js <UF> <cod_municipio_TSE> <zona> <secao> <pasta>`.

## O que foi verificado em cada urna

- Hash SHA-512 de cada arquivo (boletim, registro digital do voto, imagem do boletim e log) contra o manifesto da urna.
- Assinatura do manifesto: **Ed521** (urnas 2020/2022, curva E-521 da [IN ITI 15/2018](https://repositorio.iti.gov.br/instrucoes-normativas/IN2018_15_DOC-ICP-01.01.htm), implementada em `scripts/ed521.js`) ou **ECDSA P-521** (urnas 2013/2015). A urna assina SHA-512 do hash do manifesto.
- Certificado da urna emitido por uma das autoridades intermediárias do TSE.
- Recontagem voto a voto pelo registro digital do voto, comparada com o boletim e com os dados divulgados.
- Log: forma de liberação do eleitor, tempo até o voto, sequências rápidas, votos fora de hora, religamentos e troca por urna de contingência.

## Limitações

- A cadeia de certificados vai até as autoridades intermediárias. Os certificados raiz (AC RAIZ UE e AC RAIZ UE v2) não estão disponíveis publicamente.
- A AC URNA, que emitiu os certificados das urnas 2013/2015, tem validade até 18/07/2026, antes da eleição. As assinaturas conferem, mas pela regra estrita do X.509 essa cadeia estaria expirada.
- A auditoria confirma que os arquivos não foram alterados depois de a urna assiná-los. Ela não prova que o software da urna estava correto antes disso; isso depende dos testes públicos de segurança, da lacração e da votação paralela do TSE.
- Não há base pública de fotos de boletins impressos para comparar.
- 29 seções do exterior votaram em cédula de papel e não têm arquivos de urna.
- Os limites que definem cada anomalia foram escolhidos pelo autor e estão nos scripts; não são um padrão oficial.

## Créditos e referências

- Dados: Tribunal Superior Eleitoral (TSE) e IBGE.
- Certificados das autoridades intermediárias conferidos com a constante oficial do pacote de documentação dos arquivos de urna do TSE e com a cópia do projeto [DataUrnas-BR](https://github.com/alissonlinneker/DataUrnas-BR), que faz uma auditoria semelhante e independente.
- Verificador de referência: [VAR-UE](https://github.com/epicleet/var-ue).

Os dados são públicos. O código deste repositório pode ser usado e modificado livremente, com citação da fonte.
