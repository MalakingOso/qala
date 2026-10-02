#!/usr/bin/env bash
# Encode the intro render (RGBA PNG frames from build_intro.py) into the files the page ships.
#
#   assets/3d/encode_intro.sh [FRAMES_DIR] [OUT_DIR]
#
# FRAMES_DIR defaults to /tmp/qala-intro/out/frames, OUT_DIR to apps/web/src/shared/intro. The one
# transparent render is composited on each theme's real --bg (theme/tokens.css), then encoded as
#   intro-{light,dark}.mp4    H.264, yuv420p, +faststart, tagged BT.709 tv-range
#   intro-{light,dark}.webm   AV1
#   intro-{light,dark}.webp   poster: the last (settled) frame, straight RGB and lossless so it matches the page exactly
#   cal-{light,dark}.{mp4,webm}  a 64 x 64 clip of the bare page colour through the same encode: the page reads it
#                             back to learn how far the browser's decoder lands from --bg, and cancels that
# They live under src/ so Vite hashes them; server/static.ts serves everything but index.html as immutable.
#
# Tunables: CRF_H264 (default 18), CRF_AV1 (30), PRESET_H264 (slow), PRESET_AV1 (4). 22/34 showed blocky steps in the
# airborne plate's soft floor shadow on the light page; 18/30 keep every file under 1 MB. Raise a CRF if the dust
# bloats a file past ~1 MB.

set -euo pipefail

FRAMES="${1:-/tmp/qala-intro/out/frames}"
OUT="${2:-$(cd "$(dirname "$0")/../.." && pwd)/apps/web/src/shared/intro}"
CRF_H264="${CRF_H264:-18}"
CRF_AV1="${CRF_AV1:-30}"
PRESET_H264="${PRESET_H264:-slow}"
PRESET_AV1="${PRESET_AV1:-4}"
FPS=30

# theme -> --bg
declare -A BG=([light]="f5f5f7" [dark]="0b1020")

[[ -f "$FRAMES/f_0000.png" ]] || { echo "no frames in $FRAMES (expected f_0000.png ...)" >&2; exit 1; }
SIZE="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$FRAMES/f_0000.png")"
COUNT="$(ls "$FRAMES"/f_*.png | wc -l)"
LAST="$(ls "$FRAMES"/f_*.png | sort | tail -1)"
mkdir -p "$OUT"

# The frames are straight-alpha sRGB. Overlay in RGB, then convert with the BT.709 matrix, limited range,
# explicitly: format=yuv420p alone would use BT.601 and the tag below would then shift every colour.
filter() {
  echo "[1:v]format=rgba[fg];[0:v][fg]overlay=format=gbrp:shortest=1,scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p"
}
tags=(-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv)

for theme in light dark; do
  bg="${BG[$theme]}"
  # ",format=gbrp" inside the lavfi graph makes the colour source draw in RGB: left to itself it goes through
  # YUV and lands two levels off in green (0x0b1020 came out 0b0e20)
  inputs=(-f lavfi -i "color=c=0x${bg}:s=${SIZE}:r=${FPS},format=gbrp" -framerate "$FPS" -i "$FRAMES/f_%04d.png")

  ffmpeg -v error -y "${inputs[@]}" -filter_complex "$(filter)" -shortest \
    -frames:v "$COUNT" -c:v libx264 -preset "$PRESET_H264" -crf "$CRF_H264" -profile:v high -pix_fmt yuv420p -g 60 \
    "${tags[@]}" -movflags +faststart -an "$OUT/intro-$theme.mp4"

  ffmpeg -v error -y "${inputs[@]}" -filter_complex "$(filter)" -shortest \
    -frames:v "$COUNT" -c:v libsvtav1 -preset "$PRESET_AV1" -crf "$CRF_AV1" -g 60 -pix_fmt yuv420p \
    "${tags[@]}" -an "$OUT/intro-$theme.webm"

  # calibration clips: the flat page colour through the same chain and codecs (8-bit limited-range YUV cannot hold
  # every colour, and each browser rounds its own way), so IntroHero can measure the decoder's offset
  ffmpeg -v error -y -f lavfi -i "color=c=0x${bg}:s=64x64:r=${FPS},format=gbrp" -frames:v 2 \
    -vf "scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p" \
    -c:v libx264 -preset "$PRESET_H264" -crf "$CRF_H264" -profile:v high -pix_fmt yuv420p "${tags[@]}" -movflags +faststart -an \
    "$OUT/cal-$theme.mp4"
  ffmpeg -v error -y -f lavfi -i "color=c=0x${bg}:s=64x64:r=${FPS},format=gbrp" -frames:v 2 \
    -vf "scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p" \
    -c:v libsvtav1 -preset "$PRESET_AV1" -crf "$CRF_AV1" -pix_fmt yuv420p "${tags[@]}" -an "$OUT/cal-$theme.webm"

  # poster: composite in RGB only, no YUV round trip
  ffmpeg -v error -y -f lavfi -i "color=c=0x${bg}:s=${SIZE},format=rgb24" -i "$LAST" \
    -filter_complex "[1:v]format=rgba[fg];[0:v][fg]overlay=format=rgb,format=rgb24" \
    -frames:v 1 -c:v libwebp -lossless 1 -compression_level 6 "$OUT/intro-$theme.webp"
done

ls -l "$OUT"
for f in "$OUT"/intro-*.mp4 "$OUT"/intro-*.webm; do
  echo "$(basename "$f"): $(ffprobe -v error -select_streams v:0 \
    -show_entries stream=codec_name,profile,level,width,height,color_space,color_range,pix_fmt -of csv=p=0 "$f")"
done
