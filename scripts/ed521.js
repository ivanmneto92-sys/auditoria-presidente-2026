// Verificação de assinaturas Ed521 (PureEdDSA sobre a curva E-521), conforme ICP-Brasil DOC-ICP-01.01
// (Instrução Normativa ITI nº 15/2018) e RFC 8032: H(x) = SHAKE256(dom5(0, contexto) || x, 132).
const crypto = require('crypto');

const p = (1n << 521n) - 1n;
const d = -376014n;
const L = BigInt('1716199415032652428745475199770348304317358825035826352348615864796385795849413675475876651663657849636693659065234142604319282948702542317993421293670108523');
const Bx = BigInt('1571054894184995387535939749894317568645297350402905821437625181152304994381188529632591196067604100772673927915114267193389905003276673749012051148356041324');
const By = 12n;

// redução rápida módulo 2^521 - 1 (primo de Mersenne)
const md = (a) => { a %= p; if (a < 0n) a += p; return a; };
const mr = (a) => { while (a >> 521n) a = (a & p) + (a >> 521n); return a === p ? 0n : a; };
const mul = (a, b) => mr(a * b);
const pow = (b, e) => { let r = 1n; b = md(b); while (e > 0n) { if (e & 1n) r = mul(r, b); b = mul(b, b); e >>= 1n; } return r; };
const inv = (a) => pow(a, p - 2n);
const D = md(d);

// coordenadas projetivas (X:Y:Z) na curva de Edwards x² + y² = 1 + d·x²·y² (fórmula completa add-2007-bl, a = 1)
function add(P, Q) {
  const A = mul(P[2], Q[2]), B = mul(A, A), C = mul(P[0], Q[0]), Dd = mul(P[1], Q[1]);
  const E = mul(D, mul(C, Dd)), F = md(B - E), G = mr(B + E);
  const X = mul(mul(A, F), md(mul(mr(P[0] + P[1]), mr(Q[0] + Q[1])) - C - Dd));
  const Y = mul(mul(A, G), md(Dd - C));
  return [X, Y, mul(F, G)];
}
const ZERO = [0n, 1n, 1n];
function smul(k, P) { let R = ZERO, Q = P; while (k > 0n) { if (k & 1n) R = add(R, Q); Q = add(Q, Q); k >>= 1n; } return R; }
const igual = (P, Q) => md(P[0] * Q[2] - Q[0] * P[2]) === 0n && md(P[1] * Q[2] - Q[1] * P[2]) === 0n;
const naCurva = (x, y) => md(x * x + y * y - 1n - D * md(x * x) % p * md(y * y)) === 0n;

const leLE = (b) => { let r = 0n; for (let i = b.length - 1; i >= 0; i--) r = (r << 8n) | BigInt(b[i]); return r; };
// decodificação de ponto: 66 bytes, y em little-endian (527 bits) e o bit mais alto é o sinal de x
function decodifica(b) {
  if (b.length !== 66) return null;
  const c = Buffer.from(b); const sinal = c[65] >> 7; c[65] &= 0x7f;
  const y = leLE(c); if (y >= p) return null;
  const u = md(y * y - 1n), v = md(D * mul(y, y) - 1n);
  const x2 = mul(u, inv(v)); let x = pow(x2, (p + 1n) >> 2n); // p ≡ 3 (mod 4)
  if (mul(x, x) !== x2) return null;
  if (x === 0n && sinal) return null;
  if (Number(x & 1n) !== sinal) x = p - x;
  return [x, y, 1n];
}
const B = [Bx, By, 1n];
const dom5 = (ph = 0, ctx = Buffer.alloc(0)) => Buffer.concat([Buffer.from('SigEd521', 'ascii'), Buffer.from([ph, ctx.length]), ctx]);

function verificar(chave, msg, assinatura, ph = 0) {
  if (assinatura.length !== 132) return false;
  const A = decodifica(chave), R = decodifica(assinatura.subarray(0, 66)); if (!A || !R) return false;
  const S = leLE(assinatura.subarray(66)); if (S >= L) return false;
  const h = crypto.createHash('shake256', { outputLength: 132 }).update(dom5(ph)).update(assinatura.subarray(0, 66)).update(chave).update(msg).digest();
  const k = leLE(h) % L;
  // [4][S]B = [4]R + [4][k]A
  const esq = smul(4n * S, B), dir = smul(4n, add(R, smul(k, A)));
  return igual(esq, dir);
}
function autoteste() {
  const okCurva = naCurva(Bx, By);
  const ordem = igual(smul(L, B), ZERO);
  return { pontoBaseNaCurva: okCurva, ordemCorreta: ordem };
}
module.exports = { verificar, autoteste, decodifica };
