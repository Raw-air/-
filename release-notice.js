// 大改版通知：更新後第一次打開 APP 跳一次，按「知道了」後這台裝置不再跳。下次大改版換 NOTICE_ID 就會再跳。
(function () {
  const NOTICE_ID = 'v33-migration';
  const SEEN_KEY = 'biyuan_release_notice_seen';
  const CHECK_MS = 300;

  const seen = () => { try { return localStorage.getItem(SEEN_KEY) === NOTICE_ID; } catch { return false; } };
  const markSeen = () => { try { localStorage.setItem(SEEN_KEY, NOTICE_ID); } catch {} };

  // 開機畫面、資料載入都結束才跳，免得被蓋住
  function bootDone() {
    if (document.body.classList.contains('rawair-booting')) return false;
    const loading = document.getElementById('loading-overlay');
    return !loading || loading.classList.contains('exit-drop') || loading.style.display === 'none';
  }

  function show() {
    const overlay = document.createElement('div');
    overlay.id = 'release-notice';
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <div class="modal-card" style="max-width:360px">
        <h3 style="margin:0 0 10px">系統大改版</h3>
        <p style="margin:0 0 16px;line-height:1.6">這次更新做了資料遷移，系統更新會更及時。</p>
        <button type="button" class="modal-btn confirm" style="width:100%">知道了</button>
      </div>`;
    overlay.querySelector('button').addEventListener('click', () => {
      markSeen();
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 260);
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));
  }

  if (seen() || navigator.webdriver) return; // 自動化測試不跳，免得擋住其他測試的點擊
  const timer = setInterval(() => {
    if (!bootDone()) return;
    clearInterval(timer);
    show();
  }, CHECK_MS);
})();
