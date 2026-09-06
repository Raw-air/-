# 維護與驗證

正式前端為 https://raw-air.github.io/-/，Pages 來源為 `Soft-UI` 分支根目錄。此版本為資源 v89、Service Worker v53。

## 本次修正

- 黑洞由 gravity.js 執行 two-pass GPU 合成：一次擷取周圍畫面及卡片，透鏡同時扭曲背景卡片、搜尋列和碎片。216 片不規則三角形依距離撕裂、潮汐拉伸並旋入黑洞；保留吸積盤、光子環、850／1400 顆軌道粒子、引力畫面震動、塌縮與四芒星收尾。這是視覺近似，不是廣義相對論數值模擬。
- 擷取時將表單的 3D 堆疊攤平，解決輸入框黑色矩形；固定背景頁面的進場動畫，避免 WebKit 擷取到透明背景。正常介面的陰影與立體效果保留。黑洞期間導覽列維持真正的玻璃材質。
- 移除每幀移動 body 的效果，限制 framebuffer 像素量，保留卡片貼圖、玻璃、陰影及吸積盤效果；動畫結束或取消時釋放 texture、material、geometry 與 WebGL context。
- carousel.js 以 Touch Events (觸控) 與 Mouse Events (桌面) 驅動同一個手勢狀態機，不用 Pointer Events：iOS Safari 在可直向捲動的頁面上做水平拖曳時會送出 pointercancel (w3c/pointerevents#303)，即使設了 touch-action:pan-y。touchmove 在判定為水平手勢時立即 preventDefault，直向手勢仍交給原生捲動。每幀一次更新、單段阻尼彈簧吸附、13 張回收池、未聚焦欄位可起手滑動等行為不變。
- theme.js 在 View Transition 建立前，把開關中心以「實際像素」寫進 <style id="theme-reveal-style"> 的 @keyframes (iOS WebKit 對 ::view-transition 偽元素上的 var() 解析不可靠，會從左上角擴散)，ready 後再用 WAAPI 以同樣像素驅動同一個圓作保險；WebKit 動畫時間停在零時以計時器推進；連續切換只採用最後選擇；無 View Transition 的瀏覽器使用底色圓形擴散及淡出備援。
- navigation.js / liquid-nav.css 將底部導覽做成 iOS 26 液態玻璃：浮動膠囊 (淺色白、深色深玻璃) 加一顆清透鏡片。鏡片內放一份導覽列圖示的複本並放大 1.12 倍、以圓形裁切，得到跨瀏覽器 (含 iOS Safari) 的放大折射；邊緣亮環、粉/藍色散、粉色光暈以 box-shadow 與漸層疊出；切換分頁時鏡片以 transform 拉長再彈回。這是參考圖的網頁實作，不是 Apple 原生材質 API。
- 數字動畫使用各自的清理權限，修正舊動畫揭露新數字、容器邊框偏移、字寬度量與 WebKit 文字隱藏。
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
