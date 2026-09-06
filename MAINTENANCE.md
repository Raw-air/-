# 維護與驗證

正式前端為 https://raw-air.github.io/-/，Pages 來源為 `Soft-UI` 分支根目錄。此版本為資源 v88、Service Worker v52。

## 本次修正

- 黑洞由 gravity.js 執行 two-pass GPU 合成：一次擷取周圍畫面及卡片，透鏡同時扭曲背景卡片、搜尋列和碎片。216 片不規則三角形依距離撕裂、潮汐拉伸並旋入黑洞；保留吸積盤、光子環、850／1400 顆軌道粒子、引力畫面震動、塌縮與四芒星收尾。這是視覺近似，不是廣義相對論數值模擬。
- 擷取時將表單的 3D 堆疊攤平，解決輸入框黑色矩形；固定背景頁面的進場動畫，避免 WebKit 擷取到透明背景。正常介面的陰影與立體效果保留。黑洞期間導覽列維持真正的玻璃材質。
- 移除每幀移動 body 的效果，限制 framebuffer 像素量，保留卡片貼圖、玻璃、陰影及吸積盤效果；動畫結束或取消時釋放 texture、material、geometry 與 WebGL context。
- carousel.js 使用 Pointer Events、每幀一次更新及單段阻尼彈簧吸附，保留 13 張卡片回收池與鄰卡景深。未聚焦欄位可起手滑動，聚焦欄位保留文字選取；直向手勢維持原生捲動，首尾有邊界回彈。卡片不再循環重複，避免回收池覆蓋同一住宿生的草稿；離開頁面停止移動。
- theme.js 在 View Transition 建立前設定開關中心與 CSS 圓形動畫。針對 WebKit 動畫時間停在零的情況，以計時器推進同一動畫；連續切換只採用最後選擇。圖示使用同一素材以 CSS 變色，避免首次切換重新下載。無 View Transition 的瀏覽器使用底色圓形擴散及淡出備援。
- navigation.js / motion.css 將底部導覽改為黑色浮動膠囊與滑動凸透鏡，支援鍵盤及 aria-current。Chromium 使用位移貼圖折射，其他瀏覽器使用原生背景模糊與光學邊緣；這是參考圖的網頁實作，不是 Apple 原生材質 API。
- 數字動畫使用各自的清理權限，修正舊動畫揭露新數字、容器邊框偏移、字寬度量與 WebKit 文字隱藏。
- 震動設定改為「開啟代表啟用」，初始化與持久化一致。移除以喇叭音冒充震動的路徑。iPhone Safari 不支援網頁 Vibration API。
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
