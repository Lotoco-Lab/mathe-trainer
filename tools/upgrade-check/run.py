import http.server, threading, json, subprocess, sys, time, pathlib, shutil, tempfile
# Upgrade-Prüfung: echte V1.0-App (Git-Stand V10_REF) erzeugt Lerndaten, danach wird auf denselben Pfad
# der aktuelle Build (dist/) ausgeliefert – wie bei einem Update auf GitHub Pages. Aufruf: python3 tools/upgrade-check/run.py
V10_REF = '7b674a9'
ROOT = pathlib.Path(__file__).resolve().parents[2]
S = pathlib.Path(tempfile.mkdtemp(prefix='mathe-upgrade-'))
subprocess.run(f'git -C "{ROOT}" archive {V10_REF} src tools | tar -x -C "{S}"', shell=True, check=True)
subprocess.run([sys.executable, str(S/'tools'/'build.py')], check=True, stdout=subprocess.DEVNULL)
subprocess.run([sys.executable, str(ROOT/'tools'/'build.py')], check=True, stdout=subprocess.DEVNULL)
shutil.copy(pathlib.Path(__file__).with_name('driver.html'), S/'drv1.html')
S.joinpath('v10').mkdir(); shutil.move(str(S/'dist'), str(S/'v10'/'dist'))
state = {'app': S/'v10'/'dist', 'res': None}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(s,*a): pass
    def do_POST(s):
        state['res'] = json.loads(s.rfile.read(int(s.headers['Content-Length']))); s.send_response(204); s.end_headers()
    def do_GET(s):
        p = s.path.split('?')[0]
        f = (state['app']/(p[5:] or 'index.html')) if p.startswith('/app/') else (S/p[1:]) if p.startswith('/drv') else None
        if p == '/__switch': state['app']=ROOT/'dist'; s.send_response(204); s.end_headers(); return
        if p == '/app/': f = state['app']/'index.html'
        if not f or not f.is_file(): s.send_response(404); s.end_headers(); return
        d = f.read_bytes(); s.send_response(200)
        s.send_header('Content-Type', {'.js':'text/javascript','.css':'text/css','.html':'text/html','.webmanifest':'application/manifest+json','.png':'image/png'}.get(f.suffix,'application/octet-stream'))
        s.send_header('Cache-Control','no-cache'); s.send_header('Content-Length',str(len(d))); s.end_headers(); s.wfile.write(d)
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8790), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
CH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; prof = tempfile.mkdtemp()
def run(page, app):
    state['app'] = app; state['res'] = None
    p = subprocess.Popen([CH,'--headless=new','--disable-gpu','--no-first-run',f'--user-data-dir={prof}',f'http://localhost:8790/{page}'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    t = time.time()
    while state['res'] is None and time.time()-t < 60: time.sleep(0.3)
    time.sleep(2); p.terminate(); p.wait(); time.sleep(1)
    return state['res']
r = run('drv1.html', S/'v10'/'dist')
r['v10p']=json.loads(r['v10']['progress']); print(json.dumps({k:(json.loads(v) if k in ('progress','backup','meta') and v else v) for k,v in r.items() if k not in ('v10','v10p')}, ensure_ascii=False, indent=1)); print('V1.0-Stand:', json.dumps(r['v10p'], ensure_ascii=False)); print('Fortschritt unverändert:', json.loads(r['progress'])==r['v10p'], '| Sicherung = Original:', json.loads(r['backup'])==r['v10p'])

ok = (json.loads(r['progress']) == r['v10p'] and json.loads(r['backup']) == r['v10p'] and r['secondOpenIsNew'] and not r['firstOpenIsNew']
      and r['caches'] == [c for c in r['caches'] if c.startswith('mathe-')] and len(r['caches']) == 1 and r['mulStars'] == '★★☆')
print('UPGRADE-PRÜFUNG:', 'BESTANDEN' if ok else 'FEHLGESCHLAGEN'); shutil.rmtree(S, ignore_errors=True); sys.exit(0 if ok else 1)
