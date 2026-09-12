/**
 * 碧苑宿舍點名系統 - API 客戶端
 */
class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async _fetch(path, method = 'GET', body = null) {
    const opts = { method, headers: {} };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }

    // 重試邏輯（最多 2 次）
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        let res, data;
        try {
          res = await fetch(`${this.baseUrl}${path}`, { ...opts, signal: controller.signal });
          data = await res.json();
        } finally { clearTimeout(timer); }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (data.error) throw new Error(data.error);
        return data;
      } catch (err) {
        // A timed-out swap/creation may already have succeeded. Never replay writes.
        if (attempt === 1 || method !== 'GET') throw err;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  // 連線測試
  ping() { return this._fetch('/api/ping'); }

  // 取得全部學生 + 出席資料
  getRoster() { return this._fetch('/api/roster'); }

  // 批次更新出席狀態
  // updates: [{ pageId, date, value }]
  updateAttendance(updates) {
    return this._fetch('/api/attendance', 'PATCH', { updates });
  }

  // 取得系統設定
  getConfig() { return this._fetch('/api/config'); }

  // 更新系統設定
  setConfig(data) { return this._fetch('/api/config', 'POST', data); }

  // 建立備註資料庫
  setupRemarksDB() { return this._fetch('/api/setup-remarks-db', 'POST'); }

  // 取得備註資料
  getRemarks() { return this._fetch('/api/remarks'); }

  // 更新備註資料
  updateRemark(pageId, remark) {
    return this._fetch('/api/remarks', 'POST', { pageId, remark });
  }

  // 換床位（整行資料交換）
  // pageIdA: 來源學生的 Notion pageId
  // pageIdB: 目標床位的 Notion pageId（可以是空床）
  swapBeds(pageIdA, pageIdB) {
    return this._fetch('/api/swap-beds', 'POST', { pageIdA, pageIdB });
  }

  // 取得所有公告日誌
  getChangelog() { return this._fetch('/api/changelog'); }

  // 發布新公告日誌
  // 發布新公告日誌
  postChangelog(content) { return this._fetch('/api/changelog', 'POST', { content }); }

  // ⚡ 即時輪詢（KV 信號層，回應 < 10ms，不走重試邏輯）
  async poll() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${this.baseUrl}/api/poll`, {signal: controller.signal});
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null; // 輪詢失敗靜默跳過
    } finally { clearTimeout(timer); }
  }
}

// 全域單例
if (typeof window !== 'undefined') {
  window._api = new ApiClient(window.CONFIG?.WORKER_URL || '');
}
