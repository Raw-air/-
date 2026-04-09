# 🏠 碧苑宿舍點名系統 - 完整設定指引

## 📋 你需要準備的帳號
- ✅ Notion 帳號（已有）
- ✅ GitHub 帳號
- ✅ Cloudflare 免費帳號（cloudflare.com 免費註冊）

---

## 第一步：建立 Notion 整合 (Integration)

1. 打開 [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. 點擊「**+ New integration**」
3. 填寫名稱：`碧苑點名系統`
4. 關聯到你的 Workspace
5. 點擊「**Submit**」
6. 複製頁面上的「**Internal Integration Secret**」
   - 格式類似：`secret_xxxxxxxxxxxxxx`
   - ⚠️ **這個 Token 要保密，不要分享給別人**

---

## 第二步：在 Notion 建立四個資料庫

### 建立步驟（每個資料庫都這樣做）：
1. 在 Notion 新建一個 Page（如：「碧苑宿舍管理」）
2. 在 Page 內加入 Database（`/database` 指令）
3. 依照下方規格建立屬性

> 建立完後，點右上角「Share」→ 邀請你的 Integration（把剛才建立的整合加進來）

---

### 資料庫一：學生花名冊

**名稱**: `學生花名冊`

| 屬性名稱 | 類型 | 說明 |
|---------|------|------|
| 姓名 | **Title** | 學生姓名（Notion 預設就是 Title） |
| 房號 | **Text** | 如 B211 |
| 床位 | **Select** | 選項：A、B、C、D |
| 班別 | **Text** | 如 四室一Ａ |
| 學號 | **Text** | 學號 |
| 中隊 | **Select** | 選項：一單、一雙、二單、二雙、三單、三雙 |
| 外籍生 | **Checkbox** | 是否為外籍生 |
| 空床 | **Checkbox** | 是否為空床 |
| 學期 | **Select** | 如 114-2 |

---

### 資料庫二：每日點名紀錄

**名稱**: `每日點名紀錄`

| 屬性名稱 | 類型 | 說明 |
|---------|------|------|
| 標題 | **Title** | 自動填入，如「二單 2026-04-09」 |
| 中隊 | **Select** | 選項：一單、一雙、二單、二雙、三單、三雙 |
| 日期 | **Date** | 點名日期 |
| 點名資料 | **Text** | JSON 格式的個別學生出席記錄 |
| 已提交 | **Checkbox** | 是否已正式提交 |
| 應到 | **Number** | |
| 實到 | **Number** | |
| 請假 | **Number** | |
| 未請假 | **Number** | |
| 空床數 | **Number** | |

---

### 資料庫三：系統設定

**名稱**: `系統設定`

| 屬性名稱 | 類型 |
|---------|------|
| 鍵 | **Title** |
| 值 | **Text** |

初始建立幾筆資料（在 Notion 手動新增）：

| 鍵 | 值 |
|----|-----|
| pin_一單 | 1111 |
| pin_一雙 | 2222 |
| pin_二單 | 3333 |
| pin_二雙 | 4444 |
| pin_三單 | 5555 |
| pin_三雙 | 6666 |
| pin_admin | 0000 |
| foreign_一單 | 0 |
| foreign_一雙 | 0 |
| foreign_二單 | 10 |
| foreign_二雙 | 8 |
| foreign_三單 | 12 |
| foreign_三雙 | 15 |

> ⚠️ PIN 碼請依實際需求修改，之後也可以在 App 的設定頁面修改

---

### 取得資料庫 ID

在瀏覽器打開你的 Notion 資料庫，URL 格式如下：
```
https://www.notion.so/你的workspace/【這串就是資料庫ID】?v=xxxxx
```

例如：
```
https://www.notion.so/mybdorm/360f4b451f0a82d08d020138f1796970?v=...
             資料庫 ID: ↑ 360f4b451f0a82d08d020138f1796970
```

把三個資料庫的 ID 都記下來。

---

## 第三步：部署 Cloudflare Worker

1. 到 [https://cloudflare.com](https://cloudflare.com) 免費註冊帳號

2. 點擊左側「**Workers & Pages**」→「**Create application**」→「**Create Worker**」

3. 給一個名稱（如：`biyuan-proxy`），點擊「Deploy」

4. 進入 Worker 設定頁面，點「**Edit code**」

5. 將 `worker/index.js` 的全部內容貼上，點擊 **Save and Deploy**

6. 設定環境變數（**Settings → Variables → Environment Variables**）：

| 變數名稱 | 值 |
|---------|-----|
| `NOTION_TOKEN` | `secret_你的Notion整合Token` |
| `ROSTER_DB_ID` | 學生花名冊的資料庫 ID |
| `ATTENDANCE_DB_ID` | 每日點名紀錄的資料庫 ID |
| `CONFIG_DB_ID` | 系統設定的資料庫 ID |

> ⚠️ 記得選「Encrypt」來保護 NOTION_TOKEN

7. 部署完成後，記下你的 Worker URL：
   ```
   https://biyuan-proxy.你的帳號.workers.dev
   ```

---

## 第四步：修改 config.js

打開 `config.js`，修改第一個設定：

```javascript
WORKER_URL: 'https://biyuan-proxy.你的帳號.workers.dev',
SEMESTER: '114-2',    // 修改為當前學期
DORM_NAME: '碧苑宿舍',  // 宿舍名稱
```

---

## 第五步：部署到 GitHub Pages

1. 在 GitHub 建立新 Repository（如：`biyuan-dorm-system`）

2. 上傳這個資料夾所有檔案（**不要上傳 worker 資料夾**，那個已經在 Cloudflare 了）

   需要上傳的檔案：
   - `index.html`
   - `style.css`
   - `app.js`
   - `api.js`
   - `config.js`
   - `import.js`
   - `export.js`

3. 進入 Repository 的 **Settings → Pages**

4. Source 選「**Deploy from branch**」→ Branch 選「**main**」→ 點儲存

5. 等待 1-2 分鐘，你的網址就會是：
   ```
   https://你的帳號.github.io/biyuan-dorm-system/
   ```

---

## 第六步：匯入學生名單

1. 打開網頁 → 進入「**設定**」頁面
2. 在「匯入花名冊」區域，把現有的 Notion CSV 拖曳進去
3. 確認預覽資料正確（六個中隊的分配、空床、外籍生）
4. 點擊「確認匯入」
5. 等待上傳完成（因為 Notion API 速率限制，約需 2-3 分鐘）

---

## 日常使用流程

### 每天晚上 11 點點名：
1. 手機打開網頁
2. 點選你的中隊（如「二單」）
3. 輸入 PIN 碼
4. 對照名單，不在的學生點一下 → 請假；再點 → 未請假
5. 確認資料後按「**提交今日點名**」
6. 看到綠色成功畫面即完成

### 查看總表（回報用）：
1. 點擊底部「總表」
2. 確認所有中隊都已提交（顯示 ✅）
3. 點擊「**一鍵複製**」
4. 貼到 LINE 群組回報

### 期末交學校：
1. 進入「設定」→ 選擇日期範圍
2. 點「下載 Excel」
3. 格式與現有 Notion CSV 相同

---

## ⚠️ 常見問題

**Q: 上傳失敗，顯示 CORS 錯誤**
A: 確認 Cloudflare Worker 已正確部署，且 `config.js` 的 WORKER_URL 填寫正確。

**Q: 中隊長點名後不見了（刷新後消失）**
A: 系統每 60 秒自動備份，如果在 60 秒內刷新可能遺失。請提醒中隊長點完後按提交。

**Q: 學生分配到錯誤的中隊**
A: 請檢查 CSV 的房號格式（應為 B+數字，如 B211）。可以在 Notion 資料庫直接修改中隊屬性。

**Q: 忘記 PIN 碼**
A: 直接到 Notion 的「系統設定」資料庫修改對應的 pin_xx 值。

---

**系統版本**：v1.0
**技術棧**：GitHub Pages + Cloudflare Worker + Notion API
