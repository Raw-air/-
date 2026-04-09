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
