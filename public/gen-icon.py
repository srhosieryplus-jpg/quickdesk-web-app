import subprocess, sys

# Generate PNG icons from SVG using Python + cairosvg or just write SVG-based PNGs with playwright
svg = '''<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="100" fill="#7c3aed"/>
  <polygon points="256,40 450,148 450,364 256,472 62,364 62,148" fill="rgba(255,255,255,0.12)" stroke="white" stroke-width="16"/>
  <polygon points="256,100 390,178 390,334 256,412 122,334 122,178" fill="none" stroke="white" stroke-width="8" opacity="0.5"/>
  <text x="256" y="286" text-anchor="middle" dominant-baseline="middle" fill="white" font-size="140" font-weight="900" font-family="-apple-system,BlinkMacSystemFont,sans-serif" letter-spacing="8">QD</text>
</svg>'''

with open('icon.svg', 'w') as f:
    f.write(svg)

print("SVG written")
