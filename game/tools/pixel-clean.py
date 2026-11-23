#!/usr/bin/env python3
"""Tidy a picture that was shrunk into pixel art, so it reads as pixel art and not as a small drawing.

  python3 tools/pixel-clean.py art/mira/portrait.png [more.png ...]      (each file is rewritten in place)
  python3 tools/pixel-clean.py --out DIR art/mira/portrait.png           (written to DIR instead)

What it does, in order:
  1. colours that differ by a hair become one colour (shrinking leaves many near-twins, which show as speckle)
  2. one-pixel gaps in dark lines are closed, so outlines are unbroken
  3. short scraps of dark line (the remains of fine pen hatching) are taken out, but never on skin, where a
     short dark line is a mouth, a nose or a brow
  4. a single stray pixel alone in a flat field takes that field's colour; in a busy place (an eye) it stays
  5. dark lines inside the figure take a deep shade of the colour beside them; only the outer edge stays ink
It needs Pillow and nothing else."""
import sys, os
from collections import Counter
from PIL import Image

INK = (10, 22, 27)
N4 = ((1, 0), (-1, 0), (0, 1), (0, -1)); N8 = N4 + ((1, 1), (-1, -1), (1, -1), (-1, 1))
dist = lambda a, b: abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])
lum = lambda c: c[0] * .3 + c[1] * .59 + c[2] * .11
skin = lambda c: c[0] > 170 and c[0] >= c[1] >= c[2] and 14 <= c[0] - c[2] <= 110 and c[1] > 120      # light, warm, not grey and not white

def clean(im):
    im = im.convert('RGBA'); W, H = im.size; src = im.load()
    g = [[(src[x, y][:3] if src[x, y][3] >= 128 else None) for x in range(W)] for y in range(H)]
    at = lambda x, y: g[y][x] if 0 <= x < W and 0 <= y < H else None
    # 1. near-twin colours become the commoner one
    cnt = Counter(c for row in g for c in row if c); order = [c for c, _ in cnt.most_common()]; keep = []; to = {}
    for c in order:
        m = next((k for k in keep if dist(k, c) <= 14), None)
        if m: to[c] = m
        else: keep.append(c); to[c] = c
    g = [[to[c] if c else None for c in row] for row in g]
    dark = min(keep, key=lum); isdark = lambda c: c is not None and lum(c) < 45
    for y in range(H):
        for x in range(W):
            if isdark(g[y][x]): g[y][x] = dark
    # 2. a gap of one pixel between two dark pixels facing each other is closed
    fill = []
    for y in range(H):
        for x in range(W):
            c = g[y][x]
            if c is None or c == dark: continue
            for dx, dy in ((1, 0), (0, 1), (1, 1), (1, -1)):
                if at(x + dx, y + dy) == dark and at(x - dx, y - dy) == dark:
                    # only where the line really carries on beyond both ends
                    if at(x + 2 * dx, y + 2 * dy) == dark or at(x - 2 * dx, y - 2 * dy) == dark: fill.append((x, y)); break
    for x, y in fill: g[y][x] = dark
    def around(x, y, r=1, skip=None):
        c = Counter()
        for yy in range(y - r, y + r + 1):
            for xx in range(x - r, x + r + 1):
                v = at(xx, yy)
                if v is not None and v != skip and (xx, yy) != (x, y): c[v] += 1
        return c
    # 3. scraps of dark line: joined-up groups of fewer than 7 dark pixels go, unless they lie on skin
    seen = [[False] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            if g[y][x] != dark or seen[y][x]: continue
            comp = [(x, y)]; seen[y][x] = True; i = 0
            while i < len(comp):
                cx, cy = comp[i]; i += 1
                for dx, dy in N8:
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < W and 0 <= ny < H and not seen[ny][nx] and g[ny][nx] == dark: seen[ny][nx] = True; comp.append((nx, ny))
            if len(comp) < 7:
                near = Counter()
                for cx, cy in comp: near.update(around(cx, cy, 2, dark))
                if not near or skin(near.most_common(1)[0][0]): continue      # a short dark line on skin is a mouth, a nose or a brow: it stays
                for cx, cy in comp:
                    c = around(cx, cy, 2, dark)
                    if c: g[cy][cx] = c.most_common(1)[0][0]
    # 4. stray single pixels in flat fields (twice, since taking one out can leave another)
    for _ in range(2):
        for y in range(H):
            for x in range(W):
                c = g[y][x]
                if c is None or c == dark: continue
                if all(at(x + dx, y + dy) != c for dx, dy in N4):
                    n = Counter(at(x + dx, y + dy) for dx, dy in N8)
                    top, k = n.most_common(1)[0]
                    if top is not None and top != dark and k >= 6: g[y][x] = top      # a speck alone in a flat field; anything in a busy place (an eye, a mouth) stays
    # 5. dark lines and dark masses inside the figure take a deep shade of the colour they belong to; only the
    #    outer edge stays ink. What a dark pixel belongs to is the commonest colour near it, and a pixel deep inside
    #    a dark mass takes it from the dark pixels around it, working inwards.
    base = {}
    for y in range(H):
        for x in range(W):
            if g[y][x] == dark:
                n = around(x, y, 2, dark)
                if n: base[(x, y)] = n.most_common(1)[0][0]
    todo = [(x, y) for y in range(H) for x in range(W) if g[y][x] == dark and (x, y) not in base]; deep = set(todo)
    while todo:
        got = {}
        for x, y in todo:
            c = Counter(base[(x + dx, y + dy)] for dx, dy in N8 if (x + dx, y + dy) in base)
            if c: got[(x, y)] = c.most_common(1)[0][0]
        if not got: break
        base.update(got); todo = [q for q in todo if q not in got]
    # on skin a line is a lash, a brow or a mouth, and wants to stay strong: a dark warm brown. The heart of a dark
    # mass is a shadow and stays close to black, only tinted.
    def shade(b, heart):
        if skin(b): return (38, 24, 30) if heart else (62, 36, 42)
        k = .15 if heart else .30; return (int(b[0] * k + 8), int(b[1] * (k - .02) + 10), int(b[2] * (k + .02) + 14))
    out = [row[:] for row in g]
    for y in range(H):
        for x in range(W):
            if g[y][x] != dark: continue
            edge = any(at(x + dx, y + dy) is None for dx, dy in N8) or x in (0, W - 1) or y == 0
            out[y][x] = INK if edge or (x, y) not in base else shade(base[(x, y)], (x, y) in deep)
    res = Image.new('RGBA', (W, H), (0, 0, 0, 0)); px = res.load()
    for y in range(H):
        for x in range(W):
            if out[y][x] is not None: px[x, y] = out[y][x] + (255,)
    return res

if __name__ == '__main__':
    args = sys.argv[1:]; outdir = None
    if args[:1] == ['--out']: outdir = args[1]; args = args[2:]
    if not args: sys.exit(__doc__)
    for f in args:
        res = clean(Image.open(f)); dst = os.path.join(outdir, os.path.basename(os.path.dirname(os.path.abspath(f))) + '-' + os.path.basename(f)) if outdir else f
        res.save(dst); print(dst, len(set(res.getdata())) - 1, 'colours')
