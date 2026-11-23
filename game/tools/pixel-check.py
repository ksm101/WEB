#!/usr/bin/env python3
"""Is this picture really one pixel to a dot, or a smaller picture saved at twice the size?

  python3 tools/pixel-check.py art/jin/portrait.png [more.png ...]

A picture enlarged twofold is made of blocks of 2 x 2 pixels all on one grid: nearly every such block is one colour
when read from the right corner, and far fewer are when read one pixel off. In a picture drawn at its real size the
four ways of reading it come out about the same. This prints, for each file, the share of one-colour blocks on the
best grid and on the others, and says which kind it is."""
import sys
from PIL import Image

for f in sys.argv[1:] or sys.exit(__doc__):
    im = Image.open(f).convert('RGBA'); px = im.load(); W, H = im.size; r = {}
    for ox in (0, 1):
        for oy in (0, 1):
            tot = same = 0
            for y in range(oy, H - 1, 2):
                for x in range(ox, W - 1, 2):
                    a = px[x, y]
                    if not a[3]: continue
                    tot += 1; same += (px[x + 1, y] == a and px[x, y + 1] == a and px[x + 1, y + 1] == a)
            r[(ox, oy)] = same / max(1, tot)
    best = max(r, key=r.get); rest = sum(v for k, v in r.items() if k != best) / 3
    kind = 'ENLARGED: really %d x %d, each dot doubled' % (W // 2, H // 2) if r[best] > .7 and r[best] - rest > .15 else 'drawn at its real size'
    print('%s  %dx%d  one-colour blocks %.0f%% on the best grid, %.0f%% on the others  ->  %s' % (f, W, H, r[best] * 100, rest * 100, kind))
