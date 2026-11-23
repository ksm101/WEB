"""Repaint a hatched or dithered blush as a solid one: a patch of pink with a paler rim and three short strokes.
Sweat can be added too, starting at the place given: a faint wet trail running down the cheek that gathers into a
small drop at its foot. The top has no edge at all and is only a shade off the skin, so it melts into the face; the
drop is told by one white glint and a darker lip underneath. Say left or right for the way it leans as it runs
(it should follow the line of the cheek). Plain white on fair skin cannot be seen, and a bright blue drop reads as
a cartoon sign: add the word big for that sign (the large drop on the head of someone at a loss).
usage: blush-fix.py plain.png shy.png out.png [sweat_x sweat_y [left|right|big]]"""
import sys
from collections import Counter
from PIL import Image
N4 = ((1, 0), (-1, 0), (0, 1), (0, -1)); N8 = N4 + ((1, 1), (-1, -1), (1, -1), (-1, 1))
plain = Image.open(sys.argv[1]).convert('RGBA'); shy = Image.open(sys.argv[2]).convert('RGBA'); W, H = shy.size; pa, pb = plain.load(), shy.load()
warm = lambda c: c[0] > 195 and c[0] - c[2] > 20 and c[1] > 110      # skin and pinks, not hair
skin = Counter(pb[x, y][:3] for y in range(H) for x in range(W) if pb[x, y][3] and warm(pb[x, y]) and pb[x, y][0] > 245).most_common(1)[0][0]
# the hatching: pixels that changed from the plain face into a pink, speckled with skin
changed = {(x, y) for y in range(H) for x in range(W) if pa[x, y] != pb[x, y] and pb[x, y][3] and warm(pb[x, y]) and pb[x, y][:3] != skin}
def speckled(x, y): return sum(1 for dx, dy in N4 if pb[x + dx, y + dy][:3] == skin) >= 2 and sum(1 for dx, dy in N8 if (x + dx, y + dy) in changed) >= 2      # skin beside it and pink at its corners: a hatch
hatch = {p for p in changed if 1 <= p[0] < W - 1 and 1 <= p[1] < H - 1 and speckled(*p)}
# join them into patches: grow by one, find the joined-up groups, keep the big ones, shrink back
grown = {(x + dx, y + dy) for x, y in hatch for dx, dy in N8 + ((0, 0),)}
seen = set(); patches = []
for p in sorted(grown):
    if p in seen: continue
    comp = [p]; seen.add(p); i = 0
    while i < len(comp):
        cx, cy = comp[i]; i += 1
        for dx, dy in N8:
            q = (cx + dx, cy + dy)
            if q in grown and q not in seen: seen.add(q); comp.append(q)
    if len(comp) >= 80: patches.append(set(comp))
mid, pale, deep = (244, 160, 170), (249, 196, 194), (222, 100, 126)
for comp in patches:
    body = {p for p in comp if all((p[0] + dx, p[1] + dy) in comp for dx, dy in N4)}      # shrunk back by one
    body = {p for p in body if warm(pb[p]) }                                               # never over an eye, a line or the hair
    if len(body) < 60: continue      # too small to be a cheek
    rim = {p for p in body if any((p[0] + dx, p[1] + dy) not in body for dx, dy in N4)}
    for p in body: pb[p] = (pale if p in rim else mid) + (255,)
    inner = body - rim
    if not inner: continue
    xs = sorted(p[0] for p in inner); ys = sorted(p[1] for p in inner); cx = (xs[0] + xs[-1]) // 2; cy = (ys[0] + ys[-1]) // 2
    for k in (-4, 0, 4):                      # three strokes, leaning like "///"
        for i in (-2, -1, 0, 1):
            p = (cx + k - i, cy + i)
            if p in body: pb[p] = deep + (255,)
    print('patch', len(body), 'px at', (cx, cy))
if len(sys.argv) >= 6:
    sx, sy = int(sys.argv[4]), int(sys.argv[5])
    if sys.argv[6:7] == ['big']:
        shape = ['..oo..', '..oo..', '.oLLo.', '.oLLo.', 'oLLLLo', 'oWLLLo', 'oWLLLo', 'oLLLLo', '.oooo.']; col = { 'o': (58, 104, 158), 'L': (176, 224, 246), 'W': (255, 255, 255) }
        for j, row in enumerate(shape):
            for i, ch in enumerate(row):
                if ch != '.': pb[sx + i, sy + j] = col[ch] + (255,)
    else:
        lean = -1 if sys.argv[6:7] == ['left'] else 1 if sys.argv[6:7] == ['right'] else 0
        tone = lambda k, b: (min(255, int(skin[0] * k)), min(255, int(skin[1] * k + b * .4)), min(255, int(skin[2] * k + b)))
        trail, body, side, lip = tone(.985, 14), tone(.97, 26), tone(.90, 16), tone(.77, 24)
        x = sx
        for j in range(5):                      # the trail: one pixel wide, barely off the skin, shifting over once on the way
            if j == 2: x += lean
            pb[x, sy + j] = trail + (255,)
        x += lean; y = sy + 5                   # the drop it gathers into
        pb[x, y] = body + (255,)
        pb[x - 1, y + 1] = side + (255,); pb[x, y + 1] = (255, 255, 255, 255); pb[x + 1, y + 1] = side + (255,)
        pb[x - 1, y + 2] = side + (255,); pb[x, y + 2] = body + (255,); pb[x + 1, y + 2] = lip + (255,)
        pb[x, y + 3] = lip + (255,)
shy.save(sys.argv[3])
