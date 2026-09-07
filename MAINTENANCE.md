# 維護與驗證

正式前端為 https://raw-air.github.io/-/，Pages 來源為 `Soft-UI` 分支根目錄。此版本為資源 v97、Service Worker v59。

## 本次修正

- carousel.js (v30.5 重寫) 是「透明壓克力資料夾陣列」：DOM 仍是 app.js 的 13 本回收池 (_sfPool / sfSyncWindow / sfStudentAt 取模、無限循環)，但排列改成 perspective 1500px / perspective-origin 34% 40% + preserve-3d 的「斜向空間軌道」：整排資料夾同一個朝向 (rotateY −24°，左右不鏡像、不是 cover flow)，沿一條往右後方 44° (手機 52°) 延伸的直線排列，只有 X / Z 不同。大小完全由透視決定，不用 scale。軌道參數 u = soft(d)：遠端 (d≥0) 線性，近端 (d<0) 指數飽和 (nearX 2.4 / nearZ 0.5)，否則往前會衝到鏡頭前爆掉、還會擋住抽出來的那本。x = u × rail × cos44° + offset (rail 桌機 200 / 平板 150 / 手機 95)；z = −u × rail × sin44°；rotateY = −24° + min(|d|,9) × 0.34°；透明度兩端都淡到 0 才離開視窗 (回收換人不會跳出來)。offset 是解出來的：讓抽出那本剛好落在畫面寬度的 27% (手機 42%，太靠左會被切掉)。整排 z 從 +155 一路退到 −1800，透視倍率 1.12 → 0.45。離中心 ≥46% / ≥74% farVisible 切 fd-blur1/2 兩段固定模糊 (切 class 不逐幀寫 filter)。右側那排只露出右邊一條，所以每本右緣有一條直式側標 (.fd-rail-label，像檔案背脊)、右上角另有一個小標籤 (.fd-tab-r)，抽出那本改顯示完整摘要；資料紙 (.fd-sheet) 用 --fd-counter-yaw 反轉回來正對使用者。手勢層沿用 Touch Events + Mouse Events (不用 Pointer Events，iOS Safari 在可直向捲動的頁面做水平拖曳會送 pointercancel，w3c/pointerevents#303；touchmove 只在判定為水平後才 preventDefault)，另加觸控板橫向 wheel (連續跟手，停 120ms 吸附) 與滑鼠滾輪一格一本 (頁面本身不需捲動時才接管)、方向鍵、Enter/Esc。拖曳時逐幀直接寫 transform (put() 只在值變了才寫 style)，放手用臨界阻尼彈簧 (omega 19，含初速度) 吸到最近一本；一個 rAF 迴圈 tick() 推進全部子動畫 (拖曳、彈簧、抽出、進場、開紙)，狀態機 idle / dragging / snapping / extracting / entering / locked，不用 setTimeout 疊時間軸。拖一個虛擬索引 = 中央那本在畫面上實際走的 px (measure() 用同一組投影公式算出來，桌機約 148 / 手機約 52)，手指 1:1 帶著它走。DOM 回收池加大到 17 本、視窗不對稱 (近端 3 本、深處 13 本)。
- 抽出動畫 (startExtraction)：吸附完成後 ext 時間軸 0.68s — 鄰居先沿軌道讓開 0.14 本 (0–160ms，outCubic)、中央那本 60ms 後沿欠阻尼彈簧 (ζ .62、ω 13，0.3s 衝過頭 8%) 離開軌道往鏡頭 +155px (手機 +122)、y −18、再往左 26px，角度只從 −24° 校正到 −16° (不轉正 — 要看起來像「從一整疊裡抽出來」，不是「中間那張轉過來面向我」)、scale 脈衝 +3%；拖曳一開始就用 160ms 把它塞回去 (pushBack，從目前值接續，不跳回 0)。進場 (sfCarousel.enter)：整排先擠在中央 (x 收到 35%、z −120、rotateY −20°、透明)，每本延遲 30ms×距離、380ms outQuint 展開，中央那本 0.36s 到位就開始抽出，總長約 1 秒；prefers-reduced-motion 直接靜態擺好。
- 詳細資料紙 (.fd-sheet)：表單放在每本資料夾裡但只有 .is-open 那本會顯示 (其餘 content-visibility:hidden、visibility:hidden，值照樣讀寫，草稿邏輯 sfReadCard/sfSaveDraft/sfLiveDraft 不變)。吸附+抽出完成 140ms 後自動打開 (scheduleOpen)，點中央那本切換、開始拖曳就收。打開時資料夾往下讓位：sheetShift() 用透視公式 (根節點在 z=zActive、紙再 +40、透視原點 50%/44%) 算出讓紙頂端留 12px、資料夾底部也留 12px 的位移，塞不下就把紙的下緣插深一點 (--fd-overlap)。
- theme.js 在 View Transition 建立前，把開關中心以「實際像素」寫進 <style id="theme-reveal-style"> 的 @keyframes (iOS WebKit 對 ::view-transition 偽元素上的 var() 解析不可靠)，並加 html.vt-active 讓快照期間關掉毛玻璃 (快照成本大降)，ready 後移除。方向：開全白時新畫面從開關擴散 (theme-reveal)，開深色時舊畫面往開關縮回 (theme-shrink，動 ::view-transition-old 並把它疊到上層)。WebKit 動畫時間停在零時以計時器推進。
- navigation.js / liquid-nav.css 將底部導覽做成 iOS 26 液態玻璃：浮動膠囊 + 一顆 84×54、圓角 27px 的長條鏡片 (跟膠囊同形狀)。鏡片內是導覽列圖示的複本放大 1.12 倍並以同樣圓角裁切 (跨瀏覽器折射)；--lens-x 以 @property 註冊為 <length>，鏡片、光暈、複本列、真實列上的 mask 洞全部由它驅動 (那一列只有圖示與文字、沒有底色，所以洞用一條直向的 linear-gradient 就夠，不必做出膠囊形狀)。鏡片可按住拖曳；is-dragging 的 transition:none 必須同時寫深色與 body.light-mode 兩個選擇器，否則淺色模式權重較高會讓鏡片還在跑過渡、拖起來不跟手。
- 數字動畫使用各自的清理權限，修正舊動畫揭露新數字、容器邊框偏移、字寬度量與 WebKit 文字隱藏。
- 個人化設定 (mute_sound/mute_haptic/white_mode/panzi_mode/power_save_mode) 走 app.js 頂端的 prefs 層：localStorage 為主，setPref() 同步備份到 cookie biyuan_prefs 與 IndexedDB biyuan/prefs，開機時缺值才從備援補回 (cookie 同步、IndexedDB 非同步後 applyStoredPrefs 再套一次)，並呼叫 navigator.storage.persist()。
- 刪除動畫 (dissolve.js)：Telegram 式高密度粉塵 + 微型黑洞吸入，用自己寫的 WebGL (兩支很小的 shader：gl.POINTS 粉塵 + 一個 quad 的黑洞)，沒有 three.js、沒有 html2canvas、不截圖。時間軸連續、沒有等待階段：0ms 資料夾 scale .985、邊緣亮一下、收掉光暈 (fd-dissolving) → 50ms 黑洞淡入 (只是改 uniform) → 80–520ms 一條帶雜訊的邊界從資料夾右緣 (垃圾桶那側) 往左掃，每一層 (back/paper/front/edge/sheet) 各自套 radial-gradient mask-image (原點換算成該層本地座標、除以該層投影倍率) 同步消失，同一位置生出粉塵 → 粉塵先照原速飄 30–64ms，再受引力 a = GM/(d²+soft) (GM 1.8e9、soft 100²、加速度上限 14000 px/s²、速度上限 2600 px/s) 加上切向分量 30000/(d+70) 拉成弧線與螺旋 → 進入事件視界 (0.95 × 黑洞半徑) 先亮一下再縮到 0 → 350ms 資料夾就以「空床」長回來 (resetFields + materialize)，跟還在飛的粉塵重疊 → 最後一批吃完後黑洞 scale 1 → .15 淡出，約 0.95s 結束。黑洞大小是資料夾寬度的 13% (22–56px)、位置在資料夾右上方 (粒子要有一段看得見的流線，不能一生出來就被吃掉)。粉塵顏色不是取樣像素，是依格子落在哪個區塊給 (玻璃白／銀／薰衣草／紫／洋紅／文字／輸入框／內頁，深淺主題兩套色)，七成 1–2.8px、兩成 2.6–4.4px、一成 3.6–5.4px 亮碎片。取消 (切頁、背景) 會還原遮罩、不清欄位。
- 效能：canvas、WebGL context、兩支 shader、VBO 與 4000 顆的 typed-array 粒子池全部在頁面載入時就建好，而且真的畫一次再清掉 (warmUp) — shader 這時就上 GPU 了，按下垃圾桶只是改 uniform 與開始寫 buffer，第一次刪除不會頓。目標粒子數：桌機 2600、平板 1800、手機 1100，再乘上裝置學到的密度 quality (連續兩幀 >22ms 就 ×.8 或 ×.65、最低 .5，之後每 spawnSkip 顆略過一顆生成；已經生出來的不動，畫面才不會突然變稀；下一場開始前回升 .12)。每幀零配置：狀態放 Float32Array，只 bufferSubData 存活的那一段，一個 drawArrays(POINTS) 畫完。canvas DPR 壓在 3.2MP 以內。沒有 WebGL 就退回 Canvas 2D (同一套物理，只換畫法)。消散期間該本拿掉 backdrop-filter / 光暈 / 濾鏡 (換較實的底色)，否則每幀改遮罩都要重算毛玻璃；補位後 restore() 會把 released 設起來停掉後續遮罩寫入，長回來的資料夾才不會又被吃掉。輪播：will-change 只給離中心 −1.6~2.6 本 (fd-near)，backdrop-filter 只有 active 那本且拖曳中 (sf-moving) 關掉。實測 (headless 軟體算圖，真機有 GPU 只會更好)：手機 390×844 生出 1367 顆、桌機 1440×1000 2664 顆、WebKit 2013 顆，峰值都是全部同時存活。
- 資料夾 DOM (sfCardHTML) 是有真實 Z 深度的多層殼 (厚度 --fd-depth 18px)：.fd-back (背板，z −18，選中時 ::after 染紫→洋紅並加光暈)、.fd-tab / .fd-tab-r (左右兩個房號標籤，跟背板同深度)、.fd-spine ×2 (左右側邊：translateZ(−18) 再 rotateY(±90°)，剛好把前板與背板之間補起來 — 只 rotateY 會讓厚度長在玻璃前面)、.fd-top (頂面，rotateX(−90°)，鏡頭在上方所以看得到)、.fd-paper (內頁，z −9)、.fd-front (前板玻璃，z 0，斜向反光 + 直式側標，只有 active 加 backdrop-filter)、.fd-edge (z +2 的 1.5px 邊緣高光)、.fd-sheet。根節點不設 opacity/filter/overflow (會把 6 層壓平)，透明度走 --fd-alpha 由各層自己吃；橫式 440×284 (手機 clamp(280, 寬−84, 420))。字色：資料夾面是白玻璃所以兩個主題都用深色字 (--fd-text)，紙在深色主題是暗玻璃用淺色字 (--fd-sheet-text)。摘要 (名字/班別/標籤/學號) 由 sfSummary 產生，儲存與清空後 sfUpdateSummary 回寫。
- 導覽列鏡片的色散：lens-fringe 內放兩份圖示複本，各染青/洋紅並左右偏 2.5px，用 radial 遮罩只留邊緣、mix-blend-mode:screen；lens-rim::after 再疊一圈 conic-gradient 彩虹環。
- import.js 是設定頁的「匯入 Excel 名單」精靈：用 CDN 的 SheetJS 讀 xlsx/xls/csv (csv 沒 UTF-8 BOM 又不是合法 UTF-8 時以 Big5/950 解碼)，標題模糊比對 (先完全相同再包含、同欄不重複、「區號」不當地址)，房號+床位對到 state.students (略過 hidden 的床)，沒姓名也沒學號視為空床。寫入走與 autoSaveStudentFile 相同的 updateAttendance payload、每批 15 筆循序送，備註只附加不覆蓋。window._importRows(rows,mapping,options) 讓測試不用真檔案。
- 住宿生檔案名單是環狀的，名單少於 13 人時同一人會同時出現在多張卡：sfSaveDraft 在回收「沒改過」的卡時，若同一人的另一張卡已被改動就不清草稿；sfBindCard 綁新卡時會拿另一張卡的即時內容當初始值 (sfLiveDraft)。
- 震動設定「開啟代表啟用」。Android 走 Vibration API；iPhone Safari 沒有該 API，改用兩條路：(1) 程式點擊隱藏的 <input type="checkbox" switch> label 觸發 Taptic (iOS 17.4~26.4 有效，26.5 起 Apple 已封鎖)；(2) 低頻喇叭波形 (Web Audio) 讓機身共振，即舊版使用者感受到的「震動」。按鍵音效附帶的回饋只敲 Taptic 不播波形。
- 宿舍參數保留零床數、拒絕非整數及負總床數；設定儲存失敗不留下錯誤的本地成功狀態。
- HTTP 失敗不再誤報成功；請求有逾時，寫入不自動重播以避免重複交換床位。輪詢不重疊。備份與卡片儲存不覆蓋傳送途中新增的修改。
- 備註儲存失敗會回報。清快取只清本應用；更新 Service Worker 不強制重整正在填寫的表單。粉塵與黑洞不依賴任何外部程式庫 (three.js 與 html2canvas 已移除，改用兩支自寫的小 shader)。

垃圾桶延續原有「清空表單後按儲存修改」的操作：粒子散完才保存清空草稿並提示，動畫不自行寫入正式住宿生資料。床位本身不會從名單消失，同一本資料夾會以「空床」長回來。

## 測試

```powershell
npm ci
npx playwright install chromium webkit
npm test
$env:TEST_WEBKIT='1'; node tests/ui.cjs
$env:TEST_DESKTOP='1'; node tests/ui.cjs
Remove-Item Env:TEST_WEBKIT, Env:TEST_DESKTOP
$env:TEST_OFFLINE='1'; node tests/ui.cjs
Remove-Item Env:TEST_OFFLINE
```

測試使用合成住宿生及攔截 API，不對正式資料寫入。涵蓋設定事件處理器、震動開關、簡潔/省電模式、首次擴散實際前進、連續主題切換、舊版主題備援、連續數字動畫、跨位數/負數、參數驗證、進場後自動開紙、橫式六層資料夾與側轉鄰居、抽出到 z 前方、資料夾正面起手滑動、彈簧收斂後重新開紙、跨回收池草稿保留、刪除 250ms 內開始畫粒子且 DOM 同步遮罩、清空成草稿不打 API、長回來後再開紙、儲存後摘要同步、動畫取消、傳送中編輯保留、備份競態、HTTP 失敗、離線殼層及白色主題重新載入後的導覽圖示。

已於 Chromium/WebKit 的 390×844 及 WebKit 1440×1000 驗證；截圖產生於忽略版控的 `test-results/`。WebKit 桌面模擬不等於 iPhone 實機，未宣稱全機型達到固定 FPS；震動硬體與真實手機滑動仍需實機確認。管理員建庫、正式密碼變更及 Excel 實際下載不在本次真實後端測試範圍。

## 後續發布

1. 確認工作區、fetch 遠端並檢查差異，保留他人的修改。
2. 完成修改及測試，同步增加 index.html 資源 query 版本、sw.js 快取版本與資源清單。
3. commit 並正常 push 到 `origin/Soft-UI`，不得 force push。
4. 用 GitHub Pages 建置狀態及線上資源確認新 commit 已發布。

本次原先引用的 RTK.md 未隨專案提供；新增的 RTK.md 記錄本次確認的部署方式及使用者授權，並非舊規範的復原副本。
