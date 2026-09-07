# 住宿生 Spatial Folder Archive 重構紀錄

本次依貼上的空間與互動規格實作；附件沒有包含 Reference / Current 圖片，因此尚未做與原參考圖的逐圖比對。

| 項目 | 實作與驗證範圍 |
| --- | --- |
| 1. 原本差距的原因 | 每個資料夾包含完整表單，選取後自動展開；淺色主題高不透明度白色面層重疊；預設五筆隨機資料循環複製；切線跨弧頂時把角度切換 180°；刪除 350ms 就恢復完整資料夾。 |
| 2. 重構元件 | `sfCardHTML` 現在只產生 Folder3D 幾何；新 `sfEditorHTML`、`sfMountInspector`、`sfStashInspector` 處理單一編輯器；修改既有 `sfCarousel` 與 `sfDissolve`，沒有另加第二套輪播或粒子引擎。 |
| 3. UI 層級 | Page → Header / SearchOverlay / SpatialScene（FolderRail → Folder3D）/ DetailInspector / 操作提示。粒子 Canvas 與 Bottom Navigation 保持獨立 2D 層。 |
| 4. Rail curve | `φ = φA + (index − progress + neighborGap) × STEP`，`x = cx + RX sin φ`，`z = 40 − RZ(1 − cos φ)`。手機 RX=200、RZ=300、STEP=12°；桌面 RX=700、RZ=520、STEP=8°；平板另有對應尺寸。預設完整名單，有限邊界，最多 17 個回收 DOM；單筆結果只顯示一本。 |
| 5. Tangent rotation | 對同一橢圓求導：`dx = RX cos φ`、`dz = −RZ sin φ`，`yaw = atan2(dx,dz)`。保留跨 90° 的連續角度，背面側標單獨校正，避免整本突然翻面。 |
| 6. Active extraction | 沿 +Z 抽出，手機 280px、平板 360px、桌面 430px，少量向左／向上移動，朝向漸轉到 18°。先讓位，再用欠阻尼彈簧抽出與收斂，約 680ms。手動 scale 只到 1.03；更大的視覺尺寸來自透視。額外測試檢查選中面板最遠端深度，確實越過鄰居旋轉後的近側邊緣。 |
| 7. Folder 厚度 | 橫式寬高比 1.55；back −18px、paper −9px、front 0px、edge +2px；左右 spine 轉 90° 連接前後板，另有頂面與房號 tab。Inspector 不在此結構中。 |
| 8. 材質 opacity | 非選中 front 0.045、paper 0.025；back 0.05–0.09。Active front 0.05–0.12；紫色背層 0.05–0.12；輪廓高光最高約 0.78。深淺主題共用深色 archive 舞台，避免淺色模式變成白牆。 |
| 9. 重疊曝光 | 移除高填色淺色面板、收斂反光、紙上線條及側邊亮度；面板不用 additive blend，active front 不使用 backdrop blur。保留黑色舞台、曲線縱深與輪廓。場景使用 `overflow:clip`，移除 paint containment；Folder 根節點維持 preserve-3d。 |
| 10. Drag / snap | 滑鼠、touch、橫向 trackpad 更新浮點 progress，以 RAF 寫各 Folder transform；速度投影決定最近目標，阻尼彈簧吸附。Trackpad 停止判定使用同一 RAF 時鐘。首尾限制、方向鍵及 Enter/Space 操作保留，沒有逐幀 React render。 |
| 11. Detail Editor | 僅主動開啟；Folder 先前移與讓出閱讀空間，150ms 後 Inspector 出現。桌面側邊浮動，手機固定下方且最高 40dvh，可捲動；保持底部導覽安全距離。Escape／關閉按鈕收合，欄位有 label、草稿依 student id 保存，搜尋與回收不丟內容。 |
| 12. Dissolve mask | 用資料夾樣式快照建立 raster，刪除時由同一 raster 接替本體。每個 2px cell 的門檻為 `(width − x)/width + noise(x,y)×0.09`。80–500ms 推進，同門檻清除此 cell 的 alpha 並釋放粒子。一次 ImageData 更新取代大量 clearRect 呼叫。 |
| 13. Texture sampling | 選取完成時預先複製 DOM 計算樣式，經 SVG foreignObject rasterize；快取讀取的 RGBA。從 alpha 非零像素取樣位置與顏色，再以 Folder 矩陣與場景 perspective 投影到粒子 overlay。這是計算樣式的平面 raster 快照，並非直接擷取瀏覽器完整 3D compositor 的畫面；前後板的深度仍由正常瀏覽時的 DOM 幾何呈現。 |
| 14. Particle 數量 | 桌面 2,400；手機 1,300，回報 CPU 執行緒 ≤4 的手機 1,000；預配置容量 4,000。70% 1–2px、20% 2–3px、8% 3–4px、2% 4–5px。每幀不建立上千個物件或 DOM，降負載優先简化切向力，保留密度。 |
| 15. Black Hole preload | DOMContentLoaded 初始化 Canvas、WebGL context、兩支 shader program、VBO 與 typed arrays，實際試畫粒子／黑洞並 flush。沒有 WebGL 時使用 Canvas 2D；shader 建立失敗時也換新 Canvas 以正確啟用 2D。 |
| 16. 第一次刪除 | 選取或編輯時預備 texture，Delete 重用 renderer／buffer；只有失效的 texture 需要重新準備。所有消散、引力、漩渦與黑洞縮退由同一 RAF timeline 推進。事件視界使用線段碰撞，避免高速粒子穿越核心。瀏覽器合成資料測試有第一輪啟動與時間限制；未宣稱實機零掉幀。 |
| 17. 刪除／補位 | 約 580ms 開始鄰居收攏，消散／黑洞結束才清空資料，取消／離頁會恢復本體並保留草稿。**保留既有「清空床位草稿，按儲存修改才同步」語意**：床位不從總表移除，所以原位置呈現空床，仍選中該床以便儲存，不切去右邊另一位住宿生。這與規格中「真正移除 item 後選右側」不同，是為了保留現有床位 CRUD／儲存流程。 |
| 18. 修改檔案 | `app.js`、`carousel.js`、`dissolve.js`、`folder.css`、`index.html`、`sw.js`、`package.json`、`package-lock.json`、`.gitignore`、`eslint.config.mjs`、`tests/ui.cjs`、`tests/archive.cjs`、`tests/build.cjs` 與此紀錄。資源版本 100、離線快取 biyuan-v60。 |

驗證指令：`npm run check`、`npm run lint`、`npm run build`、`npm test`、`npm run test:archive`；另以 TEST_DESKTOP、TEST_WEBKIT、TEST_OFFLINE 執行既有 UI／離線測試。

專案是原生 JavaScript，沒有 TypeScript 型別模型。`check` 用 TypeScript 編譯器檢查 JS 解析／編譯（allowJs、noEmit、checkJs=false），不是完整靜態型別驗證；lint 與 Chromium / WebKit 行為測試補足實際功能檢查。所有寫入測試都攔截 API 並使用合成資料。

手機 viewport 模擬和 headless WebKit 不等同 iPhone 實機 FPS。細粉塵、SVG rasterize 與透明 3D 層在實機 Safari 的流暢度仍需實機驗收；原始參考圖未提供，尚不能宣稱逐圖一致。
