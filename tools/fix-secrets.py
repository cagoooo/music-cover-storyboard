"""
封面接故事 — 修復 Firebase Secrets（清除 BOM 污染）

之前用 PowerShell `$key | firebase secrets:set ... --data-file=-` 透過 stdin pipe，
PS 5.1 預設 stdin encoding 把 \\uFEFF BOM 帶進 secret value，
Gemini SDK 把含 BOM 的 key 塞進 HTTP header → ByteString 編碼錯誤。

這支腳本：
  1. 從 gcloud 取出 Gemini API key 的 keyString（純 ASCII）
  2. 寫到 BOM-less ASCII temp 檔（無尾 newline）
  3. 用 firebase --data-file= 重設 secret（會新增 version）
  4. 同樣處理 Turnstile secret（接受 stdin 輸入或環境變數）
  5. 不 print key 內容，僅印長度與 hash 確認

重設 secret 後仍需 `firebase deploy --only functions` 才會生效，
因為 defineSecret 在 deploy 時就 pin 版本。
"""

import os
import sys
import hashlib
import subprocess
import tempfile

# Windows PowerShell 5.1 stdout 預設 cp950，print emoji/中文會炸
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

PROJECT = 'music-cover-storyboard'
ACCOUNT = 'ipad@mail2.smes.tyc.edu.tw'
GEMINI_KEY_RESOURCE = 'projects/680492652235/locations/global/keys/7911f61f-df32-446d-b7f7-61f3d5792d39'


def run(args):
    """執行 cmd 並回傳 stdout (bytes)，不接 stderr 進來"""
    # Windows 上 gcloud 是 .ps1/.cmd wrapper，Python subprocess 預設只找 .exe
    # 用 shell=True 讓 cmd.exe 解析 PATHEXT，找得到 .cmd / .ps1 wrapper
    return subprocess.check_output(
        args,
        stderr=subprocess.DEVNULL,
        shell=True,
    )


def write_ascii_tempfile(value):
    """寫一個 BOM-less / no-trailing-newline 的 ASCII temp 檔，回傳路徑"""
    if not value.isascii():
        raise ValueError(f'value 含非 ASCII 字元，無法當 secret value: {value[:10]!r}')
    fd, path = tempfile.mkstemp(suffix='.secret')
    with os.fdopen(fd, 'wb') as f:
        f.write(value.encode('ascii'))
    return path


def show_summary(label, value):
    print(f'   {label}：長度 {len(value)} 字元，SHA256={hashlib.sha256(value.encode()).hexdigest()[:12]}…')


def set_secret(secret_name, value):
    path = write_ascii_tempfile(value)
    try:
        size = os.path.getsize(path)
        print(f'   temp 檔：{size} bytes（無 BOM、無尾 newline）')
        # 呼叫 firebase functions:secrets:set --data-file=path
        firebase_cmd = [
            'firebase', 'functions:secrets:set', secret_name,
            f'--project={PROJECT}',
            f'--account={ACCOUNT}',
            f'--data-file={path}',
        ]
        # firebase 在 Windows 上是 .cmd，要 shell=True 才會找得到
        result = subprocess.run(firebase_cmd, capture_output=True, text=True, shell=True)
        if result.returncode != 0:
            print(f'   ✗ firebase set 失敗：{result.stderr}')
            return False
        # 從輸出抓 version
        for line in result.stdout.splitlines():
            if 'Created a new secret version' in line:
                print(f'   ✓ {line.strip()}')
                break
        return True
    finally:
        if os.path.exists(path):
            os.remove(path)


def main():
    print('🔧 修復 Firebase Secrets（清除 BOM 污染）\n')

    # ---- 1. Gemini API key ----
    print('1. 從 gcloud 取 Gemini keyString…')
    try:
        gemini_bytes = run([
            'gcloud', 'alpha', 'services', 'api-keys', 'get-key-string',
            GEMINI_KEY_RESOURCE,
            f'--project={PROJECT}',
            f'--account={ACCOUNT}',
            '--format=value(keyString)',
        ])
    except subprocess.CalledProcessError as e:
        print(f'   ✗ gcloud 失敗 (exit {e.returncode})')
        return 1
    except FileNotFoundError:
        print('   ✗ 找不到 gcloud，請確認 PATH')
        return 1

    gemini_key = gemini_bytes.decode('ascii').strip()
    if not gemini_key.startswith('AIza') or len(gemini_key) != 39:
        print(f'   ✗ keyString 異常：len={len(gemini_key)} start={gemini_key[:5]!r}')
        return 1
    show_summary('Gemini key', gemini_key)
    print('   寫入 MCS_GEMINI_API_KEY…')
    if not set_secret('MCS_GEMINI_API_KEY', gemini_key):
        return 1

    # ---- 2. Turnstile secret ----
    print('\n2. Turnstile secret…')
    turnstile_secret = os.environ.get('MCS_TURNSTILE_SECRET_VALUE')
    if not turnstile_secret:
        print('   未提供 MCS_TURNSTILE_SECRET_VALUE 環境變數，跳過 Turnstile 重設')
        print('   （若要重設，請：$env:MCS_TURNSTILE_SECRET_VALUE = "0x4AAA..."）')
    else:
        turnstile_secret = turnstile_secret.strip()
        if not turnstile_secret.startswith('0x'):
            print(f'   ✗ Turnstile secret 異常：start={turnstile_secret[:5]!r}')
            return 1
        show_summary('Turnstile secret', turnstile_secret)
        print('   寫入 MCS_TURNSTILE_SECRET…')
        if not set_secret('MCS_TURNSTILE_SECRET', turnstile_secret):
            return 1

    print('\n✅ Secrets 已重設。下一步請 redeploy：')
    print('   firebase deploy --only functions --project=music-cover-storyboard --account=ipad@mail2.smes.tyc.edu.tw')
    return 0


if __name__ == '__main__':
    sys.exit(main())
