import cv2
import numpy as np
import argparse
import os
import sys


def preprocess_image(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    return gray


def skeletonize(binary_img):
    height, width = binary_img.shape
    skeleton = np.zeros((height, width), dtype=np.uint8)
    
    element = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
    
    while True:
        eroded = cv2.erode(binary_img, element)
        opened = cv2.morphologyEx(eroded, cv2.MORPH_OPEN, element)
        temp = cv2.subtract(eroded, opened)
        skeleton = cv2.bitwise_or(skeleton, temp)
        binary_img = eroded.copy()
        
        if cv2.countNonZero(binary_img) == 0:
            break
    
    return skeleton


def detect_skeleton_endpoints(skeleton):
    height, width = skeleton.shape
    endpoints = []
    
    kernel = np.array([[1, 1, 1],
                       [1, 10, 1],
                       [1, 1, 1]], dtype=np.uint8)
    
    neighbors = cv2.filter2D(skeleton, -1, kernel)
    
    endpoint_mask = (skeleton > 0) & (neighbors == 11)
    endpoints_coords = np.argwhere(endpoint_mask)
    
    for y, x in endpoints_coords:
        endpoints.append((x, y))
    
    return endpoints


def calculate_local_width(binary_img, endpoint, max_distance=15):
    x, y = endpoint
    height, width = binary_img.shape
    
    distances = cv2.distanceTransform(binary_img, cv2.DIST_L2, 5)
    
    x_start = max(0, x - max_distance)
    x_end = min(width, x + max_distance + 1)
    y_start = max(0, y - max_distance)
    y_end = min(height, y + max_distance + 1)
    
    local_distances = distances[y_start:y_end, x_start:x_end]
    local_binary = binary_img[y_start:y_end, x_start:x_end]
    
    if np.sum(local_binary) == 0:
        return float('inf')
    
    avg_distance = np.mean(local_distances[local_binary > 0])
    
    return avg_distance


def filter_connected_components(binary_img, min_area=200, min_aspect_ratio=1.5, debug=False):
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(binary_img, connectivity=8)
    
    filtered_mask = np.zeros_like(binary_img, dtype=np.uint8)
    valid_components = []
    
    for label in range(1, num_labels):
        area = stats[label, cv2.CC_STAT_AREA]
        x = stats[label, cv2.CC_STAT_LEFT]
        y = stats[label, cv2.CC_STAT_TOP]
        w = stats[label, cv2.CC_STAT_WIDTH]
        h = stats[label, cv2.CC_STAT_HEIGHT]
        
        if area < min_area:
            continue
        
        aspect_ratio = max(w, h) / min(w, h) if min(w, h) > 0 else 0
        
        if aspect_ratio < min_aspect_ratio:
            continue
        
        component_mask = (labels == label).astype(np.uint8)
        filtered_mask = cv2.bitwise_or(filtered_mask, component_mask)
        
        valid_components.append({
            'label': label,
            'area': area,
            'x': x,
            'y': y,
            'w': w,
            'h': h,
            'aspect_ratio': aspect_ratio,
            'mask': component_mask
        })
    
    if debug:
        debug_img = cv2.cvtColor(binary_img * 255, cv2.COLOR_GRAY2BGR)
        colors = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0), (255, 0, 255), (0, 255, 255)]
        for i, comp in enumerate(valid_components):
            color = colors[i % len(colors)]
            cv2.rectangle(debug_img, (comp['x'], comp['y']), 
                         (comp['x'] + comp['w'], comp['y'] + comp['h']), color, 2)
            cv2.putText(debug_img, f"#{i+1}:A={comp['area']},R={comp['aspect_ratio']:.1f}", 
                       (comp['x'], comp['y'] - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
        cv2.imwrite("debug_03_filtered_components.jpg", debug_img)
        print(f"调试图像已保存到: debug_03_filtered_components.jpg (保留 {len(valid_components)} 个连通域)")
    
    return filtered_mask, valid_components


def compute_pca_direction(points):
    mean, eigenvectors = cv2.PCACompute(points, mean=None)
    direction = eigenvectors[0]
    
    if direction[0] > 0:
        direction = -direction
    
    return mean[0], direction


def extract_dart_tips_from_component(component_mask, debug=False, debug_idx=0):
    points = np.argwhere(component_mask > 0).astype(np.float32)
    points = points[:, [1, 0]]
    
    if len(points) < 10:
        return []
    
    mean, direction = compute_pca_direction(points)
    
    projections = np.dot(points - mean, direction)
    t_min = np.min(projections)
    t_max = np.max(projections)
    t_mid = (t_min + t_max) / 2
    
    kept_mask = projections > t_mid
    kept_points = points[kept_mask]
    
    if len(kept_points) == 0:
        return []
    
    kept_mask_img = np.zeros(component_mask.shape, dtype=np.uint8)
    for pt in kept_points:
        x, y = int(pt[0]), int(pt[1])
        if 0 <= y < component_mask.shape[0] and 0 <= x < component_mask.shape[1]:
            kept_mask_img[y, x] = 1
    
    kernel = np.ones((3, 3), np.uint8)
    kept_mask_img = cv2.morphologyEx(kept_mask_img, cv2.MORPH_CLOSE, kernel)
    
    num_labels, labels = cv2.connectedComponents(kept_mask_img, connectivity=8)
    
    tip_points = []
    for label in range(1, num_labels):
        component_points = []
        for y in range(labels.shape[0]):
            for x in range(labels.shape[1]):
                if labels[y, x] == label:
                    component_points.append([x, y])
        
        if len(component_points) == 0:
            continue
        
        component_points = np.array(component_points, dtype=np.float32)
        component_projections = np.dot(component_points - mean, direction)
        tip_idx = np.argmax(component_projections)
        tip_point = component_points[tip_idx]
        tip_points.append((int(tip_point[0]), int(tip_point[1])))
    
    if debug:
        debug_img = cv2.cvtColor(component_mask * 255, cv2.COLOR_GRAY2BGR)
        
        center = (int(mean[0]), int(mean[1]))
        direction_end = (int(mean[0] + direction[0] * 100), int(mean[1] + direction[1] * 100))
        cv2.line(debug_img, center, direction_end, (0, 255, 0), 2)
        
        cut_line_start = mean + direction * t_mid
        perp = np.array([-direction[1], direction[0]])
        cut_line_end = cut_line_start + perp * 50
        cut_line_start2 = cut_line_start - perp * 50
        cv2.line(debug_img, (int(cut_line_start2[0]), int(cut_line_start2[1])), 
                (int(cut_line_end[0]), int(cut_line_end[1])), (255, 0, 0), 2)
        
        colors = [(0, 0, 255), (255, 255, 0), (255, 0, 255), (0, 255, 255)]
        for i, (tip_x, tip_y) in enumerate(tip_points):
            color = colors[i % len(colors)]
            cv2.circle(debug_img, (tip_x, tip_y), 8, color, -1)
            cv2.putText(debug_img, f"T{i+1}", (tip_x + 10, tip_y - 10),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
        
        cv2.imwrite(f"debug_04_pca_component_{debug_idx}.jpg", debug_img)
        print(f"调试图像已保存到: debug_04_pca_component_{debug_idx}.jpg (检测到 {len(tip_points)} 个落点)")
    
    return tip_points


def detect_dart_tips_pca(binary_img, valid_components, max_darts=3, debug=False):
    tip_points = []
    
    for i, component in enumerate(valid_components[:max_darts]):
        tips = extract_dart_tips_from_component(component['mask'], debug=debug, debug_idx=i)
        tip_points.extend(tips)
    
    if len(tip_points) == 0:
        raise ValueError("未检测到飞镖尖端")
    
    if debug:
        debug_img = cv2.cvtColor(binary_img * 255, cv2.COLOR_GRAY2BGR)
        colors = [(255, 0, 0), (0, 255, 0), (0, 0, 255)]
        for i, (tip_x, tip_y) in enumerate(tip_points):
            color = colors[i % len(colors)]
            cv2.circle(debug_img, (tip_x, tip_y), 10, color, -1)
            cv2.putText(debug_img, f"D{i+1}", (tip_x + 15, tip_y - 10),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
        cv2.imwrite("debug_05_pca_tips.jpg", debug_img)
        print(f"调试图像已保存到: debug_05_pca_tips.jpg (检测到 {len(tip_points)} 个尖端)")
    
    return tip_points


def detect_multiple_dart_tips(binary_img, max_darts=3, debug=False):
    skeleton = skeletonize(binary_img)
    
    if debug:
        cv2.imwrite("debug_04_skeleton.jpg", skeleton * 255)
        print("调试图像已保存到: debug_04_skeleton.jpg")
    
    endpoints = detect_skeleton_endpoints(skeleton)
    
    if debug:
        debug_img = cv2.cvtColor(binary_img * 255, cv2.COLOR_GRAY2BGR)
        for i, (x, y) in enumerate(endpoints):
            color = (0, 255, 0) if i < max_darts else (0, 0, 255)
            cv2.circle(debug_img, (x, y), 3, color, -1)
        cv2.imwrite("debug_05_endpoints.jpg", debug_img)
        print(f"调试图像已保存到: debug_05_endpoints.jpg (共检测到 {len(endpoints)} 个端点)")
    
    if len(endpoints) == 0:
        raise ValueError("未检测到骨架端点")
    
    endpoint_widths = []
    for endpoint in endpoints:
        width = calculate_local_width(binary_img, endpoint)
        endpoint_widths.append((endpoint, width))
    
    endpoint_widths.sort(key=lambda x: x[1])
    
    selected_endpoints = endpoint_widths[:max_darts]
    
    if debug:
        debug_img2 = cv2.cvtColor(binary_img * 255, cv2.COLOR_GRAY2BGR)
        for i, ((x, y), width) in enumerate(selected_endpoints):
            cv2.circle(debug_img2, (x, y), 5, (0, 0, 255), -1)
            cv2.putText(debug_img2, f"{i+1}:w={width:.1f}", 
                       (x + 10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)
        cv2.imwrite("debug_06_selected_tips.jpg", debug_img2)
        print(f"调试图像已保存到: debug_06_selected_tips.jpg (选择了 {len(selected_endpoints)} 个尖端)")
    
    return [(int(x), int(y)) for (x, y), width in selected_endpoints]


def detect_aruco_markers(img, debug=False):
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    parameters = cv2.aruco.DetectorParameters()
    detector = cv2.aruco.ArucoDetector(aruco_dict, parameters)
    
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    corners, ids, rejected = detector.detectMarkers(gray)
    
    if ids is None or len(ids) == 0:
        raise ValueError("未检测到 ArUco 标记")
    
    required_ids = [0, 1, 2, 3]
    marker_corners = {}
    
    for i, marker_id in enumerate(ids):
        marker_id = int(marker_id[0])
        if marker_id in required_ids:
            marker_corners[marker_id] = corners[i][0]
    
    if len(marker_corners) != 4:
        raise ValueError(f"未检测到全部 4 个 ArUco 标记，只检测到 {len(marker_corners)} 个")
    
    src_points = np.zeros((4, 2), dtype=np.float32)
    src_points[0] = marker_corners[0][0]
    src_points[1] = marker_corners[1][0]
    src_points[2] = marker_corners[2][0]
    src_points[3] = marker_corners[3][0]
    
    if debug:
        debug_img = img.copy()
        for marker_id in [0, 1, 2, 3]:
            if marker_id in marker_corners:
                corner = marker_corners[marker_id]
                cv2.polylines(debug_img, [corner.astype(np.int32)], True, (0, 255, 0), 2)
                cv2.putText(debug_img, f"ID:{marker_id}", 
                           (int(corner[0][0]), int(corner[0][1]) - 10),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                cv2.circle(debug_img, (int(corner[0][0]), int(corner[0][1])), 5, (255, 0, 0), -1)
        
        for i, point in enumerate(src_points):
            cv2.putText(debug_img, f"P{i}", (int(point[0]) + 10, int(point[1])),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 0), 2)
        
        cv2.imwrite("debug_aruco_markers.jpg", debug_img)
        print("调试图像已保存到: debug_aruco_markers.jpg")
    
    return src_points


def compute_homography_and_warp(img, src_points, debug=False):
    height, width = img.shape[:2]
    
    side_length = 800
    marker_region_size = 80
    vertical_offset = side_length // 6
    
    dst_points = np.array([
        [0, vertical_offset],
        [marker_region_size - 1, vertical_offset],
        [0, vertical_offset + marker_region_size - 1],
        [marker_region_size - 1, vertical_offset + marker_region_size - 1]
    ], dtype=np.float32)
    
    H, _ = cv2.findHomography(src_points, dst_points, cv2.RANSAC, 5.0)
    
    warped = cv2.warpPerspective(img, H, (side_length, side_length))
    
    if debug:
        os.makedirs("result", exist_ok=True)
        warped_path = os.path.join("result", "front_view.jpg")
        cv2.imwrite(warped_path, warped)
        print(f"矫正后的正视图已保存到: {warped_path}")
        
        H_path = os.path.join("result", "homography_matrix.txt")
        np.savetxt(H_path, H, fmt='%.6f')
        print(f"单应性矩阵已保存到: {H_path}")
    
    return warped, H


def detect_board_circle(img_before, debug=False):
    gray = preprocess_image(img_before)
    
    height, width = gray.shape
    min_dist = min(height, width) // 4
    max_radius = min(height, width) // 2 - 10
    
    circles = cv2.HoughCircles(
        gray,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=min_dist,
        param1=50,
        param2=50,
        minRadius=50,
        maxRadius=max_radius
    )
    
    if circles is None:
        raise ValueError("未检测到靶盘圆")
    
    circles = np.round(circles[0, :]).astype("int")
    
    if debug:
        debug_img_all = img_before.copy()
        for i, (cx, cy, R) in enumerate(circles):
            color = (0, 255, 0) if i == 0 else (255, 0, 0)
            cv2.circle(debug_img_all, (cx, cy), R, color, 2)
            cv2.circle(debug_img_all, (cx, cy), 5, color, -1)
            cv2.putText(debug_img_all, f"R={R}", (cx - 30, cy - R - 10), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
        cv2.imwrite("debug_00_all_circles.jpg", debug_img_all)
        print(f"调试图像已保存到: debug_00_all_circles.jpg (共检测到 {len(circles)} 个圆)")
    
    center_x, center_y = width // 2, height // 2
    
    best_circle = None
    best_score = -1
    
    for cx, cy, R in circles:
        dist_to_center = np.sqrt((cx - center_x)**2 + (cy - center_y)**2)
        center_score = 1.0 / (1.0 + dist_to_center / 100)
        radius_score = R / max_radius
        total_score = center_score * 0.7 + radius_score * 0.3
        
        if total_score > best_score:
            best_score = total_score
            best_circle = (cx, cy, R)
    
    cx, cy, R = best_circle
    
    if debug:
        debug_img = img_before.copy()
        cv2.circle(debug_img, (cx, cy), 8, (0, 0, 255), -1)
        cv2.circle(debug_img, (cx, cy), R, (0, 255, 0), 3)
        cv2.putText(debug_img, f"Center: ({cx}, {cy})", 
                   (cx - 100, cy - R - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
        cv2.putText(debug_img, f"Radius: {R}", 
                   (cx - 100, cy - R + 10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
        cv2.circle(debug_img, (center_x, center_y), 5, (255, 255, 0), -1)
        cv2.putText(debug_img, f"Image Center", 
                   (center_x + 10, center_y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 1)
        cv2.imwrite("debug_00_board_circle.jpg", debug_img)
        print("调试图像已保存到: debug_00_board_circle.jpg")
    
    return cx, cy, R


def detect_dart_tip(img_before, img_after, min_area=200, min_aspect_ratio=3.0, debug=False):
    gray_before = preprocess_image(img_before)
    gray_after = preprocess_image(img_after)
    
    diff = cv2.absdiff(gray_before, gray_after)
    
    _, thresh = cv2.threshold(diff, 10, 255, cv2.THRESH_BINARY)
    
    kernel = np.ones((3, 3), np.uint8)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
    
    binary_img = thresh // 255
    
    if debug:
        cv2.imwrite("debug_01_diff.jpg", diff)
        print("调试图像已保存到: debug_01_diff.jpg")
        cv2.imwrite("debug_02_thresh.jpg", thresh)
        print("调试图像已保存到: debug_02_thresh.jpg")
    
    if np.sum(binary_img) == 0:
        raise ValueError("未检测到飞镖轮廓")
    
    _, valid_components = filter_connected_components(
        binary_img, min_area=min_area, min_aspect_ratio=min_aspect_ratio, debug=debug
    )
    
    if len(valid_components) == 0:
        raise ValueError("过滤后未检测到飞镖轮廓")
    
    tip_points = detect_dart_tips_pca(binary_img, valid_components, max_darts=3, debug=debug)
    
    if debug:
        debug_img = img_after.copy()
        for i, (tip_x, tip_y) in enumerate(tip_points):
            color = [(255, 0, 0), (0, 255, 0), (0, 0, 255)][i % 3]
            cv2.circle(debug_img, (tip_x, tip_y), 8, color, -1)
            cv2.putText(debug_img, f"Dart{i+1}", 
                       (tip_x + 10, tip_y - 10),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
        cv2.imwrite("debug_dart_detection.jpg", debug_img)
        print("调试图像已保存到: debug_dart_detection.jpg")
    
    return tip_points


def normalize(tip_x, tip_y, cx, cy, R):
    x_norm = float(tip_x - cx) / float(R)
    y_norm = float(tip_y - cy) / float(R)
    return x_norm, y_norm


def detect_dart_position(img_before_path, img_after_path, min_area=200, min_aspect_ratio=3.0, debug=False):
    if not os.path.exists(img_before_path):
        raise FileNotFoundError(f"未找到图片: {img_before_path}")
    if not os.path.exists(img_after_path):
        raise FileNotFoundError(f"未找到图片: {img_after_path}")
    
    img_before = cv2.imread(img_before_path)
    img_after = cv2.imread(img_after_path)
    
    if img_before is None:
        raise ValueError(f"无法读取图片: {img_before_path}")
    if img_after is None:
        raise ValueError(f"无法读取图片: {img_after_path}")
    
    src_points = detect_aruco_markers(img_before, debug=debug)
    warped_before, H = compute_homography_and_warp(img_before, src_points, debug=debug)
    warped_after = cv2.warpPerspective(img_after, H, (800, 800))
    
    if debug:
        os.makedirs("result", exist_ok=True)
        warped_after_path = os.path.join("result", "front_view_after.jpg")
        cv2.imwrite(warped_after_path, warped_after)
        print(f"矫正后的 after 图像已保存到: {warped_after_path}")
    
    cx, cy, R = detect_board_circle(warped_before, debug=debug)
    print(f"靶盘圆心: ({cx}, {cy}), 半径: {R}")
    
    tip_points = detect_dart_tip(
        warped_before, warped_after, min_area=min_area, min_aspect_ratio=min_aspect_ratio, debug=debug
    )
    print(f"检测到 {len(tip_points)} 支飞镖")
    
    normalized_positions = []
    for i, (tip_x, tip_y) in enumerate(tip_points):
        x_norm, y_norm = normalize(tip_x, tip_y, cx, cy, R)
        normalized_positions.append((x_norm, y_norm))
        print(f"飞镖{i+1}尖端: ({tip_x}, {tip_y}), 标准化坐标: ({x_norm:.4f}, {y_norm:.4f})")
    
    result_img = warped_after.copy()
    cv2.circle(result_img, (cx, cy), 8, (0, 0, 255), -1)
    cv2.circle(result_img, (cx, cy), R, (0, 255, 0), 3)
    
    colors = [(255, 0, 0), (0, 255, 0), (0, 0, 255)]
    for i, (tip_x, tip_y) in enumerate(tip_points):
        x_norm, y_norm = normalized_positions[i]
        color = colors[i % 3]
        cv2.circle(result_img, (tip_x, tip_y), 10, color, -1)
        cv2.line(result_img, (cx, cy), (tip_x, tip_y), (255, 255, 0), 2)
        cv2.putText(result_img, f"D{i+1}:({x_norm:.3f},{y_norm:.3f})", 
                   (tip_x + 15, tip_y), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 3)
        cv2.putText(result_img, f"D{i+1}:({x_norm:.3f},{y_norm:.3f})", 
                   (tip_x + 15, tip_y), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 1)
    
    os.makedirs("images", exist_ok=True)
    result_path = os.path.join("images", "result.jpg")
    cv2.imwrite(result_path, result_img)
    print(f"结果可视化已保存到: {result_path}")
    
    return normalized_positions


def main():
    parser = argparse.ArgumentParser(description="飞镖自动记分系统 MVP")
    parser.add_argument("before", help="空靶图片路径")
    parser.add_argument("after", help="飞镖插入后的图片路径")
    parser.add_argument("--debug", action="store_true", help="生成调试图像")
    parser.add_argument("--min-area", type=float, default=200, 
                       help="连通域最小面积阈值 (默认: 200)")
    parser.add_argument("--min-aspect-ratio", type=float, default=3.0, 
                       help="连通域最小长宽比 (默认: 3.0)")
    
    args = parser.parse_args()
    
    try:
        normalized_positions = detect_dart_position(
            args.before, args.after, 
            min_area=args.min_area, 
            min_aspect_ratio=args.min_aspect_ratio,
            debug=args.debug
        )
        print(f"\n检测到 {len(normalized_positions)} 支飞镖")
        print(f"坐标范围: x ∈ [-1, 1], y ∈ [-1, 1]")
        print(f"靶心位置: (0, 0)")
        
        for i, (x_norm, y_norm) in enumerate(normalized_positions):
            print(f"\n飞镖{i+1}:")
            print(f"  标准化坐标: ({x_norm:.4f}, {y_norm:.4f})")
            distance = np.sqrt(x_norm**2 + y_norm**2)
            print(f"  距离靶心: {distance:.4f}")
        
        return 0
    except Exception as e:
        print(f"错误: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
