// 設定 → 認領自己的職位：這台裝置記住「我是副社長」，有報修就跳視窗提醒
(function () {
  const ROLE_KEY = 'biyuan_claimed_role';
  const ROLES = { vice_president: '副社長' };
  const POLL_MS = 60000;          // 開著 APP 時每分鐘看一次有沒有新報修
  const RELAUNCH_MS = 10 * 60000; // 切到背景超過 10 分鐘再回來，當作重新進 APP

  const getRole = () => { try { return localStorage.getItem(ROLE_KEY) || ''; } catch { return ''; } };
  const setRole = (r) => { try { r ? localStorage.setItem(ROLE_KEY, r) : localStorage.removeItem(ROLE_KEY); } catch {} };

  // ── 設定頁卡片 ──
  function renderCard() {
    const card = document.getElementById('role-claim-card');
    if (!card) return;
    const role = getRole();
    const body = card.querySelector('.rc-body');
    if (ROLES[role]) {
      body.innerHTML = `
        <div class="settings-hint">這台裝置已認領：<b>${ROLES[role]}</b>。有新的報修會跳出視窗提醒。</div>
        <button type="button" class="action-btn wide" style="margin-top:10px" data-act="unclaim">取消認領</button>`;
    } else {
      body.innerHTML = `
        <div class="settings-hint">認領後，這台裝置一打開 APP 就會提醒你該處理的事。需要輸入該職位的密碼。</div>
        <button type="button" class="action-btn wide" style="margin-top:10px" data-act="claim" data-role="vice_president">認領副社長</button>`;
    }
  }

  function mountCard() {
    const page = document.getElementById('page-settings');
    if (!page || document.getElementById('role-claim-card')) return;
    const card = document.createElement('div');
    card.className = 'settings-card';
    card.id = 'role-claim-card';
    card.innerHTML = `<div class="settings-card-header"><svg class="ui-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m16 11 2 2 4-4"/></svg> 認領自己的職位</div><div class="rc-body"></div>`;
    const first = page.querySelector('.settings-card');
    first ? first.after(card) : page.append(card);
    card.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      if (btn.dataset.act === 'claim') {
        const role = btn.dataset.role;
        showPinDialog(role, () => {
          setRole(role);
          renderCard();
          showToast(`已認領${ROLES[role]}，有報修會提醒你`, 'success');
          notifiedIds.clear();
          checkRepairs(true);
        }, `認領${ROLES[role]}：輸入密碼`);
      } else if (btn.dataset.act === 'unclaim') {
        setRole('');
        renderCard();
        showToast('已取消認領', 'success');
      }
    });
    renderCard();
  }

  // ── 報修提醒 ──
  const notifiedIds = new Set();
  let popupOpen = false;
  let checking = false;

  async function checkRepairs(isLaunch) {
    if (getRole() !== 'vice_president' || popupOpen || checking) return;
    if (typeof currentPage !== 'undefined' && currentPage === 'repair-review') return;
    checking = true;
    try {
      const res = await fetch(window.CONFIG.WORKER_URL + '/api/repair-records');
      const records = await res.json();
      if (!Array.isArray(records)) return;
      const fresh = records.filter(r => r && r.id && !notifiedIds.has(r.id));
      // 剛進 APP：只要有待處理就提醒；APP 開著的時候：只提醒新進來的
      const show = isLaunch ? records.length > 0 : fresh.length > 0;
      records.forEach(r => r && r.id && notifiedIds.add(r.id));
      if (!show) return;
      popupOpen = true;
      const latest = (isLaunch ? records : fresh)[0] || {};
      const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const who = esc(latest.reporter || latest.name || '');
      const reason = esc(latest.reason || '').slice(0, 60);
      const ok = await showConfirmDialog({
        title: isLaunch ? `有 ${records.length} 筆報修待處理` : `新報修 ${fresh.length} 筆`,
        message: reason ? `${who ? who + '：' : ''}${reason}` : '副社長，有住宿生通報設施損壞。',
        confirmText: '去看看',
        cancelText: '稍後',
        icon: '<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>'
      });
      popupOpen = false;
      if (ok) openRepairReview();
    } catch (err) {
      console.warn('報修提醒檢查失敗', err);
    } finally {
      checking = false;
    }
  }

  // 等開機畫面收掉再跳，免得視窗被蓋住
  function whenBooted(fn, tries = 0) {
    const boot = document.getElementById('rawair-boot');
    const visible = boot && boot.isConnected && getComputedStyle(boot).display !== 'none' && getComputedStyle(boot).opacity !== '0';
    if (visible && tries < 30) return setTimeout(() => whenBooted(fn, tries + 1), 500);
    setTimeout(fn, 800);
  }

  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    checkRepairs(hiddenAt && Date.now() - hiddenAt > RELAUNCH_MS);
  });
  setInterval(() => { if (!document.hidden) checkRepairs(false); }, POLL_MS);

  mountCard();
  whenBooted(() => checkRepairs(true));
})();
