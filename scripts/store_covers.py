# Compose the store covers from clean in-game frames: the frame plus the title, nothing else.
# usage: python -I covers.py <shotsDir> <outDir>
import sys, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

shots, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
YELLOW, INK = (242, 194, 48), (22, 22, 26)
FONT = 'C:/Windows/Fonts/ariblk.ttf'


def badge(d):
    """The crash-test target: a circle in four quarters, ink and yellow, with an ink rim."""
    im = Image.new('RGBA', (d * 4, d * 4), (0, 0, 0, 0))
    g = ImageDraw.Draw(im)
    D = d * 4
    rim = D // 14
    g.ellipse((0, 0, D - 1, D - 1), fill=INK)
    box = (rim, rim, D - 1 - rim, D - 1 - rim)
    for i, c in enumerate([INK, YELLOW, INK, YELLOW]):
        g.pieslice(box, -90 + i * 90, i * 90, fill=c)
    return im.resize((d, d), Image.LANCZOS)


def title(size, lines, gap=0.02):
    """The DUMMY BRAWL logo: badge over two lines of heavy type, yellow with a thick ink outline."""
    f = ImageFont.truetype(FONT, size)
    stroke = max(4, size // 9)
    widths = [f.getbbox(t, stroke_width=stroke) for t in lines]
    w = max(b[2] - b[0] for b in widths)
    lh = int(size * 1.02)
    bd = int(size * 0.95)
    H = bd + int(size * 0.18) + lh * len(lines) + stroke * 2
    W = w + stroke * 2
    im = Image.new('RGBA', (W + 40, H + 40), (0, 0, 0, 0))
    g = ImageDraw.Draw(im)
    y = 20 + bd + int(size * 0.18)
    for t in lines:
        tw = f.getbbox(t, stroke_width=stroke)[2] - f.getbbox(t, stroke_width=stroke)[0]
        g.text(((im.width - tw) // 2, y), t, font=f, fill=YELLOW, stroke_width=stroke, stroke_fill=INK)
        y += lh
    im.alpha_composite(badge(bd), ((im.width - bd) // 2, 20))
    # a hard ink drop shadow, like the game's buttons
    a = im.split()[3]
    sh = Image.new('RGBA', im.size, INK + (0,))
    sh.putalpha(a)
    out_im = Image.new('RGBA', (im.width, im.height + size // 10), (0, 0, 0, 0))
    out_im.alpha_composite(sh, (0, size // 10))
    out_im.alpha_composite(im, (0, 0))
    soft = out_im.split()[3].filter(ImageFilter.GaussianBlur(size // 6)).point(lambda v: int(v * 0.35))
    glow = Image.new('RGBA', out_im.size, (255, 255, 255, 0))
    glow.putalpha(soft)
    res = Image.new('RGBA', out_im.size, (0, 0, 0, 0))
    res.alpha_composite(glow)
    res.alpha_composite(out_im)
    return res


def cover(src, size, crop, logo_h, top, name, lines=('DUMMY', 'BRAWL')):
    im = Image.open(os.path.join(shots, src)).convert('RGBA')
    im = im.crop(crop).resize(size, Image.LANCZOS)
    lg = title(100, lines)
    s = logo_h / lg.height
    lg = lg.resize((int(lg.width * s), int(lg.height * s)), Image.LANCZOS)
    im.alpha_composite(lg, ((size[0] - lg.width) // 2, top))
    path = os.path.join(out, name)
    im.convert('RGB').save(path, optimize=True)
    print(path, im.size)


# landscape 16:9: the snow pass, a dummy flying off its scooter
cover('d3_land_clean_23.png', (1920, 1080), (0, 0, 1920, 1080), 400, 24, 'cover_landscape_1920x1080.png')
# square 1:1: the same moment cut around the action
cover('d3_land_clean_23.png', (800, 800), (300, 0, 1380, 1080), 330, 10, 'cover_square_800x800.png')
# portrait 9:16 (Playgama): the desert, a KO burst in the middle of the pack
cover('d1_port_clean_23.png', (1080, 1920), (0, 0, 1080, 1920), 560, 70, 'cover_portrait_1080x1920.png')
# portrait 2:3: the same frame cut to 1080x1620 from the top
cover('d1_port_clean_23.png', (800, 1200), (0, 300, 1080, 1920), 340, 20, 'cover_portrait_800x1200.png')
