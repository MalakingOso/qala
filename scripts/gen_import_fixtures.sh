#!/usr/bin/env bash
# Regenerate the small fixtures under testdata/import/ that the transcribe and
# PDF import tests use. They are committed, so this only needs to run when a
# fixture has to change. Needs ffmpeg, groff, ps2pdf (ghostscript) and python3
# (standard library only).
#
#   tone-8k.wav   0.6 s sine tone, 8 kHz mono WAV: conversion to 16 kHz is exercised.
#   tone.webm     the same tone as Opus in WebM, what Chrome's MediaRecorder sends.
#   workout.pdf   a born-digital two-week program with a text layer.
#   scan.pdf      one page that is only a gray image, no text layer.
set -euo pipefail

out="$(cd "$(dirname "$0")/.." && pwd)/testdata/import"
mkdir -p "$out"

ffmpeg -nostdin -y -loglevel error \
  -f lavfi -i "sine=frequency=440:duration=0.6:sample_rate=8000" \
  -ac 1 -c:a pcm_s16le "$out/tone-8k.wav"
ffmpeg -nostdin -y -loglevel error \
  -f lavfi -i "sine=frequency=440:duration=0.6:sample_rate=48000" \
  -ac 1 -c:a libopus -b:a 16k "$out/tone.webm"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/workout.roff" <<'EOF'
.nf
.ft CR
.ps 11
Beginner Strength, 2 weeks

Week 1
Day 1 - Squat day
Squat 3x5 135
Bench Press 3x8 95
Day 2 - Press day
Overhead Press 3x8 65
Pull Up 3x6

Week 2
Day 1 - Squat day
Squat 3x5 140
Bench Press 3x8 100
Day 2 - Press day
Overhead Press 3x8 70
Pull Up 3x7
EOF
groff -Tps "$tmp/workout.roff" > "$tmp/workout.ps"
ps2pdf "$tmp/workout.ps" "$out/workout.pdf"

python3 -I - "$out/scan.pdf" <<'EOF'
import sys

# One 64x64 8-bit gray image drawn full page. No font, no text operators.
w = h = 64
pixels = bytes((x * 4 + y) % 256 for y in range(h) for x in range(w))
content = b"q 400 0 0 400 100 200 cm /Im0 Do Q"
objs = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
    b"/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>",
    b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream",
    b"<< /Type /XObject /Subtype /Image /Width 64 /Height 64 "
    b"/ColorSpace /DeviceGray /BitsPerComponent 8 /Length %d >>\nstream\n" % len(pixels)
    + pixels + b"\nendstream",
]
out = bytearray(b"%PDF-1.4\n")
offsets = []
for i, body in enumerate(objs, start=1):
    offsets.append(len(out))
    out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
xref = len(out)
out += b"xref\n0 %d\n" % (len(objs) + 1)
out += b"0000000000 65535 f \n"
for off in offsets:
    out += b"%010d 00000 n \n" % off
out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
open(sys.argv[1], "wb").write(out)
EOF

ls -l "$out"
