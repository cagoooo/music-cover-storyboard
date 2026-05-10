"""
封面接故事 — 圖片資產生成器

產出：
  public/favicon-16.png / favicon-32.png / favicon-48.png
  public/favicon.ico (multi-size 16/32/48，從上面三個合併)
  public/apple-touch-icon.png (180×180)
  public/icon-192.png / icon-512.png (PWA / Android home screen)
  public/og-image.png (1200×630，含繁中字型嵌入，無 tofu)

執行：
  python tools/generate-assets.py
"""

import os
import sys
import subprocess
from pathlib import Path

# Windows PowerShell 5.1 stdout 預設 cp950，print emoji/中文會炸
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
PUBLIC.mkdir(exist_ok=True)

# ---- 字型 ----
FONT_REGULAR = "C:/Windows/Fonts/msjh.ttc"      # Microsoft JhengHei Regular (繁中)
FONT_BOLD    = "C:/Windows/Fonts/msjhbd.ttc"    # Microsoft JhengHei Bold


def linear_gradient(size, c1, c2, angle_deg=135):
    """產出對角線漸層圖（簡化：左上 → 右下）"""
    w, h = size
    base = Image.new("RGB", (w, h), c1)
    top = Image.new("RGB", (w, h), c2)
    mask = Image.new("L", (w, h))
    md = ImageDraw.Draw(mask)
    # 用線性漸層 mask（左上 0 → 右下 255）
    for y in range(h):
        for x in range(w):
            t = (x + y) / (w + h - 2)
            md.point((x, y), int(255 * t))
    base.paste(top, (0, 0), mask)
    return base


def fast_gradient(size, c1, c2):
    """更快的漸層（用 numpy 也好但避免新 dep；用 row-based 漸層）"""
    w, h = size
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        ty = y / max(h - 1, 1)
        for x in range(w):
            tx = x / max(w - 1, 1)
            t = (tx + ty) / 2
            r = int(c1[0] + (c2[0] - c1[0]) * t)
            g = int(c1[1] + (c2[1] - c1[1]) * t)
            b = int(c1[2] + (c2[2] - c1[2]) * t)
            px[x, y] = (r, g, b)
    return img


def rounded_rect(size, radius, fill):
    """畫一個圓角方形圖（RGBA），return 圖物件"""
    w, h = size
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=fill)
    return img


def draw_icon(size):
    """畫一張 size×size 的封面接故事 icon，return RGBA Image"""
    s = size
    bg = fast_gradient((s, s), (124, 58, 237), (236, 72, 153))  # 紫 → 粉
    out = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    # 圓角遮罩 (radius 約 22% 邊長)
    radius = int(s * 0.22)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, s - 1, s - 1), radius=radius, fill=255)
    out.paste(bg, (0, 0), mask)

    d = ImageDraw.Draw(out)
    white = (255, 255, 255, 255)
    semi = (255, 255, 255, 180)

    # === 中央播放三角形（指向右）===
    # 中心點 (s/2, s/2)，三角形涵蓋約 35% 邊長
    tri_w = int(s * 0.32)
    tri_h = int(s * 0.36)
    cx, cy = s / 2, s / 2 + s * 0.04
    tri = [
        (cx - tri_w * 0.45, cy - tri_h / 2),
        (cx - tri_w * 0.45, cy + tri_h / 2),
        (cx + tri_w * 0.55, cy),
    ]
    d.polygon(tri, fill=white)

    # === 上方音符（音符頭 + 符桿）===
    # 音符頭：橢圓 (旋轉 -15°)
    note_cx = int(s * 0.32)
    note_cy = int(s * 0.30)
    note_w  = int(s * 0.13)
    note_h  = int(s * 0.10)
    # 用一個小圖層做旋轉橢圓
    note_layer = Image.new("RGBA", (note_w * 2, note_h * 2), (0, 0, 0, 0))
    nd = ImageDraw.Draw(note_layer)
    nd.ellipse((0, 0, note_w * 2 - 1, note_h * 2 - 1), fill=white)
    note_layer = note_layer.rotate(15, resample=Image.BICUBIC, expand=True)
    out.paste(note_layer, (note_cx - note_layer.width // 2, note_cy - note_layer.height // 2), note_layer)
    # 符桿：直線
    stem_w = max(2, int(s * 0.04))
    stem_h = int(s * 0.20)
    stem_x = note_cx + int(s * 0.07)
    stem_y = note_cy - stem_h
    d.rectangle((stem_x, stem_y, stem_x + stem_w, stem_y + stem_h - int(s * 0.03)), fill=white)

    # === 裝飾小點 ===
    if s >= 32:
        d.ellipse((int(s * 0.82), int(s * 0.16), int(s * 0.92), int(s * 0.26)), fill=semi)
    if s >= 48:
        d.ellipse((int(s * 0.18), int(s * 0.78), int(s * 0.24), int(s * 0.84)), fill=semi)

    return out


def generate_favicons():
    print("→ 生成 favicon (16, 32, 48, 180, 192, 512)…")
    sizes_files = [
        (16,  PUBLIC / "favicon-16.png"),
        (32,  PUBLIC / "favicon-32.png"),
        (48,  PUBLIC / "favicon-48.png"),
        (180, PUBLIC / "apple-touch-icon.png"),
        (192, PUBLIC / "icon-192.png"),
        (512, PUBLIC / "icon-512.png"),
    ]
    for size, path in sizes_files:
        img = draw_icon(size)
        img.save(path)
        print(f"   ✓ {path.name} ({size}×{size})")
    return [p for _, p in sizes_files if p.name.startswith("favicon-")]


def merge_ico(png_paths, ico_path):
    """用 Pillow 直接做 multi-size ICO（比 ImageMagick 簡單）"""
    print(f"→ 合併 favicon.ico (multi-size)…")
    images = [Image.open(p).convert("RGBA") for p in png_paths]
    base = images[-1]  # 最大那張當主
    base.save(
        ico_path,
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
        append_images=[i for i in images[:-1]],
    )
    print(f"   ✓ {ico_path.name}")


# ============================================================
# OG image 1200×630
# ============================================================

def draw_og_image(out_path):
    print("→ 生成 OG image (1200×630)…")
    W, H = 1200, 630

    # === 背景：紫粉雙色斜對角漸層 ===
    img = fast_gradient((W, H), (124, 58, 237), (236, 72, 153))

    # === 添加裝飾光暈 ===
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    # 左上柔光圈
    for r in range(280, 0, -20):
        alpha = int(60 * (1 - r / 280))
        od.ellipse((-150 - r // 4, -150 - r // 4, 200 + r, 200 + r),
                   fill=(255, 255, 255, alpha))
    # 右下柔光圈
    for r in range(320, 0, -25):
        alpha = int(50 * (1 - r / 320))
        od.ellipse((W - 200 - r, H - 200 - r, W + 100 + r // 3, H + 100 + r // 3),
                   fill=(255, 200, 230, alpha))
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=20))
    img = img.convert("RGBA")
    img.alpha_composite(overlay)
    img = img.convert("RGB")

    d = ImageDraw.Draw(img)

    # === 字型載入 ===
    try:
        font_title    = ImageFont.truetype(FONT_BOLD, 130)    # 主標題
        font_subtitle = ImageFont.truetype(FONT_BOLD, 60)     # 副標
        font_flow     = ImageFont.truetype(FONT_BOLD, 32)     # 流程描述
        font_caption  = ImageFont.truetype(FONT_REGULAR, 24)  # 底部署名
        font_url      = ImageFont.truetype(FONT_REGULAR, 22)  # URL
    except OSError as e:
        print(f"   ✗ 字型載入失敗：{e}")
        sys.exit(1)

    # === 主標題：封面接故事 ===
    title = "封面接故事"
    bbox = d.textbbox((0, 0), title, font=font_title)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    title_x = (W - tw) // 2
    title_y = 130
    # 標題陰影（微微）
    for off in [(3, 3), (2, 4), (4, 2)]:
        d.text((title_x + off[0], title_y + off[1]), title, font=font_title, fill=(60, 20, 100, 160))
    d.text((title_x, title_y), title, font=font_title, fill=(255, 255, 255))

    # === 副標 ===
    subtitle = "音樂影片分鏡產生器"
    bbox = d.textbbox((0, 0), subtitle, font=font_subtitle)
    sw = bbox[2] - bbox[0]
    sub_x = (W - sw) // 2
    sub_y = title_y + th + 50
    d.text((sub_x + 2, sub_y + 2), subtitle, font=font_subtitle, fill=(60, 20, 100, 160))
    d.text((sub_x, sub_y), subtitle, font=font_subtitle, fill=(255, 230, 245))

    # === 流程列：上傳 → 抓封面 → AI 接續分鏡 ===
    flow_text = "上傳 MV  →  抓封面  →  AI 接續 15-30 秒分鏡"
    bbox = d.textbbox((0, 0), flow_text, font=font_flow)
    fw = bbox[2] - bbox[0]
    flow_x = (W - fw) // 2
    flow_y = sub_y + 90
    # 流程膠囊背景
    pad_x, pad_y = 28, 14
    capsule = (flow_x - pad_x, flow_y - pad_y, flow_x + fw + pad_x, flow_y + 40 + pad_y)
    d.rounded_rectangle(capsule, radius=30, fill=(255, 255, 255, 70))
    d.text((flow_x, flow_y), flow_text, font=font_flow, fill=(255, 255, 255))

    # === 左下：URL ===
    url = "cagoooo.github.io/music-cover-storyboard"
    d.text((50, H - 60), url, font=font_url, fill=(255, 255, 255, 220))

    # === 右下：作者署名 ===
    caption = "by 阿凱老師  ·  桃園市石門國小"
    bbox = d.textbbox((0, 0), caption, font=font_caption)
    cw = bbox[2] - bbox[0]
    d.text((W - cw - 50, H - 60), caption, font=font_caption, fill=(255, 255, 255, 220))

    # === 上方裝飾「圖示」（vector 畫，避免 emoji 字型相依） ===
    # 「🎬 + 🎵」用形狀代替：左邊一個影格框、右邊一個音符
    # 影格框
    frame_x, frame_y, frame_s = 540, 50, 50
    # 影格本體
    d.rounded_rectangle((frame_x, frame_y, frame_x + frame_s, frame_y + frame_s * 0.7),
                        radius=6, fill=None, outline=(255, 255, 255), width=3)
    # 內部播放三角
    tri = [
        (frame_x + 16, frame_y + 12),
        (frame_x + 16, frame_y + 28),
        (frame_x + 32, frame_y + 20),
    ]
    d.polygon(tri, fill=(255, 255, 255))
    # 音符
    note_x, note_y = 620, 60
    d.ellipse((note_x, note_y + 18, note_x + 22, note_y + 32), fill=(255, 255, 255))
    d.rectangle((note_x + 19, note_y, note_x + 23, note_y + 25), fill=(255, 255, 255))

    img.save(out_path, "PNG", optimize=True)
    print(f"   ✓ {out_path.name} (1200×630)")


# ============================================================
# main
# ============================================================

if __name__ == "__main__":
    print("🎨 生成封面接故事資產…")
    fav_pngs = generate_favicons()
    merge_ico(fav_pngs, PUBLIC / "favicon.ico")
    draw_og_image(PUBLIC / "og-image.png")

    # 清掉中間 PNG（瀏覽器只看 .ico 和 .svg）
    for p in fav_pngs:
        if p.exists():
            p.unlink()
            print(f"   ✕ 刪除中間檔 {p.name}")

    print("\n✅ 全部資產就緒")
    for f in sorted(PUBLIC.glob("*")):
        if f.suffix.lower() in (".ico", ".png", ".svg"):
            size = f.stat().st_size
            print(f"   {f.name:30s} {size:>10,} bytes")
