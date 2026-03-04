import math
import sys
import os
import argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dart_detector import detect_dart_position


DOUBLE_START = 0.935
OUTER_SINGLE_START = 0.645
TRIPLE_START = 0.57
INNER_SINGLE_END = 0.57
BULL_END = 0.14

SECTOR_SCORES = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]

CENTER_BULL_SCORE = 50
OUTER_BULL_SCORE = 25


def cartesian_to_polar(x_norm, y_norm):
    r = math.sqrt(x_norm ** 2 + y_norm ** 2)
    theta = math.atan2(-y_norm, x_norm)
    if theta < 0:
        theta += 2 * math.pi
    return r, theta


def get_sector_index(theta):
    sector_angle = 2 * math.pi / 20
    adjusted_theta = (math.pi / 2 - theta) % (2 * math.pi)
    sector_idx = int(adjusted_theta / sector_angle)
    return sector_idx % 20


def calculate_score(x_norm, y_norm):
    r, theta = cartesian_to_polar(x_norm, y_norm)

    if r < BULL_END:
        return CENTER_BULL_SCORE

    if r < INNER_SINGLE_END:
        sector_idx = get_sector_index(theta)
        return SECTOR_SCORES[sector_idx]

    if r < TRIPLE_START:
        sector_idx = get_sector_index(theta)
        return SECTOR_SCORES[sector_idx] * 3

    if r < OUTER_SINGLE_START:
        sector_idx = get_sector_index(theta)
        return SECTOR_SCORES[sector_idx]

    if r < DOUBLE_START:
        sector_idx = get_sector_index(theta)
        return SECTOR_SCORES[sector_idx] * 2

    return 0


def score_darts(img_before_path, img_after_path, min_area=200, min_aspect_ratio=3.0, debug=False):
    normalized_positions = detect_dart_position(img_before_path, img_after_path, min_area=min_area, min_aspect_ratio=min_aspect_ratio, debug=debug)

    scores = []
    for i, (x_norm, y_norm) in enumerate(normalized_positions):
        score = calculate_score(x_norm, y_norm)
        scores.append(score)
        r, theta = cartesian_to_polar(x_norm, y_norm)
        print(f"飞镖{i+1}: 坐标=({x_norm:.4f}, {y_norm:.4f}), 极坐标=(r={r:.4f}, theta={math.degrees(theta):.2f}°), 分数={score}")

    return scores


def main():
    parser = argparse.ArgumentParser(description="飞镖计分系统")
    parser.add_argument("before", help="空靶图片路径")
    parser.add_argument("after", help="飞镖插入后的图片路径")
    parser.add_argument("--debug", action="store_true", help="生成调试图像")
    parser.add_argument("--min-area", type=float, default=200,
                       help="连通域最小面积阈值 (默认: 200)")
    parser.add_argument("--min-aspect-ratio", type=float, default=3.0,
                       help="连通域最小长宽比 (默认: 3.0)")

    args = parser.parse_args()

    scores = score_darts(args.before, args.after, min_area=args.min_area, min_aspect_ratio=args.min_aspect_ratio, debug=args.debug)
    print(f"\n最终分数: {scores}")


if __name__ == "__main__":
    main()
