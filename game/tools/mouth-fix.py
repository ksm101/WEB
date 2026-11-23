#!/usr/bin/env python3
"""Join up a mouth that came out as a row of separate dots.

At this size a mouth is thinner than one pixel in the picture it was shrunk from, so it lands as a few dots with gaps
between them and looks unfinished. Drawing it again as a dark line makes it too heavy. This joins the dots that are
there with a softer tone, half way between the mouth's own colour and the skin: the line becomes whole without
becoming darker.

usage: mouth-fix.py picture.png x0 y0 x1 y1 [out.png]      (the box is where the mouth is; nothing outside it changes)"""
import sys
from collections import Counter
from PIL import Image

N8 = ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1))
def fix(im, box):
    im = im.convert('RGBA'); px = im.load(); x0, y0, x1, y1 = box
    skin = Counter(px[x, y][:3] for y in range(y0, y1) for x in range(x0, x1)).most_common(1)[0][0]
    rose = lambda c: c[3] and c[:3] != skin and c[0] >= 120 and c[0] - c[1] >= 30 and not (c[1] > 200 and c[2] > 200)      # the pinks and reds a mouth is drawn in; not white, not skin
    seen = set(); comps = []
    for y in range(y0, y1):
        for x in range(x0, x1):
            if (x, y) in seen or not rose(px[x, y]): continue
            comp = [(x, y)]; seen.add((x, y)); i = 0; inside = True
            while i < len(comp):
                cx, cy = comp[i]; i += 1
                for dx, dy in N8:
                    q = (cx + dx, cy + dy)
                    if q in seen or not rose(px[q]): continue
                    if not (x0 <= q[0] < x1 and y0 <= q[1] < y1): inside = False; continue
                    seen.add(q); comp.append(q)
            if inside and len(comp) <= 14: comps.append(comp)      # what runs out of the box is a cheek or a chin, not the mouth
    if len(comps) < 2: return im, 0
    core = Counter(px[p][:3] for c in comps for p in c).most_common(); deepest = min((c for c, _ in core), key=lambda c: c[0] + c[1] + c[2])
    soft = tuple((a + b) // 2 for a, b in zip(deepest, skin)) + (255,)
    comps.sort(key=lambda c: min(p[0] for p in c)); n = 0
    for a, b in zip(comps, comps[1:]):
        p = max(a, key=lambda q: q[0]); q = min(b, key=lambda r: r[0]); dx, dy = q[0] - p[0], q[1] - p[1]
        if dx < 2 or dx > 5 or abs(dy) > 3: continue      # touching already, or too far apart to be one mouth
        for k in range(1, dx):
            x = p[0] + k; y = round(p[1] + dy * k / dx)
            if px[x, y][:3] == skin: px[x, y] = soft; n += 1
    return im, n

if __name__ == '__main__':
    if len(sys.argv) < 6: sys.exit(__doc__)
    res, n = fix(Image.open(sys.argv[1]), tuple(int(v) for v in sys.argv[2:6])); res.save(sys.argv[6] if len(sys.argv) > 6 else sys.argv[1]); print(sys.argv[1], n, 'pixels joined')
