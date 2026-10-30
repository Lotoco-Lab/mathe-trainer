// Minimaler Test-Runner (läuft im Browser, keine Abhängigkeiten).
const queue = [];

export const test = (name, fn) => queue.push({ name, fn });

const fmt = (x) => JSON.stringify(x);
export const assert = {
  ok(cond, msg = 'Bedingung nicht erfüllt') {
    if (!cond) throw new Error(msg);
  },
  eq(actual, expected, msg = '') {
    if (fmt(actual) !== fmt(expected)) throw new Error(`${msg} erwartet ${fmt(expected)}, erhalten ${fmt(actual)}`);
  },
};

export async function runAll() {
  const results = [];
  for (const { name, fn } of queue) {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, error: String((e && e.stack) || e) });
    }
  }
  return results;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(fn, what, timeout = 8000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`Zeitüberschreitung: ${what}`);
    await sleep(50);
  }
}
