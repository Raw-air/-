// 借用 firebase CLI 已登入的權杖 (只放記憶體，不印、不寫檔)
const fs = require('fs'), os = require('os'), path = require('path'), { execSync } = require('child_process');
const STORE = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const readTokens = () => JSON.parse(fs.readFileSync(STORE, 'utf8')).tokens || {};
function accessToken() {
  let t = readTokens();
  if (!t.access_token || !(t.expires_at > Date.now() + 5 * 60000)) {
    execSync('firebase projects:list --non-interactive', { stdio: 'ignore', shell: true });
    t = readTokens();
  }
  if (!t.access_token) throw new Error('拿不到 firebase 登入權杖');
  return t.access_token;
}
module.exports = { accessToken, PROJECT: process.env.FIREBASE_PROJECT || 'biyuan-dorm' };
