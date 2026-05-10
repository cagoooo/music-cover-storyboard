"""
封面接故事 — 一鍵升版工具

用法：
  python tools/bump-version.py            # patch +1 (預設)：1.1.1 → 1.1.2
  python tools/bump-version.py patch
  python tools/bump-version.py minor      # 1.1.1 → 1.2.0
  python tools/bump-version.py major      # 1.1.1 → 2.0.0
  python tools/bump-version.py --to 2.0.0 # 直接指定版本

會同步更新：
  public/version.json     "version": "X.Y.Z" + buildTime
  public/config.js        version: 'X.Y.Z'
  public/index.html       所有 ?v=X.Y.Z 字串
  public/service-worker.js  CACHE_VERSION = 'X.Y.Z'

重要：
  - 全程用 encoding='utf-8'，不會踩 PowerShell 5.1 cp950 把中文搞爛的雷
  - 升版後會印出 git status，提示要 commit 哪些檔案
  - 不自動 commit / push（讓使用者控制）
"""

import argparse
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

# Windows PowerShell 5.1 stdout 預設 cp950，print emoji/中文會炸
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"

VERSION_JSON = PUBLIC / "version.json"
CONFIG_JS    = PUBLIC / "config.js"
INDEX_HTML   = PUBLIC / "index.html"
SW_JS        = PUBLIC / "service-worker.js"


def read_text(path):
    return path.read_text(encoding='utf-8')


def write_text(path, text):
    # 注意：write_text 預設會用系統編碼，必須明確 utf-8 + newline 控制
    path.write_text(text, encoding='utf-8', newline='\n')


def get_current_version():
    data = json.loads(read_text(VERSION_JSON))
    return data.get('version', '0.0.0')


def parse_semver(v):
    m = re.match(r'^(\d+)\.(\d+)\.(\d+)$', v.strip())
    if not m:
        raise ValueError(f"非法版本格式：{v}（需要 X.Y.Z）")
    return tuple(int(x) for x in m.groups())


def bump(current, kind):
    major, minor, patch = parse_semver(current)
    if kind == 'patch':
        return f"{major}.{minor}.{patch + 1}"
    if kind == 'minor':
        return f"{major}.{minor + 1}.0"
    if kind == 'major':
        return f"{major + 1}.0.0"
    raise ValueError(f"未知 bump 類型：{kind}")


def update_version_json(new_ver):
    data = json.loads(read_text(VERSION_JSON))
    data['version'] = new_ver
    data['buildTime'] = date.today().isoformat()
    write_text(VERSION_JSON, json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    print(f"   ✓ {VERSION_JSON.relative_to(ROOT)}")


def update_config_js(old_ver, new_ver):
    text = read_text(CONFIG_JS)
    new_text = re.sub(
        r"version:\s*'[^']*'",
        f"version: '{new_ver}'",
        text,
    )
    if text == new_text:
        print(f"   ⚠ {CONFIG_JS.relative_to(ROOT)} — 沒找到 version 欄位")
        return
    write_text(CONFIG_JS, new_text)
    print(f"   ✓ {CONFIG_JS.relative_to(ROOT)}")


def update_index_html(old_ver, new_ver):
    text = read_text(INDEX_HTML)
    # 把所有 ?v=X.Y.Z 替換（不限定舊版本，避免漏掉用了不同版本的 entry）
    new_text = re.sub(r'\?v=\d+\.\d+\.\d+', f'?v={new_ver}', text)
    count = len(re.findall(r'\?v=', new_text))
    if text == new_text:
        print(f"   ⚠ {INDEX_HTML.relative_to(ROOT)} — 沒找到 ?v= 字串")
        return
    write_text(INDEX_HTML, new_text)
    print(f"   ✓ {INDEX_HTML.relative_to(ROOT)} (替換 {count} 處 ?v=)")


def update_service_worker(old_ver, new_ver):
    if not SW_JS.exists():
        print(f"   ⚠ {SW_JS.relative_to(ROOT)} — 不存在，跳過")
        return
    text = read_text(SW_JS)
    new_text = re.sub(
        r"const\s+CACHE_VERSION\s*=\s*'[^']*'",
        f"const CACHE_VERSION = '{new_ver}'",
        text,
    )
    if text == new_text:
        print(f"   ⚠ {SW_JS.relative_to(ROOT)} — 沒找到 CACHE_VERSION 常數")
        return
    write_text(SW_JS, new_text)
    print(f"   ✓ {SW_JS.relative_to(ROOT)}")


def show_git_status():
    try:
        out = subprocess.run(
            ['git', 'status', '--short', 'public/'],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
        )
        if out.stdout.strip():
            print("\n📋 已更動檔案（請 commit）:")
            for line in out.stdout.splitlines():
                print(f"   {line}")
    except FileNotFoundError:
        pass


def main():
    parser = argparse.ArgumentParser(description="封面接故事 — 一鍵升版")
    parser.add_argument(
        'kind',
        nargs='?',
        default='patch',
        choices=['patch', 'minor', 'major'],
        help='升版類型（預設 patch）',
    )
    parser.add_argument('--to', help='直接指定版本，例如 --to 2.0.0', default=None)
    parser.add_argument('--dry-run', action='store_true', help='只計算不寫檔')
    args = parser.parse_args()

    print("🔢 封面接故事升版工具\n")

    current = get_current_version()
    if args.to:
        new_ver = args.to
        parse_semver(new_ver)  # 驗證格式
    else:
        new_ver = bump(current, args.kind)

    print(f"   舊版本：{current}")
    print(f"   新版本：{new_ver}")
    if args.dry_run:
        print("\n🔍 dry-run：不寫檔")
        return 0

    print("\n📝 更新檔案：")
    update_version_json(new_ver)
    update_config_js(current, new_ver)
    update_index_html(current, new_ver)
    update_service_worker(current, new_ver)

    show_git_status()

    print(f"\n✅ 已升版到 v{new_ver}")
    print("\n下一步建議：")
    print("   git add -A")
    print(f'   git commit -m "chore: bump to v{new_ver}"')
    print("   git push")
    print("\nGitHub Actions 會在 push 後自動部署到 GitHub Pages，")
    print("使用者下次造訪會在 30 秒內看到「有新版可以用了」banner。")
    return 0


if __name__ == '__main__':
    sys.exit(main())
