# 維護與驗證

正式前端為 https://raw-air.github.io/-/，Pages 來源為 `Soft-UI` 分支根目錄。此版本為資源 v91、Service Worker v55。

## 本次修正

- 擷取時將表單的 3D 堆疊攤平，解決輸入框黑色矩形；固定背景頁面的進場動畫，避免 WebKit 擷取到透明背景。正常介面的陰影與立體效果保留。黑洞期間導覽列維持真正的玻璃材質。
- carousel.js 以 Touch Events (觸控) 與 Mouse Events (桌面) 驅動同一個手勢狀態機，不用 Pointer Events：iOS Safari 在可直向捲動的頁面上做水平拖曳時會送出 pointercancel (w3c/pointerevents#303)。touchmove 只在判定為水平手勢後才 preventDefault。名單有邊界 (sfStudentAt 超出範圍回 null、拖過頭橡皮筋回彈)。卡片是立體扇形排列：離中心越遠越往中間擠 (NEAR_PULL/FAR_PULL)、rotateY 越大、translateZ 越深；每張卡只在值真的變了才寫 style。進出 3D 模式的 0.8 秒內改用 CSS 過渡走位 (smoothUntil)，其餘時間逐幀直接寫值才跟得上手指。
- theme.js 在 View Transition 建立前，把開關中心以「實際像素」寫進 <style id="theme-reveal-style"> 的 @keyframes (iOS WebKit 對 ::view-transition 偽元素上的 var() 解析不可靠)，並加 html.vt-active 讓快照期間關掉毛玻璃 (快照成本大降)，ready 後移除。方向：開全白時新畫面從開關擴散 (theme-reveal)，開深色時舊畫面往開關縮回 (theme-shrink，動 ::view-transition-old 並把它疊到上層)。WebKit 動畫時間停在零時以計時器推進。
- navigation.js / liquid-nav.css 將底部導覽做成 iOS 26 液態玻璃：浮動膠囊 + 一顆 84×54 的橢圓鏡片。鏡片內是導覽列圖示的複本放大 1.12 倍並橢圓裁切 (跨瀏覽器折射)；--lens-x 以 @property 註冊為 <length>，鏡片、光暈、複本列、真實列上的 mask 洞全部由它驅動。鏡片可按住拖曳；is-dragging 的 transition:none 必須同時寫深色與 body.light-mode 兩個選擇器，否則淺色模式權重較高會讓鏡片還在跑過渡、拖起來不跟手。
- 數字動畫使用各自的清理權限，修正舊動畫揭露新數字、容器邊框偏移、字寬度量與 WebKit 文字隱藏。
- 個人化設定 (mute_sound/mute_haptic/white_mode/panzi_mode/power_save_mode) 走 app.js 頂端的 prefs 層：localStorage 為主，setPref() 同步備份到 cookie biyuan_prefs 與 IndexedDB biyuan/prefs，開機時缺值才從備援補回 (cookie 同步、IndexedDB 非同步後 applyStoredPrefs 再套一次)，並呼叫 navigator.storage.persist()。
- 黑洞重做成「行星般的 3D 物體」：gravity.js 仍是 two-pass GPU 合成（一個 render target、一次全螢幕 pass）。螢幕 shader 用正交視線與傾斜盤面求交點畫吸積盤——傾斜軸 −45°（畫面上長軸左高右低）、俯視傾角使可見橢圓短軸/長軸 = 0.42、外緣 4.3 倍陰影半徑；依交點的 z 判斷盤在球體前或後，前半（偏下）蓋住球體下緣、後半被球體擋住，再用半徑反演把被擋住的後半盤翻到球體上方成一道弧。盤面有差動旋轉的 fbm 細絲與無接縫旋臂、內緣熱白外緣橘紅、上下兩層取樣做出厚度，都卜勒讓往觀察者轉的那半更亮更白。中央是純黑事件視界加一圈細光子環。這是視覺近似，不是廣義相對論數值模擬。
- 卡片先撕成 216 片不規則三角形，碎片半途化為粉塵（每片配 5／10 顆，顏色依該碎片的 UV 從卡片貼圖取樣），粉塵沿盤面平面螺旋落入視界；另有 600／1300 顆從畫面外側沿盤面飛入的粒子流，亮度隨速度、點大小遞減。手機端粒子總數約 1,680 顆。黑洞登場時背景亮度降到 0.35 並加暗角，塌縮時回亮。擷取時記錄 activeCard 左右鄰卡的 rect（最多 4 個，未用的填 0），螢幕 shader 在矩形內加 ±2–4px 的高頻位移並微微往黑洞方向拉伸，看起來像鄰卡在抵抗引力。
- 成形速度：html2canvas 一律複製整份文件，所以擷取時用 ignoreElements 砍掉用不到的子樹（卡片貼圖只留卡片本身，背景只留目前分頁、看得到的卡片），卡片 scale ≤ 1.5、手機背景 scale 1；擷取時間約降到原本的 1/4。按下垃圾桶後先用 CSS 先遣層（.bh-seed，位置／半徑／傾角與 WebGL 場景一致）讓黑洞在 0.3 秒內成形並把畫面壓暗，WebGL 場景備妥後直接接手；動畫時鐘從按下算起（最多補 0.5 秒），整段 3.4 秒。
- 效能：DPR ≤ 1.5、render target ≤ 1.4M 畫素、每幀零配置（只寫 uniform 的 .value），引力震動與變暗係數改在 CPU 算好傳進去；雜訊 hash 不用 sin，鄰卡顫抖的方向與強度在建場景時先算好。前十幾幀量一次真正的畫面間隔，太慢就一次性把解析度降一階（只重配一次）。動畫結束或取消時釋放 texture、material、geometry、render target 與 WebGL context；先遣層在 finally 一併移除。
- import.js 是設定頁的「匯入 Excel 名單」精靈：用 CDN 的 SheetJS 讀 xlsx/xls/csv (csv 沒 UTF-8 BOM 又不是合法 UTF-8 時以 Big5/950 解碼)，標題模糊比對 (先完全相同再包含、同欄不重複、「區號」不當地址)，房號+床位對到 state.students (略過 hidden 的床)，沒姓名也沒學號視為空床。寫入走與 autoSaveStudentFile 相同的 updateAttendance payload、每批 15 筆循序送，備註只附加不覆蓋。window._importRows(rows,mapping,options) 讓測試不用真檔案。
- 住宿生檔案名單是環狀的，名單少於 13 人時同一人會同時出現在多張卡：sfSaveDraft 在回收「沒改過」的卡時，若同一人的另一張卡已被改動就不清草稿；sfBindCard 綁新卡時會拿另一張卡的即時內容當初始值 (sfLiveDraft)。
- 震動設定「開啟代表啟用」。Android 走 Vibration API；iPhone Safari 沒有該 API，改用兩條路：(1) 程式點擊隱藏的 <input type="checkbox" switch> label 觸發 Taptic (iOS 17.4~26.4 有效，26.5 起 Apple 已封鎖)；(2) 低頻喇叭波形 (Web Audio) 讓機身共振，即舊版使用者感受到的「震動」。按鍵音效附帶的回饋只敲 Taptic 不播波形。
- 宿舍參數保留零床數、拒絕非整數及負總床數；設定儲存失敗不留下錯誤的本地成功狀態。
- HTTP 失敗不再誤報成功；請求有逾時，寫入不自動重播以避免重複交換床位。輪詢不重疊。備份與卡片儲存不覆蓋傳送途中新增的修改。
- 備註儲存失敗會回報。清快取只清本應用；更新 Service Worker 不強制重整正在填寫的表單。黑洞依賴隨前端部署及離線快取。

垃圾桶延續原有「清空表單後按儲存修改」的操作。動畫結束會保存清空草稿並提示，動畫不自行寫入正式住宿生資料。

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

測試使用合成住宿生及攔截 API，不對正式資料寫入。涵蓋設定事件處理器、震動開關、簡潔/省電模式、首次擴散實際前進、連續主題切換、舊版主題備援、連續數字動畫、跨位數/負數、參數驗證、欄位起手滑動、彈簧收斂、跨回收池草稿保留、黑洞背景非空白、黑洞/星芒、動畫取消、傳送中編輯保留、備份競態、HTTP 失敗、離線殼層及白色主題重新載入後的導覽圖示。

已於 Chromium/WebKit 的 390×844 及 WebKit 1440×1000 驗證；截圖產生於忽略版控的 `test-results/`。WebKit 桌面模擬不等於 iPhone 實機，未宣稱全機型達到固定 FPS；震動硬體與真實手機滑動仍需實機確認。管理員建庫、正式密碼變更及 Excel 實際下載不在本次真實後端測試範圍。

## 後續發布

1. 確認工作區、fetch 遠端並檢查差異，保留他人的修改。
2. 完成修改及測試，同步增加 index.html 資源 query 版本、sw.js 快取版本與資源清單。
3. commit 並正常 push 到 `origin/Soft-UI`，不得 force push。
4. 用 GitHub Pages 建置狀態及線上資源確認新 commit 已發布。

本次原先引用的 RTK.md 未隨專案提供；新增的 RTK.md 記錄本次確認的部署方式及使用者授權，並非舊規範的復原副本。
