# 碧苑宿舍點名系統 - 部署指南 v2

## 架構概覽

```
CSV 點名單 → Worker /setup 精靈 → Notion 點名總表（128 日期欄位）
                                      ↕
前端 Web App ← Worker API → Notion 直接讀寫
```

## 步驟 1：部署 Worker

1. 進入 Cloudflare Dashboard → Workers
2. 將 `worker/index.js` 的內容貼到 Worker 編輯器
3. 設定環境變數：
   - `NOTION_TOKEN`：你的 Notion Integration Token

## 步驟 2：初始化資料庫（使用 Setup 精靈）

1. 開啟 Worker 網址（如 `https://biyuan-proxy.s010828.workers.dev/setup`）
2. 輸入 Notion 父頁面 ID
3. 上傳 CSV 點名單（114-2碧苑點名單.csv）
4. 按「開始」→ 精靈會自動：
   - 建立「碧苑點名總表」資料庫（含所有日期欄位）
   - 建立「系統設定」資料庫
   - 匯入全部學生（含自動補齊缺失的床位）
5. 複製精靈顯示的兩個 ID

## 步驟 3：設定環境變數

回到 Cloudflare Worker，新增：
- `MASTER_DB_ID`：點名總表的 ID
- `CONFIG_DB_ID`：系統設定的 ID

## 步驟 4：部署前端

上傳這些檔案到 GitHub（GitHub Pages）：
- `index.html`
- `style.css`
- `config.js`
- `api.js`
- `app.js`
- `manifest.json`
- `sw.js`
- `icon-192.png`
- `icon-512.png`

## 步驟 5：設定 GitHub Pages

Settings → Pages → Source: `main` → Save

## 使用方式

### 每日點名
1. 首頁選擇中隊
2. 點擊學生切換狀態：✓（在）→ ◎（請假）→ ✘（未到）
3. 點「提交」

### 總表
- 會自動計算當天的全校數據
- 用 ◄ ► 切換日期

### 歷史
- 月曆格式瀏覽
- 點擊有資料的日期查看詳情

### 匯出
- 設定頁面 → 匯出 Excel
- 還原原始 CSV 格式（含所有日期欄位）

---

## 步驟 6：將附屬 API (請假/報修/意見回饋) 部署到 Cloudflare
如果希望全宿舍都能共享請假、報修、意見回饋的紀錄，您可以使用附帶的 `worker.js` 架設一個輕量級的 API。

1. **安裝環境**：
   請確認電腦已安裝 Node.js，然後開啟終端機執行：
   ```bash
   npm install -g wrangler
   ```
2. **登入 Cloudflare**：
   ```bash
   wrangler login
   ```
3. **建立 KV 資料庫**：
   ```bash
   wrangler kv:namespace create "DORM_DB"
   ```
   *建立成功後，終端機會顯示一段 `kv_namespaces = [...]` 的設定。*

4. **建立並設定 `wrangler.toml`**：
   在專案資料夾內新增一個 `wrangler.toml`，內容如下（記得將 `id` 換成上一步獲得的 ID）：
   ```toml
   name = "dorm-api"
   main = "worker.js"
   compatibility_date = "2024-04-18"

   [[kv_namespaces]]
   binding = "DORM_DB"
   id = "替換成你的_KV_ID"
   ```

5. **設定 Gemini API Key (保護您的密鑰不外流)**：
   我們將把 Gemini API 存放在 Cloudflare 伺服器端，避免在前端網頁上外流。
   請在終端機輸入以下指令：
   ```bash
   wrangler secret put GEMINI_API_KEY
   ```
   按下 Enter 後，系統會提示您輸入（或貼上）您的 Gemini API Key。貼上後按 Enter 送出（貼上時畫面可能不會顯示文字，這是正常的安全機制）。

6. **發布上線**：
   執行以下指令部署：
   ```bash
   wrangler deploy
   ```
   部署完成後會得到一個 `https://dorm-api.<你的帳號>.workers.dev` 的網址。

7. **連接前端**：
   將上述網址替換到前端 `config.js` 裡的 `WORKER_URL`，這樣全宿舍就可以透過這個 API 共享所有的報修、請假紀錄，並且安全地使用 AI 辨識功能了！
