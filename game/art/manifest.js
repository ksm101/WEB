/* Who has pixel art. Anyone not listed here is drawn as a plain shape.
 * id: a class (tank, heal, dps), a creature kind (crab, acolyte, grunt, caster, brute, boss, or a kind made in the
 *     editor; a made kind without art of its own uses its base's), or a camp person (kol, mira, jin, wu).
 * cell: the width and height of one frame in pixels. scale: world units per pixel (1 unless it should look bigger).
 * foot: how many pixels above the bottom edge of the frame the feet stand.
 * anims: the strips there are; each is art/<id>/<anim>_<dir>.png, frames left to right. dirs: down, side (facing right), up.
 * Example:
 *   dps: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle', 'walk', 'attack', 'hurt'] }
 */
window.ART_MANIFEST = Object.assign({
}, window.ART_MANIFEST);
