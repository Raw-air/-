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
        const res = await fetch(`${this.baseUrl}${path}`, opts);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        return data;
      } catch (err) {
        if (attempt === 1) throw err;
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

  // 換床位（整行資料交換）
  // pageIdA: 來源學生的 Notion pageId
  // pageIdB: 目標床位的 Notion pageId（可以是空床）
  swapBeds(pageIdA, pageIdB) {
    return this._fetch('/api/swap-beds', 'POST', { pageIdA, pageIdB });
  }

  // 取得所有公告日誌
  getChangelog() { return this._fetch('/api/changelog'); }

  // 發布新公告日誌
  postChangelog(content) { return this._fetch('/api/changelog', 'POST', { content }); }
}

// 全域單例
if (typeof window !== 'undefined') {
  window._api = new ApiClient(window.CONFIG?.WORKER_URL || '');
}
