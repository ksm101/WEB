#!/usr/bin/env python3
"""Lay Mira's "dark" shadow over a face of hers that has none.

  python3 tools/mira-shadow.py art/mira/face_without_shadow.png art/mira/portrait_darkside.png
  python3 tools/mira-shadow.py --touch-up art/mira/portrait_dark.png      (a face shaded by an older version)

The face is drawn first, unshaded, by the model: same body and hair as her plain portrait, only the eyes and mouth
changed for the expression. This script then puts the shadow on, the same way every time:

  - it covers skin and eyes from the top of the picture down to row EDGE, then fades over three one-pixel rows;
  - hair, the ear (right of x 122) and everything below the fade are left exactly as they were;
  - eyes are darkened and lose their glint, so they look "dead"; nothing in them is redrawn, so the lashes and
    the shape of the eye stay as the model drew them (no dark ring is added round the eye).

It assumes Mira's portrait framing (192 x 256, her eyes at about y 70 to 99). It needs Pillow and nothing else."""
import sys
from PIL import Image

EDGE = 98                        # the last row in full shadow
FADE = [.75, .5, .25]           # then three rows, each a step lighter
XMIN, XMAX = 30, 122             # the face; the ear starts right of XMAX
EYES = [(50, 68, 79, 97), (86, 70, 123, 99)]       # each eye with its lashes
IRIS = [(61, 78, 70, 90), (97, 80, 108, 93)]       # where a glint can be
SKIN, WHITE, EYE, LINE = (.6, .54, .76), (.52, .49, .68), (.5, .56, .6), (.85, .85, .9)
GLINT = (0x23, 0x55, 0x58)


def kind(c):
    r, g, b = c
    if r > 200 and g > 150 and r >= b: return 'skin'
    if b > r + 8 and r > 150: return 'white'
    if g > r + 10 and b > r: return 'iris'
    if r + g + b < 200: return 'dark'
    return 'hair' if (r - b >= 18 and r <= 205) else 'other'


inbox = lambda x, y, b: b[0] <= x <= b[2] and b[1] <= y <= b[3]


def facey(src, x, y):
    """A pixel of hair colour that is mostly surrounded by face is part of the face: the pink of an eyelid, the line of
    the cheek. Her hair and those tones share colours, so it is told apart by what is round it."""
    n = 0
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        c = src[x + dx, y + dy]
        if c[3] and kind(c[:3]) != 'hair': n += 1
    near_eye = any(b[0] - 3 <= x <= b[2] + 3 and b[1] - 3 <= y <= b[3] + 3 for b in EYES)
    return n >= (2 if near_eye else 3)


def shade(im):
    im = im.convert('RGBA'); src = im.copy().load(); px = im.load()
    for y in range(0, EDGE + len(FADE) + 1):
        s = 1 if y <= EDGE else FADE[y - EDGE - 1]
        for x in range(XMIN, XMAX + 1):
            c = src[x, y]
            if not c[3]: continue
            k = kind(c[:3])
            if k == 'hair' and not facey(src, x, y): continue
            eye = any(inbox(x, y, b) for b in EYES)
            if any(inbox(x, y, b) for b in IRIS) and sum(c[:3]) > 690: c = GLINT + (255,); k = 'iris'
            m = EYE if (eye and k == 'iris') else WHITE if (eye and k == 'white') else LINE if k == 'dark' else SKIN
            t = tuple(1 - s * (1 - v) for v in m)
            px[x, y] = tuple(max(0, min(255, round(c[i] * t[i]))) for i in range(3)) + (255,)
    return im


def touch_up(im):
    """For a face shaded before facey() existed: shade the face-coloured pixels it left bright, and nothing else."""
    im = im.convert('RGBA'); src = im.copy().load(); px = im.load(); n = 0
    for y in range(1, EDGE + len(FADE) + 1):
        s = 1 if y <= EDGE else FADE[y - EDGE - 1]
        for x in range(XMIN, XMAX + 1):
            c = src[x, y]
            if c[3] and kind(c[:3]) == 'hair' and facey(src, x, y):
                t = tuple(1 - s * (1 - v) for v in (LINE if sum(c[:3]) < 260 else SKIN))
                px[x, y] = tuple(max(0, min(255, round(c[i] * t[i]))) for i in range(3)) + (255,); n += 1
    return im, n


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--touch-up':
        im, n = touch_up(Image.open(sys.argv[2])); im.save(sys.argv[2]); print('touched up', n, 'pixels in', sys.argv[2])
    elif len(sys.argv) == 3:
        shade(Image.open(sys.argv[1])).save(sys.argv[2]); print('shaded', sys.argv[1], '->', sys.argv[2])
    else: sys.exit(__doc__)
