/* Who has pixel art. Anyone not listed here is drawn as a plain shape.
 * id: a class (tank, heal, dps), a creature kind (crab, acolyte, grunt, caster, brute, boss, or a kind made in the
 *     editor; a made kind without art of its own uses its base's), or a camp person (kol, mira, jin, wu).
 * cell: the width and height of one frame in pixels. scale: world units per pixel (1 unless it should look bigger).
 * foot: how many pixels above the bottom edge of the frame the feet stand.
 * anims: the strips there are; each is art/<id>/<anim>_<dir>.png, frames left to right. dirs: down, side (facing right), up.
 * hands: true when the body is drawn with empty hands: the game then draws what it holds beside it.
 * _weapons: the kinds of weapon that have a picture of their own at art/weapon/<kind>.png, e.g. _weapons: ['sword', 'shield'].
 * moods: other faces of the same portrait, each at art/<id>/portrait_<mood>.png, e.g. moods: ['surprised', 'angry'].
 *     A line of the story asks for one as its third item; without it, or when that face is missing, the plain one shows.
 * _tiles, _props, _deco, _icons, _ui: the ground, the things that stand on it, the scatter, the icons and the menu
 *     picture that have been drawn. art/README.md says what each is and how to list it.
 * portrait: true when there is art/<id>/portrait.png, the large picture shown while that person speaks. Someone who
 *     only has a portrait (the warden speaks as `mog`) is listed as  mog: { portrait: true, anims: [] }
 * Example:
 *   dps: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle', 'walk', 'attack', 'hurt'] }
 */
window.ART_MANIFEST = Object.assign({
  dps: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'], hands: true },
  tank: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'], hands: true },
  heal: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'], hands: true },
  acolyte: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'] },
  grunt: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'] },
  caster: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'] },
  crab: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'] },
  brute: { cell: 48, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'] },
  boss: { cell: 64, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'] },
  kol: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'], portrait: true, moods: ['smile', 'serious'] },
  mira: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'], portrait: true, moods: ['serious', 'sad', 'shy'] },
  jin: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'], portrait: true, moods: ['angry', 'serious', 'shy'] },
  wu: { cell: 32, foot: 4, dirs: ['down', 'side', 'up'], anims: ['idle'], portrait: true, moods: ['smile', 'surprised', 'worried'] },
  mog: { portrait: true, anims: [] },
  _weapons: ['sword', 'hammer', 'maul', 'spear', 'hook', 'xbow', 'bow', 'staff', 'bell', 'shield', 'tome', 'quiver'],      // the bow has no string in its picture: the game draws the string
  _tiles: ['sand', 'path', 'water', 'hull', 'stone', 'flood', 'brick'],
  _deco: ['shell', 'driftwood', 'seaweed', 'bones', 'puddle', 'rustbit', 'rope', 'pebbles'],
  _props: { campfire: { w: 32, h: 32, frames: 4 }, rock: { w: 32, h: 32, frames: 3 }, rockbig: { w: 48, h: 48, frames: 2 }, herb: { w: 32, h: 32, frames: 1 }, wreck: { w: 32, h: 32, frames: 1 }, salt: { w: 32, h: 32, frames: 1 }, chest: { w: 32, h: 32, frames: 2 }, portal: { w: 48, h: 64, frames: 4 }, gate: { w: 64, h: 64, frames: 1 }, mailbox: { w: 32, h: 48, frames: 1 }, stall: { w: 48, h: 48, frames: 2 }, signpost: { w: 32, h: 48, frames: 1 }, marker: { w: 32, h: 48, frames: 1 } },
  _icons: ['scrap', 'salt', 'shard', 'herb', 'potion', 'coin', 'armor', 'trinket', 'taunt', 'wall', 'bash', 'charge', 'quake', 'guard', 'tankUlt', 'anchor', 'mend', 'ring', 'seal', 'wave', 'pool', 'barrier', 'healUlt', 'surge', 'blast', 'roll', 'snipe', 'pierce', 'volley', 'mark', 'dpsUlt', 'sunshot'],
},window.ART_MANIFEST);
