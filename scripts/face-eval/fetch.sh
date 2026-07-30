#!/usr/bin/env bash
# Fetch the labeled evaluation images (dlib's examples/faces test set).
# Images are downloaded on demand and are NOT committed to this repository.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p images
base="https://raw.githubusercontent.com/davisking/dlib/master/examples/faces"
for f in 2007_007763 2008_001009 2008_001322 2008_002079 2008_002470 \
         2008_002506 2008_004176 2008_007676 2009_004587 \
         Tom_Cruise_avp_2014_4 bald_guys dogs; do
  [ -f "images/$f.jpg" ] || curl -sf -o "images/$f.jpg" "$base/$f.jpg"
  echo "images/$f.jpg"
done
