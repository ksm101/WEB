/* Embertide story, first draft.
 * One short scene per main quest, shown when that quest's reward is claimed, plus a prologue on first launch.
 * A scene is a title and a list of [speaker, line] or [speaker, line, face]. Speaker 'n' is the narrator; the others
 * are keys of CAST. `face` asks for one of the speaker's other portraits (MOODS below lists the faces there can be);
 * a line without one, or one whose face has not been drawn yet, shows the plain portrait.
 * `at` names the camp character you talk to in the field to hand the quest in and hear the scene.
 * ORDER after the prologue must match the main quest order in sim.js (the test checks this).
 *
 * The premise: the harbour town of 燼港 kept the sea back with a great bell in its tower. The bell came loose
 * and sank, the tide turned to rust, and the tower now floods on a three-minute cycle. 莫葛, the bell-ringer,
 * stayed at his post and the rust took him. The party climbs down floor by floor, gathering shards of the bell. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Story = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const CAST = {
  kol: { lvl: 28, name: '柯爾', color: 'tank' },     // the shield: a shipwright before the tide, blunt, means well
  mira: { lvl: 31, name: '蜜拉', color: 'heal' },    // the healer, 27: everyone's gentle big sister, knows the tower's past; frightening when she smiles in anger, and the one person Jieyan obeys
  jin: { lvl: 24, name: '婕焰', color: 'ember' },    // the archer, 21: a grown woman who acts the brat. Teases and plays tricks, but measures them; kind underneath; and when a joke goes too far she turns meek, afraid of being ignored
  wu: { lvl: 12, name: '小霧', color: 'brass' },     // the youngest: a lamp-keeper's apprentice, curious
  mog: { lvl: 40, name: '莫葛', color: 'rust' }      // the warden: once the bell-ringer
};

const SCENES = {
  prologue: { title: '序　沉鐘', lines: [
    ['n', '鐘聲沉入海底那天，潮水開始生鏽。'],
    ['n', '燼港的人把那座塔叫做沉鐘塔。它每三分鐘淹一次，進去的人得趕在那之前出來。'],
    ['kol', '新來的？站我後面。別擋路，也別掉隊。'],
    ['mira', '他的意思是歡迎。我們缺第四個人很久了。']
  ] },
  bell: { at: 'mira', title: '第一聲鐘響', lines: [
    ['jin', '欸～居然活著出來了？我還賭你撐不過第二波耶。嘻嘻。', 'smug'],
    ['mira', '你聽見了嗎？最後那一下，鐘在底下回了一聲。', 'serious'],
    ['kol', '那個看守者叫莫葛，以前是這座塔的敲鐘人。現在他只記得一件事：誰都不准靠近鐘。'],
    ['mira', '下次看到祭司開始念咒，就打斷他們。那些咒是念給潮水聽的。']
  ] },
  kick: { at: 'kol', title: '斷其咒語', lines: [
    ['wu', '我數了，三次！最後那個祭司的臉都歪了。', 'surprised'],
    ['mira', '鹽咒是在叫潮水早點回來。每打斷一次，我們就多幾秒。'],
    ['kol', '塔裡撿到的鏽鐵和鹽晶別丟。拿去工坊，做點什麼都好，我看看你的手。']
  ] },
  craft: { at: 'kol', title: '工坊開張', lines: [
    ['kol', '手藝普通。不過能用，能用的就是好東西。', 'smile'],
    ['kol', '我以前造船。船沉了以後才知道，鏽過的鐵比新鐵更認得這片海。'],
    ['jin', '聊完沒～？下一趟要搶在潮水前出塔喔。慢吞吞的我可不等。', 'smug']
  ] },
  ontime: { at: 'jin', title: '搶在潮水之前', lines: [
    ['jin', '三分鐘內耶～不錯嘛。我本來都準備好要笑你了，可惜。', 'smug'],
    ['mira', '潮退得乾淨，鐘的碎片才會露出來。慢了，就只剩鏽。'],
    ['wu', '這瓶給你。蜜拉姐熬的，很苦，可是有用。'],
    ['mira', '下一趟留意地上。發紅的地方，是鐘要落下來的位置。']
  ] },
  clean: { at: 'wu', title: '乾淨的腳步', lines: [
    ['wu', '一下都沒被砸到！你是不是看得見鐘會掉在哪？', 'surprised'],
    ['kol', '是他肯看地上。你也該學。'],
    ['mira', '上面這幾層只是回聲。真正的鐘在更底下，莫葛本人也是。']
  ] },
  lvl3: { at: 'mira', title: '更深一層', lines: [
    ['n', '第三層的牆上有字，被鏽蓋住了一半。'],
    ['mira', '「鐘響，潮退。鐘停，潮來。」是莫葛的筆跡。他在這裡敲了一輩子的鐘。'],
    ['kol', '鐘不是自己沉的。架子上的榫是被人鬆開的，我看得出來。', 'serious'],
    ['jin', '誰？', 'serious'],
    ['kol', '不知道。先把身上的東西弄硬一點，再往下問。']
  ] },
  temper: { at: 'kol', title: '淬火', lines: [
    ['kol', '用沉鐘碎片淬過的鐵，敲起來有鐘的聲音。你聽。'],
    ['wu', '莫葛聽到這個聲音，會不會就想起來了？', 'worried'],
    ['mira', '也許。也可能他會更生氣。往下走就知道了。']
  ] },
  lvl5: { at: 'mira', title: '鐘塔中段', lines: [
    ['n', '第五層。這裡的水是暖的，像有人剛離開。'],
    ['mog', '……鐘……還沒響……不准……過去……'],
    ['mira', '他不是在趕我們走。他在等鐘響，等到忘了自己在等什麼。', 'sad'],
    ['kol', '那就把鐘湊回來，敲給他聽。'],
    ['n', '塔還有更深的地方。'],
    ['n', '這一章先寫到這裡。']
  ] }
};

/* The faces a portrait can have besides the plain one. */
const MOODS = { smile: '微笑', happy: '開心', angry: '生氣、不耐煩', sad: '難過', surprised: '驚訝、興奮', worried: '擔心', serious: '認真、凝重', shy: '害羞', troubled: '傷腦筋', smug: '壞笑、得意', teary: '慌了、快哭出來', dark: '笑著生氣（眼睛沒在笑）', laugh: '捧腹大笑', panic: '慌到手忙腳亂' };
/* When someone has no portrait of a face, the nearest one they may have (and so on down the line). */
const ALT = { smug: 'smile', teary: 'shy', dark: 'serious', happy: 'smile', laugh: 'smug', panic: 'teary' };
/* Faces that are a whole other drawing, body and all, for when a feeling runs high. To the game they are faces like
 * the rest; this list is for whoever draws them. */
const POSES = ['laugh', 'panic'];

/* What each of them says at the camp when they have nothing new for you: a line, or [line, face]. */
const IDLE = {
  kol: ['火別讓它滅了。潮氣一上來，鐵就開始爛。', '灘上的殘骸可以拆，都是好鐵。', '塔門在北邊，沿著踩出來的路走就到。'],
  mira: [['今天的潮聲很低，像有人在水底嘆氣。', 'sad'], '潮草長在水邊。兩把草加一塊鹽晶，就能熬一瓶藥。', ['累了就回火邊坐著。有我在，這一圈牠們不敢進來。', 'smile'],
    ['有沒有好好吃飯？不可以騙姐姐喔。', 'smile'], ['婕焰又捉弄你了？跟我說，我會好好「請她喝茶」的。', 'dark']],
  jin: [['從這裡跑到塔門，我最快四十秒。你呢～？要不要讓你十秒？', 'smug'], ['你背後有螃蟹喔。……騙你的，嘻嘻。回頭的樣子好好笑。', 'smug'],
    '學徒一念咒就打斷牠，跟塔裡一樣。這句我可沒在鬧你。', ['噓——別跟蜜拉姐說在這看到我。我在躲她。', 'teary']],
  wu: ['我在燈塔學過看霧。霧往哪邊飄，潮就從哪邊來。', ['鹽晶會發光！晚上看最清楚。', 'surprised'], ['柯爾叔嘴巴很兇，可是他會偷偷幫我修弓。', 'smile']]
};

/* Bonds (sim.js BONDS says who has one and what it gives). scenes[n] plays once when tier n is reached; gift[mood]
 * is what they say to a gift, by how much they liked it; more[n] are extra things they say at the camp from tier n.
 * A scene may hold a choice in place of a line: { pick: [{ say: what the player does, lines: [...] }, ...] }. The lines
 * of the one chosen are spoken, then the scene goes on. sim.js (BONDS[who].picks) says what each choice is worth.
 * looks[id] plays when that thing to wear is given; { reveal: true } in it is where she is first seen wearing it.
 * wear is what she says when asked to put something on or take it off.
 * ask and vow play when they become your couple and when the vow is taken; dear is what they say at the camp after. */
const BOND = {
  mira: {
    scenes: {
      1: [['mira', '又來看我了？真乖。這裡很少有人會特地繞過來陪我說話呢。', 'smile'],
          ['mira', '我在熬藥，潮草快用完了。你要是順路，能幫姐姐帶幾株回來嗎？']],
      2: [['jin', '噗，你背上被我貼了「我是慢吞吞」耶，繞了整個營地都沒發現～', 'smug'],
          ['mira', '婕焰。', 'dark'],
          ['jin', '蜜、蜜拉姐……我撕！我現在就撕掉！', 'teary'],
          { pick: [
            { say: '「算了啦，我不介意。」', lines: [
              ['mira', '你人真好。可是太縱容她，她會得寸進尺的喔。', 'smile'],
              ['jin', '得救了……慢吞吞，這次算我欠你的。', 'shy']] },
            { say: '「蜜拉姐，交給妳了。」', lines: [
              ['mira', '好。婕焰，今晚的鍋子妳一個人洗，洗到照得出臉為止。', 'dark'],
              ['jin', '嗚……你給我記住啦——！', 'teary']] }] },
          ['mira', '嚇到了嗎？她呀，我會看好的。你下塔的時候，我也會看著你。', 'smile']],
      3: [['mira', '塔還沒沉的時候，我在塔下替敲鐘的人送藥。鐘一響，船就知道怎麼回家。', 'sad'],
          ['mira', '現在我能做的，只剩把上岸的人治好。所以你不准比我先倒，知道嗎？', 'serious'],
          ['mira', '這瓶給你，綁紅線的，比較不苦。別跟婕焰說，她會吵著說我偏心。', 'shy'],
          ['mira', '還有件事只想拜託你。我想知道，趕在潮水前把塔走完是什麼感覺。']],
      4: [['mira', '昨晚的潮聲不一樣了。不像嘆氣，比較像……有人在水底哼歌。'],
          ['mira', '我一直在照顧別人，都忘了被人掛念是什麼感覺。是你讓我想起來的。', 'shy'],
          ['mira', '等鐘再響的那一天，我想站在你旁邊聽。說好了喔。', 'smile']]
    },
    ask: [['mira', '這束潮花……是給我的？等等，讓姐姐先深呼吸一下。', 'shy'],
          ['mira', '我比你想的還愛操心，生起氣來也很可怕喔。這樣也可以嗎？', 'serious'],
          ['mira', '……那以後，請多指教了。不准反悔喔。', 'shy'],
          ['jin', '欸——！蜜拉姐臉好紅！我要去跟柯爾大叔說！', 'smug'],
          ['mira', '婕焰。', 'dark']],
    vow: [['mira', '用沉鐘碎片打的戒指……敲起來，有鐘的聲音呢。', 'shy'],
          ['mira', '以前我只會等鐘響。現在我想和你一起，把它敲響。', 'serious'],
          ['mira', '往後不管潮水漲到哪裡，你回來的地方都在我這裡。約好了。', 'smile']],
    looks: { shawl: [['mira', '披肩？哎呀，是潮紋的花樣呢。你特地去找的嗎？', 'smile'],
          ['n', '她把披肩圍上肩膀，仔細地在胸前打了個結。'],
          { reveal: true },
          ['mira', '好暖和。……怎麼樣，適合姐姐嗎？', 'shy'],
          ['mira', '我會好好珍惜的。夜裡守火的時候，就披著它。', 'smile']] },
    wear: [['這樣可以嗎？你喜歡哪個樣子，跟姐姐說就好。', 'smile']],
    dear: [['你回來了。先讓我看看有沒有受傷……好，沒事。', 'smile'], ['今天也要平安回來。這不是拜託，是命令喔。', 'smile'], ['……手借我一下。嗯，這樣就不冷了。', 'shy']],
    gift: {
      love: [['哎呀，是給我的？謝謝你，我會好好珍惜的。', 'shy'], ['你怎麼知道我正缺這個？真貼心。', 'shy']],
      like: [['這個用得上呢。謝謝，我收下了。', 'smile'], ['你有心了。', 'smile']],
      ok: [['謝謝。我會想辦法用上的。']],
      meh: [['……嗯？這是婕焰教你送的吧。沒關係，我不生氣喔。', 'dark']]
    },
    more: { 1: ['潮草我永遠不嫌多。鹽晶和藥水也用得上。'], 2: [['你今天氣色不錯。這樣姐姐就放心了。', 'smile']], 3: [['你一來，火好像比較暖。……是我的錯覺吧。', 'shy']] }
  },
  jin: {
    scenes: {
      1: [['jin', '又來找我～？該不會是喜歡上我了吧？噗噗，臉紅了臉紅了。', 'smug'],
          ['jin', '開玩笑的啦。來得正好，灘上那群學徒整天念咒，吵得我瞄不準。'],
          ['jin', '幫我讓牠們閉嘴，八隻。辦得到嗎，慢吞吞～？', 'smug']],
      2: [['jin', '嘻嘻，你水壺裡的水被我換成海水了喔～快喝快喝。', 'smug'],
          { pick: [
            { say: '不理她，轉身就走', lines: [
              ['n', '你沒有笑，一句話也沒說，轉身就走。'],
              ['jin', '欸？等、等一下！你生氣了？我換回來了啦，真的！', 'panic'],
              ['jin', '……不要不理我嘛。我以後會先看你臉色再鬧，好不好。', 'teary'],
              ['n', '你回頭，告訴她你沒有生氣。'],
              ['jin', '沒生氣？……哼，嚇死人了。下次不准這樣嚇我。', 'shy']] },
            { say: '灌一大口，誇張地噴出來', lines: [
              ['n', '你仰頭灌了一大口，朝天噴成一道水霧，然後直挺挺倒下。'],
              ['jin', '噗哈哈哈！你是噴泉嗎！好髒喔～再一次、再一次！', 'laugh'],
              ['n', '你躺在地上，一動也不動。'],
              ['jin', '……喂？演夠了吧？喂！你不要嚇我！蜜拉姐——！', 'panic'],
              ['n', '你睜開一隻眼睛，對她眨了一下。'],
              ['jin', '你、你這傢伙！居然反過來整我！……算你厲害啦。', 'angry']] },
            { say: '面不改色地喝完：「還不錯。」', lines: [
              ['n', '你面不改色地喝完整壺，擦了擦嘴。'],
              ['jin', '欸？那是真的海水耶！你、你沒事吧？快吐出來啦！', 'teary'],
              ['n', '其實你早就發現，偷偷換回淡水了。'],
              ['jin', '……你早就知道了？可惡，被反將一軍。下次我會更小心的！', 'angry']] }] },
          ['jin', '……那、那這壺乾淨的給你。這次是真的，沒有加料啦。', 'shy']],
      3: [['jin', '喂，手伸出來。……不是惡作劇啦！這次真的不是！', 'angry'],
          ['jin', '箭頭，我磨了三天。你上次差點被砸到，我看了很不爽。', 'shy'],
          ['jin', '所以塔裡那些念咒的，一秒都別多給。打斷十次，我就承認你。', 'serious']],
      4: [['jin', '我以前覺得一個人跑最快。捉弄完就跑，誰也追不上。'],
          ['jin', '現在跑到塔門會回頭看一下。……看某個慢吞吞有沒有跟上。', 'shy'],
          ['jin', '笑什麼！再笑我就在你鞋子裡放螃蟹喔！', 'angry'],
          ['jin', '……騙你的。走吧，一起。', 'shy']]
    },
    ask: [['jin', '潮花？給我？……等等，這是惡作劇對吧？換你整我了對吧？', 'teary'],
          ['jin', '不是……？欸、欸欸？是真的？', 'panic'],
          ['jin', '……好啦，答應你啦。可、可是在別人面前不准講！', 'shy'],
          ['mira', '恭喜呀。婕焰，以後可不能再欺負人家了喔？', 'smile'],
          ['jin', '蜜拉姐妳什麼時候站在那裡的啦——！', 'panic']],
    vow: [['jin', '沉鐘碎片打的戒指？……你居然記得我喜歡這個。', 'shy'],
          ['jin', '先說好，我還是會捉弄你。一輩子都會。你逃不掉了喔～', 'smug'],
          ['jin', '所以……你也不准不理我。一輩子都不准。', 'teary']],
    looks: { bun: [['jin', '髮圈？給我的？……你該不會偷偷在上面抹了膠水吧。', 'smug'],
          ['n', '她左看右看，確認沒有機關，才轉過身把頭髮重新綁起來。'],
          { reveal: true },
          ['jin', '……怎樣啦。不、不准盯著看！好看就說好看！', 'shy'],
          ['jin', '哼，既然你這麼想看，以後偶爾綁給你看也可以啦。', 'smug']] },
    wear: [['換好了。……幹嘛一直看，你是不是有什麼企圖～？', 'smug']],
    dear: [['今天的惡作劇是——抱一下。……幹嘛，不行喔！', 'shy'], ['欸，慢吞吞。出門前回頭看我一眼，這是規定。', 'smug'], ['你要是受傷回來，我會真的生氣。不是鬧你的那種。', 'serious']],
    gift: {
      love: [['喔～？很懂嘛。……我、我才沒有很高興！', 'shy'], ['算你識貨～收下了。下次惡作劇放你一馬。', 'smug']],
      like: [['還行啦。放我這邊吧。'], ['嗯哼，勉強及格～', 'smug']],
      ok: [['喔。謝啦。']],
      meh: [['噗，送這個？你是不是在整我？這招我比你熟喔～', 'smug']]
    },
    more: { 1: ['沉鐘碎片有多少我收多少，磨成箭頭最利。鐵屑也行。草就免了～'], 2: [['今天還沒捉弄你耶。……怎樣，你在期待嗎？', 'smug']], 3: [['……看什麼。我只是剛好站在這裡等人啦。', 'shy']] }
  }
};

const ORDER = ['prologue', 'bell', 'kick', 'craft', 'ontime', 'clean', 'lvl3', 'temper', 'lvl5'];

return { CAST, SCENES, ORDER, IDLE, MOODS, ALT, POSES, BOND };
});
