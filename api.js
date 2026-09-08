/**
 * 碧苑宿舍點名系統 - API 客戶端
 */
class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async _fetch(path, method = 'GET', body = null, requestOptions = {}) {
    const opts = { method, headers: {} };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }

    const timeoutMs = Math.max(1000, Number(requestOptions.timeoutMs) || 15000);
    const retries = Math.max(0, Number.isFinite(requestOptions.retries)
      ? Math.floor(requestOptions.retries)
      : (method === 'GET' ? 1 : 0));

    for (let attempt = 0; attempt <= retries; attempt++) {
      let timedOut = false;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
        let res, data;
        try {
          res = await fetch(`${this.baseUrl}${path}`, { ...opts, signal: controller.signal });
          data = await res.json();
        } finally { clearTimeout(timer); }
        if (!res.ok) {
          const httpError = new Error(data.error || `HTTP ${res.status}`);
          httpError.status = res.status;
          throw httpError;
        }
        if (data.error) throw new Error(data.error);
        return data;
      } catch (err) {
        const normalized = timedOut
          ? new Error(`連線逾時（${Math.round(timeoutMs / 1000)} 秒），請稍後重試`)
          : err;
        const retryable = timedOut || normalized?.name === 'TypeError' ||
          [408, 425, 429, 500, 502, 503, 504].includes(Number(normalized?.status));
        // 寫入預設仍不重播；只有明確傳入 retries 的冪等操作，且為暫時性錯誤時才重試。
        if (attempt >= retries || !retryable) throw normalized;
        await new Promise(r => setTimeout(r, Number(requestOptions.retryDelayMs) || 1000));
      }
    }
  }

  // 連線測試
  ping() { return this._fetch('/api/ping'); }

  // 取得全部學生 + 出席資料
  getRoster() { return this._fetch('/api/roster'); }

  // 批次更新出席狀態
  // updates: [{ pageId, date, value }]
  updateAttendance(updates, options) {
    return this._fetch('/api/attendance', 'PATCH', { updates }, options);
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
