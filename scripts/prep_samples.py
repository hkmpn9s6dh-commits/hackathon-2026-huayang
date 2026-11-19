"""把生成的三张构件照片裁掉右下角水印、缩到 900 宽，存进构件库。
   水印位置固定在右下角（"AI生成 / WORKBUDDY"），统一裁掉底部 82px。"""
import os
import glob
import numpy as np
import cv2

RAW = "assets/raw"
OUT = "assets/samples"
os.makedirs(OUT, exist_ok=True)

plan = [
    ("*23-34-08.png", "06--混凝土花格窗", "老厂房立面的混凝土镂空花格，方孔阵列"),
    ("*23-34-26.png", "07--铸铁栏杆", "五十年代厂区楼梯的铸铁栏杆，卷草与圆环"),
    ("*23-34-44.png", "08--错缝红砖墙", "红砖错缝砌法，砂浆风化"),
]

for pat, name, note in plan:
    files = sorted(glob.glob(os.path.join(RAW, pat)))
    if not files:
        print("MISS", pat)
        continue
    im = cv2.imread(files[0])
    h, w = im.shape[:2]
    im = im[: h - 82, :]  # 去水印
    scale = 900.0 / w
    im = cv2.resize(im, (900, int(round(im.shape[0] * scale))), interpolation=cv2.INTER_AREA)
    dst = os.path.join(OUT, name + ".png")
    ok, buf = cv2.imencode(".png", im)
    if not ok:
        raise SystemExit("encode fail " + dst)
    buf.tofile(dst)
    print("ok", dst, im.shape[1], "x", im.shape[0], "|", note)
