# 手修用的檔案（Aseprite）

蜜拉的「閉眼笑」（darkgrin）和「往旁邊瞄」（darkside）是雲端用像素直接改出來的，已經放進遊戲。想再修的話，用 Aseprite 直接打開 PNG 就能改，不用轉檔。

## 修小地方：直接改遊戲用的檔案（建議）

遊戲讀的是這四張，改完存檔（同檔名、PNG）就生效：

- `art/mira/portrait_darkgrin.png`：閉眼笑
- `art/mira/portrait_darkside.png`：往旁邊瞄
- `art/mira/portrait-shawl_darkgrin.png`：閉眼笑（披肩）
- `art/mira/portrait-shawl_darkside.png`：往旁邊瞄（披肩）

這四張已經蓋好陰影。修的時候用 Alt 吸旁邊已經變暗的顏色，就會跟陰影一致。一般版和披肩版的臉是一樣的，一張改好之後，可以把臉的那幾格框起來複製到另一張的同一個位置。

## 改很多：改沒有陰影的底稿

這個資料夾裡的四張是同樣的臉，但還沒有蓋陰影，顏色比較好看清楚：

- `darkgrin_base.png`、`darkgrin_shawl_base.png`
- `darkside_base.png`、`darkside_shawl_base.png`

改完推上分支，跟雲端說一聲，雲端會用 `tools/mira-shadow.py` 重新蓋陰影，再換掉遊戲用的那四張。

## Aseprite 設定

- 鉛筆工具，打開 Pixel-perfect
- 尺寸保持 192 × 256、透明背景，不要縮放
- 只改眼睛附近，頭髮和衣服一格都不要動

遊戲不會讀這個資料夾。
