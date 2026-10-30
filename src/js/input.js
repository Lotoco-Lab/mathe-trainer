// Eingabelogik des Tastenblocks (rein, ohne DOM).

export const MAX_DIGITS = 4;

export function pressDigit(value, digit) {
  if (value.length >= MAX_DIGITS) return value;
  if (value === '0') return String(digit); // keine führenden Nullen
  return value + digit;
}

export const backspace = (value) => value.slice(0, -1);

export const toNumber = (value) => (value === '' ? null : Number(value));
