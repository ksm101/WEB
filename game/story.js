/* Embertide story, first draft.
 * One short scene per main quest, shown when that quest's reward is claimed, plus a prologue on first launch.
 * A scene is a title and a list of [speaker, line]. Speaker 'n' is the narrator; the others are keys of CAST.
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
  kol: { name: '柯爾', color: 'tank' },     // the shield: a shipwright before the tide, blunt, means well
  mira: { name: '蜜拉', color: 'heal' },    // the healer: listens to the tide, knows the tower's past
  jin: { name: '阿燼', color: 'ember' },    // the archer: impatient, counts everything in seconds
  wu: { name: '小霧', color: 'brass' },     // the youngest: a lamp-keeper's apprentice, curious
  mog: { name: '莫葛', color: 'rust' }      // the warden: once the bell-ringer
};

const SCENES = {
  prologue: { title: '序　沉鐘', lines: [
    ['n', '鐘聲沉入海底那天，潮水開始生鏽。'],
    ['n', '燼港的人把那座塔叫做沉鐘塔。它每三分鐘淹一次，進去的人得趕在那之前出來。'],
    ['kol', '新來的？站我後面。別擋路，也別掉隊。'],
    ['mira', '他的意思是歡迎。我們缺第四個人很久了。']
  ] },
  bell: { title: '第一聲鐘響', lines: [
    ['jin', '出來了。比我想的快，我本來賭你撐不過第二波。'],
    ['mira', '你聽見了嗎？最後那一下，鐘在底下回了一聲。'],
    ['kol', '那個看守者叫莫葛，以前是這座塔的敲鐘人。現在他只記得一件事：誰都不准靠近鐘。'],
    ['mira', '下次看到祭司開始念咒，就打斷他們。那些咒是念給潮水聽的。']
  ] },
  kick: { title: '斷其咒語', lines: [
    ['wu', '我數了，三次！最後那個祭司的臉都歪了。'],
    ['mira', '鹽咒是在叫潮水早點回來。每打斷一次，我們就多幾秒。'],
    ['kol', '塔裡撿到的鏽鐵和鹽晶別丟。拿去工坊，做點什麼都好，我看看你的手。']
  ] },
  craft: { title: '工坊開張', lines: [
    ['kol', '手藝普通。不過能用，能用的就是好東西。'],
    ['kol', '我以前造船。船沉了以後才知道，鏽過的鐵比新鐵更認得這片海。'],
    ['jin', '聊完沒？下一趟我要在潮水回來之前出塔。三分鐘，一秒都不多給。']
  ] },
  ontime: { title: '搶在潮水之前', lines: [
    ['jin', '看到沒，三分鐘內。這才叫進塔。'],
    ['mira', '潮退得乾淨，鐘的碎片才會露出來。慢了，就只剩鏽。'],
    ['wu', '這瓶給你。蜜拉姐熬的，很苦，可是有用。'],
    ['mira', '下一趟留意地上。發紅的地方，是鐘要落下來的位置。']
  ] },
  clean: { title: '乾淨的腳步', lines: [
    ['wu', '一下都沒被砸到！你是不是看得見鐘會掉在哪？'],
    ['kol', '是他肯看地上。你也該學。'],
    ['mira', '上面這幾層只是回聲。真正的鐘在更底下，莫葛本人也是。']
  ] },
  lvl3: { title: '更深一層', lines: [
    ['n', '第三層的牆上有字，被鏽蓋住了一半。'],
    ['mira', '「鐘響，潮退。鐘停，潮來。」是莫葛的筆跡。他在這裡敲了一輩子的鐘。'],
    ['kol', '鐘不是自己沉的。架子上的榫是被人鬆開的，我看得出來。'],
    ['jin', '誰？'],
    ['kol', '不知道。先把身上的東西弄硬一點，再往下問。']
  ] },
  temper: { title: '淬火', lines: [
    ['kol', '用沉鐘碎片淬過的鐵，敲起來有鐘的聲音。你聽。'],
    ['wu', '莫葛聽到這個聲音，會不會就想起來了？'],
    ['mira', '也許。也可能他會更生氣。往下走就知道了。']
  ] },
  lvl5: { title: '鐘塔中段', lines: [
    ['n', '第五層。這裡的水是暖的，像有人剛離開。'],
    ['mog', '……鐘……還沒響……不准……過去……'],
    ['mira', '他不是在趕我們走。他在等鐘響，等到忘了自己在等什麼。'],
    ['kol', '那就把鐘湊回來，敲給他聽。'],
    ['n', '塔還有更深的地方。'],
    ['n', '這一章先寫到這裡。']
  ] }
};

const ORDER = ['prologue', 'bell', 'kick', 'craft', 'ontime', 'clean', 'lvl3', 'temper', 'lvl5'];

return { CAST, SCENES, ORDER };
});
