/**
 * 壁苑宿舍點名系統 - API 客戶端
 * 所有與 Cloudflare Worker 的通訊都透過此模組
 */

import { CONFIG } from './config.js';

class ApiClient {
  constructor() {
    this.baseUrl = CONFIG.WORKER_URL;
    this.retryCount = 3;
    this.retryDelay = 1000;
  }

  // ── 核心請求方法 ────────────────────────────────────────────────────────────

  async request(path, method = 'GET', body = null, retries = this.retryCount) {
    const url = `${this.baseUrl}${path}`;
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) options.body = JSON.stringify(body);

    try {
      const response = await fetch(url, options);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      return data;
    } catch (error) {
      if (retries > 0 && error.name !== 'AbortError') {
        await new Promise(r => setTimeout(r, this.retryDelay));
        return this.request(path, method, body, retries - 1);
      }
      throw error;
    }
  }

  get(path, params = {}) {
    const searchParams = new URLSearchParams(params);
    const queryStr = searchParams.toString();
    return this.request(`${path}${queryStr ? '?' + queryStr : ''}`);
  }

  post(path, body) { return this.request(path, 'POST', body); }
  patch(path, body) { return this.request(path, 'PATCH', body); }
  delete(path, body) { return this.request(path, 'DELETE', body); }

  // ── 健康檢查 ─────────────────────────────────────────────────────────────────

  async ping() {
    return this.get('/api/ping');
  }

  // ── 花名冊 (Roster) ──────────────────────────────────────────────────────────

  async getRoster(squad = null, semester = null) {
    const params = {};
    if (squad) params.squad = squad;
    if (semester) params.semester = semester;
    return this.get('/api/roster', params);
  }

  async importRoster(students, semester) {
    return this.post('/api/roster/import', { students, semester });
  }

  async clearRoster(semester) {
    return this.delete('/api/roster/clear', { semester });
  }

  // ── 點名紀錄 (Attendance) ─────────────────────────────────────────────────────

  async getAttendance(squad, date) {
    return this.get('/api/attendance', { squad, date });
  }

  async saveAttendance(attendanceData) {
    return this.post('/api/attendance', attendanceData);
  }

  async updateAttendance(attendanceData) {
    return this.patch('/api/attendance', attendanceData);
  }

  // 儲存或更新（自動判斷）
  async upsertAttendance(attendanceData) {
    if (attendanceData.id) {
      return this.updateAttendance(attendanceData);
    } else {
      return this.saveAttendance(attendanceData);
    }
  }

  // ── 每日總表 (Summary) ────────────────────────────────────────────────────────

  async getDailySummary(date) {
    return this.get('/api/summary', { date });
  }

  async getSummaryRange(startDate, endDate, submittedOnly = true) {
    return this.get('/api/summary/range', {
      start: startDate,
      end: endDate,
      submitted: submittedOnly ? 'true' : 'false',
    });
  }

  // ── 設定 (Config) ─────────────────────────────────────────────────────────────

  async getConfig() {
    return this.get('/api/config');
  }

  async setConfig(configData) {
    return this.post('/api/config', configData);
  }
}

// 單例模式
const api = new ApiClient();
export default api;
