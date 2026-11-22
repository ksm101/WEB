/* Who has pixel art. Anyone not listed here is drawn as a plain shape.
 * id: a class (tank, heal, dps), a creature kind (crab, acolyte, grunt, caster, brute, boss, or a kind made in the
 *     editor; a made kind without art of its own uses its base's), or a camp person (kol, mira, jin, wu).
 * cell: the width and height of one frame in pixels. scale: world units per pixel (1 unless it should look bigger).
 * foot: how many pixels above the bottom edge of the frame the feet stand.
 * anims: the strips there are; each is art/<id>/<anim>_<dir>.png, frames left to right. dirs: down, side (facing right), up.
 * hands: true when the body is drawn with empty hands: the game then draws what it holds beside it.
 * _weapons: the kinds of weapon that have a picture of their own at art/weapon/<kind>.png, e.g. _weapons: ['sword', 'shield'].
 * portrait: true when there is art/<id>/portrait.png, the large picture shown while that person speaks. Someone who
 *     only has a portrait (the warden speaks as `mog`) is listed as  mog: { portrait: true, anims: [] }
 * Example:
 *   dps: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle', 'walk', 'attack', 'hurt'] }
 */
window.ART_MANIFEST = Object.assign({
  dps: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'], hands: true },
  tank: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'] },
  heal: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'] },
  acolyte: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'] },
  grunt: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'] },
  caster: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'] },
  crab: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'] },
  brute: { cell: 48, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'] },
  boss: { cell: 64, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'] },
  kol: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'] },
  mira: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'] },
  jin: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'] },
  wu: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'] },
},window.ART_MANIFEST);
