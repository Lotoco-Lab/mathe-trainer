#!/usr/bin/env python3
"""Erzeugt die App-Icons (reines Python, keine Abhängigkeiten). Einmalig ausführen, Ergebnis ist eingecheckt."""
import struct, zlib, pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "src" / "icons"
BG, WHITE, BLUE, YELLOW = (28, 111, 209), (255, 255, 255), (28, 111, 209), (255, 212, 59)


def color_at(x, y):  # x, y in 0..1
    r = ((x - 0.5) ** 2 + (y - 0.54) ** 2) ** 0.5
    c = BG
    if r < 0.34:
        c = WHITE
        if (abs(x - 0.5) < 0.05 and abs(y - 0.54) < 0.21) or (abs(y - 0.54) < 0.05 and abs(x - 0.5) < 0.21):
            c = BLUE
    if ((x - 0.74) ** 2 + (y - 0.22) ** 2) ** 0.5 < 0.1:
        c = YELLOW
    return c


def png(size, path, ss=3):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    c = color_at((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size)
                    for i in range(3):
                        acc[i] += c[i]
            row += bytes(a // (ss * ss) for a in acc)
        rows.append(bytes(row))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)) \
        + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b"")
    path.write_bytes(data)


OUT.mkdir(parents=True, exist_ok=True)
for name, size in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)]:
    png(size, OUT / name)
    print("geschrieben:", OUT / name)
