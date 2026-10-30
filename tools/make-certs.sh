#!/bin/bash
# Erzeugt eine eigene, eng begrenzte Test-CA und ein Serverzertifikat für das lokale Netz.
# Alles liegt in certs/ (nicht im Git). Die CA darf nur für lokale Namen/Adressen Zertifikate
# ausstellen (Name Constraints) – sie ist also für fremde Webseiten wertlos.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p certs && cd certs

HOST="$(scutil --get LocalHostName 2>/dev/null || hostname -s).local"
IPS=()
for itf in en0 en1 en2 en3 en4; do
  ip="$(ipconfig getifaddr "$itf" 2>/dev/null || true)"
  [ -n "$ip" ] && IPS+=("$ip")
done

if [ ! -f ca.key ] || [ ! -f ca.crt ]; then
  cat > ca.cnf <<CNF
[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = Mathe-Trainer Test-CA (nur lokal)
[v3]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
nameConstraints = critical, permitted;DNS:$HOST, permitted;DNS:localhost, permitted;IP:127.0.0.1/255.255.255.255, permitted;IP:192.168.0.0/255.255.0.0, permitted;IP:10.0.0.0/255.0.0.0, permitted;IP:172.16.0.0/255.240.0.0
CNF
  openssl ecparam -name prime256v1 -genkey -noout -out ca.key
  openssl req -x509 -new -key ca.key -sha256 -days 825 -config ca.cnf -out ca.crt
  echo "Neue Test-CA erzeugt (certs/ca.crt)."
fi

ALT="DNS.1 = $HOST
DNS.2 = localhost
IP.1 = 127.0.0.1"
n=2
for ip in "${IPS[@]:-}"; do [ -n "$ip" ] && { ALT="$ALT
IP.$n = $ip"; n=$((n+1)); }; done

cat > server.cnf <<CNF
[req]
distinguished_name = dn
prompt = no
[dn]
CN = $HOST
[v3]
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = @alt
[alt]
$ALT
CNF
openssl ecparam -name prime256v1 -genkey -noout -out server.key
openssl req -new -key server.key -config server.cnf -out server.csr
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -sha256 -days 397 \
  -extfile server.cnf -extensions v3 -out server.crt 2>/dev/null
rm -f server.csr
chmod 600 ca.key server.key

openssl verify -CAfile ca.crt server.crt
echo "Server-Zertifikat gültig für: $HOST, localhost, 127.0.0.1 ${IPS[*]:-}"
