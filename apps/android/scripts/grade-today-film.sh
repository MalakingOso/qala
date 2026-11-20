#!/usr/bin/env bash
# Crops landscape footage to the phone's 9:16, bakes in Today's Super 8 grade, and writes the loop and its poster.
#
#   apps/android/scripts/grade-today-film.sh [input.mp4] [crop-x]
#
# Swapping the footage is this one command: it overwrites res/raw/today_film.mp4 and res/drawable-nodpi/today_poster.webp.
# The grade is the prototype's CSS (Drawer.dc.html), applied once here instead of live on the phone:
#   filter: sepia(.24) saturate(.9) contrast(.94) brightness(1.04) hue-rotate(-6deg)
#   lift:   #33241a screened over it at 50% (lifts the blacks to a warm brown)
# Grain, flicker, vignette and weave stay as Compose overlays (today/TodayFilm.kt), because they move.
#
# The footage is a take, not a loop: its last frame is nowhere near its first. So the last second is dissolved into the first
# second and the loop starts one second in. The output ends on source frame 0..1 s and begins at 1 s, which is one continuous shot.
set -euo pipefail

IN="${1:-$HOME/video.mp4}"
CROP_X="${2:-240}"          # left edge of the 405 px wide window in the 1280 px source; look at a frame and move it to taste
W=404                        # libx264 with yuv420p wants even sizes; 404 x 720 is 9:16 to within a pixel
H=720
RES="$(cd "$(dirname "$0")/../app/src/main/res" && pwd)"

# sepia(.24) then saturate(.9), as one matrix (CSS filter functions work in sRGB, so this is the same space as the lut below).
SEPIA_SAT="rr=0.7935:rg=0.2371:rb=0.0504:gr=0.1000:gg=0.9031:gb=0.0458:br=0.0834:bg=0.1863:bb=0.7218"
# hue-rotate(-6deg)
HUE="rr=1.0180:rg=0.0787:rb=-0.0966:gr=-0.0138:gg=0.9838:gb=0.0300:br=0.0834:bg=-0.0708:bb=0.9874"
# contrast(.94) then brightness(1.04), per channel
CB="((val/maxval-0.5)*0.94+0.5)*1.04"
# screen blend of #33241a at 50%: y + 0.5 * s * (1 - y), per channel, s = (0.200, 0.141, 0.102)
GRADE="scale=${W}:${H}:flags=lanczos,format=gbrp,colorchannelmixer=${SEPIA_SAT},lutrgb=r='clip(${CB},0,1)*maxval':g='clip(${CB},0,1)*maxval':b='clip(${CB},0,1)*maxval',colorchannelmixer=${HUE},lutrgb=r='val+0.100*(maxval-val)':g='val+0.0705*(maxval-val)':b='val+0.051*(maxval-val)'"
CROP="crop=405:720:${CROP_X}:0"
FADE=1                       # seconds of dissolve at the seam
LEN="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")"
TAIL="$(awk -v l="$LEN" -v f="$FADE" 'BEGIN { printf "%.3f", l - f }')"
GRAPH="[0:v]${CROP},split=3[m][t][h];\
[m]trim=start=${FADE}:end=${TAIL},setpts=PTS-STARTPTS[main];\
[t]trim=start=${TAIL},setpts=PTS-STARTPTS[ta];\
[h]trim=end=${FADE},setpts=PTS-STARTPTS[hb];\
[ta][hb]xfade=transition=fade:duration=${FADE}:offset=0[xf];\
[main][xf]concat=n=2:v=1[cat];\
[cat]${GRADE},format=yuv420p[out]"

mkdir -p "$RES/raw" "$RES/drawable-nodpi"

# No audio, bt709, faststart. The poster is the first frame; it is what shows before the player has a frame and under reduced motion.
ffmpeg -v error -y -i "$IN" -an \
  -filter_complex "${GRAPH}" -map "[out]" -r 25 \
  -c:v libx264 -preset slow -crf 25 -maxrate 1400k -bufsize 2800k -profile:v high -pix_fmt yuv420p \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -movflags +faststart "$RES/raw/today_film.mp4"

ffmpeg -v error -y -i "$IN" -filter_complex "${GRAPH}" -map "[out]" -frames:v 1 -c:v libwebp -quality 82 "$RES/drawable-nodpi/today_poster.webp"

ls -l "$RES/raw/today_film.mp4" "$RES/drawable-nodpi/today_poster.webp"
