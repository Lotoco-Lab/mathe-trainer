// Erkennung typischer Fehlerarten aus einer falschen Antwort (rein, ohne DOM).
export const ERROR_LABELS = {
  rechenzeichen: 'Rechenzeichen verwechselt (z. B. plus statt minus)',
  nachbaraufgabe: 'Nachbaraufgabe im Einmaleins (ein Faktor um 1 daneben)',
  hunderterfehler: 'Hunderter um 1 daneben',
  zehnerfehler: 'Zehner um 1 daneben (Übertrag/Entbündeln)',
  einerfehler: 'Um 1 daneben (Einer)',
  ziffernvertauscht: 'Ziffern vertauscht',
  sonstiges: 'Sonstiger Fehler',
};

export function parseQuestion(q) {
  const m = /^(\d+) ([+−·:]) (\d+)$/.exec(q);
  if (!m) return null;
  const op = { '+': 'add', '−': 'sub', '·': 'mul', ':': 'div' }[m[2]];
  return { op, a: Number(m[1]), b: Number(m[3]) };
}

const sameDigits = (x, y) => String(x).split('').sort().join('') === String(y).split('').sort().join('');

export function classifyError({ op, a, b }, answer, given) {
  if (given === answer) return null;
  const other = { add: [a - b], sub: [a + b], mul: [a + b], div: [a - b, a * b] }[op];
  if (other.includes(given)) return 'rechenzeichen';
  if (op === 'mul' && [a * (b + 1), a * (b - 1), (a + 1) * b, (a - 1) * b].includes(given)) return 'nachbaraufgabe';
  const d = Math.abs(given - answer);
  if (d === 100) return 'hunderterfehler';
  if (d === 10) return 'zehnerfehler';
  if (d === 1) return 'einerfehler';
  if (String(given).length === String(answer).length && sameDigits(given, answer)) return 'ziffernvertauscht';
  return 'sonstiges';
}
