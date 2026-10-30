.PHONY: build test serve certs
build:
	python3 tools/build.py
test:
	python3 tools/test.py
certs:
	./tools/make-certs.sh
serve: build
	python3 tools/serve-https.py
