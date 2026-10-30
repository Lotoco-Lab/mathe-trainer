import { runAll } from './harness.js';
import './unit.js';
import './e2e.js';

const out = document.getElementById('out');
let results;
try {
  results = await runAll();
} catch (e) {
  results = [{ name: 'Testlauf', ok: false, error: String(e) }];
}
out.textContent = results.map((r) => `${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.ok ? '' : '\n' + r.error}`).join('\n');
await fetch('/__result', { method: 'POST', body: JSON.stringify(results) });
