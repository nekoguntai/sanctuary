#!/bin/bash
# Generate placeholder icons using ImageMagick (if available)
# For production, replace with actual icons

for size in 16 32 48 128; do
  convert -size ${size}x${size} xc:#f97316 \
    -gravity center \
    -fill white \
    -font DejaVu-Sans-Bold \
    -pointsize $((size/2)) \
    -annotate 0 "S" \
    icon${size}.png 2>/dev/null || \
  echo "ImageMagick not available - create icon${size}.png manually"
done
