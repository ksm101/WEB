#!/usr/bin/env python3
"""Touch up a face on a portrait, on the picture's own grid.

The portraits are drawn in blocks of 2 x 2 pixels, so anything added has to be made of whole blocks on the same grid.
A line or a dot one pixel wide is finer than the picture itself and looks pasted on.

  face-touch.py IN OUT [--grid OX OY] [--plain PLAIN.png] [--blush] [--sweat X Y left|right]
                       [--mouth X Y ROWS] [--clear X0 Y0 X1 Y1]

  --grid OX OY     where the blocks start (0 or 1 each way); found by itself when left out
  --blush          with --plain: a blush drawn as fine hatching (the pixels that differ from the plain face) is
                   repainted as a solid patch of pink, paler at its edge, with two short strokes
  --sweat X Y lean a faint wet trail from (X, Y) running down into a drop: two blocks a shade off the skin, then a
                   white glint and a darker lip, one block wide all the way. lean is the way it steps over on the
                   way down, left or right
  --clear ...      takes out what is drawn in that box in the pinks of a mouth, back to skin
  --mouth X Y ROWS draws a mouth from (X, Y): ROWS is rows of blocks separated by /, where D is the mouth's own
                   colour, l a tone half way to the skin, and . nothing. Ends in l taper it; a smile is "l...l/.DDD."
It needs Pillow and nothing else."""
import sys
from collections import Counter
from PIL import Image

N4 = ((1, 0), (-1, 0), (0, 1), (0, -1)); N8 = N4 + ((1, 1), (-1, -1), (1, -1), (-1, 1))
warm = lambda c: c[0] > 195 and c[0] - c[2] > 20 and c[1] > 110      # skin and pinks, not hair or eyes

def grid_of(px, W, H):
    best = None
    for ox in (0, 1):
        for oy in (0, 1):
            n = sum(1 for y in range(oy, H - 1, 2) for x in range(ox, W - 1, 2) if px[x, y][3] and px[x + 1, y] == px[x, y] == px[x, y + 1] == px[x + 1, y + 1])
            if not best or n > best[0]: best = (n, ox, oy)
    return best[1], best[2]

def main(a):
    src, dst = a[0], a[1]; a = a[2:]; im = Image.open(src).convert('RGBA'); px = im.load(); W, H = im.size
    opt = lambda name, n: a[a.index(name) + 1: a.index(name) + 1 + n] if name in a else None
    g = opt('--grid', 2); ox, oy = (int(g[0]), int(g[1])) if g else grid_of(px, W, H)
    snap = lambda x, y: (x - (x - ox) % 2, y - (y - oy) % 2)
    def put(x, y, col):
        x, y = snap(x, y)
        for dx in (0, 1):
            for dy in (0, 1):
                if 0 <= x + dx < W and 0 <= y + dy < H: px[x + dx, y + dy] = col + (255,)
    skin = Counter(px[x, y][:3] for y in range(H) for x in range(W) if px[x, y][3] and warm(px[x, y]) and px[x, y][0] > 245).most_common(1)[0][0]

    if '--blush' in a and opt('--plain', 1):
        pa = Image.open(opt('--plain', 1)[0]).convert('RGBA').load()
        changed = {(x, y) for y in range(1, H - 1) for x in range(1, W - 1) if pa[x, y] != px[x, y] and px[x, y][3] and warm(px[x, y]) and px[x, y][:3] != skin}
        hatch = {p for p in changed if sum(1 for dx, dy in N4 if px[p[0] + dx, p[1] + dy][:3] == skin) >= 2 and sum(1 for dx, dy in N8 if (p[0] + dx, p[1] + dy) in changed) >= 2}
        blocks = {snap(*p) for p in hatch}; grown = {(x + dx * 2, y + dy * 2) for x, y in blocks for dx, dy in N8 + ((0, 0),)}
        seen = set()
        for b in sorted(grown):
            if b in seen: continue
            comp = [b]; seen.add(b); i = 0
            while i < len(comp):
                cx, cy = comp[i]; i += 1
                for dx, dy in N8:
                    q = (cx + dx * 2, cy + dy * 2)
                    if q in grown and q not in seen: seen.add(q); comp.append(q)
            comp = set(comp); body = {b for b in comp if all((b[0] + dx * 2, b[1] + dy * 2) in comp for dx, dy in N4)}
            body = {b for b in body if all(warm(px[b[0] + i, b[1] + j]) for i in (0, 1) for j in (0, 1))}      # never over an eye, a line or the hair
            if len(body) < 20: continue      # too small to be a cheek
            inner = {b for b in body if all((b[0] + dx * 2, b[1] + dy * 2) in body for dx, dy in N4)}
            for b in body: put(b[0], b[1], (244, 160, 170) if b in inner else (249, 196, 194))
            if inner:
                xs = sorted(b[0] for b in inner); ys = sorted(b[1] for b in inner); cx, cy = snap((xs[0] + xs[-1]) // 2, ys[0])
                for k in (-2, 2):                       # two strokes, each two blocks, leaning like "//"
                    for i in (0, 1):
                        b = (cx + k * 2 - i * 2, cy + i * 2)
                        if b in body: put(b[0], b[1], (233, 126, 146))
            print('blush patch of', len(body), 'blocks')

    c = opt('--clear', 4)
    if c:
        x0, y0, x1, y1 = (int(v) for v in c); rose = lambda q: q[3] and q[:3] != skin and q[0] >= 120 and q[0] - q[1] >= 30
        for y in range(y0, y1):
            for x in range(x0, x1):
                if rose(px[x, y]) or min(px[x, y][:3]) > 240: px[x, y] = skin + (255,)

    m = opt('--mouth', 3)
    if m:
        x0, y0 = int(m[0]), int(m[1]); deep = (176, 96, 116); half = tuple((p + q) // 2 for p, q in zip(deep, skin))
        for j, row in enumerate(m[2].split('/')):
            for i, ch in enumerate(row):
                if ch in 'Dl': put(x0 + i * 2, y0 + j * 2, deep if ch == 'D' else half)

    s = opt('--sweat', 3)
    if s:
        x, y = snap(int(s[0]), int(s[1])); lean = -2 if s[2] == 'left' else 2
        tone = lambda k, b: (min(255, int(skin[0] * k)), min(255, int(skin[1] * k + b * .4)), min(255, int(skin[2] * k + b)))
        put(x, y, tone(.985, 14)); put(x, y + 2, tone(.985, 14))                      # the trail, barely off the skin
        x += lean; put(x, y + 4, (255, 255, 255)); put(x, y + 6, tone(.80, 24))      # the drop it runs into: a glint, and a darker lip under it. One block wide all the way, like a drip
    im.save(dst); print(dst, 'grid', (ox, oy))

if __name__ == '__main__':
    if len(sys.argv) < 3: sys.exit(__doc__)
    main(sys.argv[1:])
