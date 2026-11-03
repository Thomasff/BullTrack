import {
  classifyNativeError,
  NATIVE_ERROR_CATEGORIES,
  toFriendlyErrorText,
  toNativeErrorDebugText,
} from '../src/application/services/nativeErrorText';
import { describeGateReason } from '../src/application/services/nativeStatusText';
import { zh } from '../src/i18n/locales/zh';
import { en } from '../src/i18n/locales/en';

// Each C++ error code with the friendly category its old Chinese message fell into, except the
// red-bed failures (once generic, now boardUnclear); camera errors all mean the camera is unavailable.
const EXPECTED_CATEGORIES: Record<string, string> = {
  debug_image_encode_failed: 'generic',
  first_frame_board_box_invalid: 'boardNotFound',
  board_crop_input_empty: 'boardNotFound',
  board_crop_invalid: 'boardNotFound',
  board_not_found: 'boardNotFound',
  first_frame_empty: 'boardNotFound',
  resize_input_empty: 'generic',
  resize_target_invalid: 'generic',
  first_frame_rectification_missing: 'boardNotFound',
  first_frame_radius_invalid: 'boardNotFound',
  point_rectification_failed: 'generic',
  first_frame_preprocessed_empty: 'boardNotFound',
  round_not_started: 'generic',
  frame_empty: 'generic',
  redetect_frame_empty: 'generic',
  prep_frame_empty: 'generic',
  double_bed_points_failed: 'boardNotFound',
  no_red_regions: 'boardUnclear',
  no_long_red_regions: 'boardUnclear',
  too_few_perpendicular_double_beds: 'boardNotFound',
  too_few_double_seats: 'boardNotFound',
  double_seats_inconsistent: 'boardNotFound',
  unsupported_motion_type: 'generic',
  invalid_pyramid_levels: 'generic',
  ecc_size_mismatch: 'generic',
  ecc_alignment_failed: 'generic',
  dart_component_empty: 'dartNotFound',
  dart_diff_blank: 'dartNotFound',
  dart_contour_not_found: 'dartNotFound',
  image_not_found: 'generic',
  image_read_failed: 'generic',
  red_lab_input_empty: 'generic',
  bitmap_null: 'generic',
  bitmap_info_failed: 'generic',
  bitmap_format_invalid: 'generic',
  bitmap_pixels_failed: 'generic',
  rotation_invalid: 'generic',
  session_invalid: 'generic',
  no_round_photo: 'generic',
  board_not_in_photo: 'generic',
  ncnn_asset_manager_missing: 'generic',
  asset_open_failed: 'generic',
  asset_empty: 'generic',
  asset_read_failed: 'generic',
  classes_empty: 'generic',
  yolo_input_empty: 'generic',
  yolo_square_outside_frame: 'generic',
  ncnn_asset_manager_not_set: 'generic',
  yolo_param_load_failed: 'generic',
  yolo_bin_load_failed: 'generic',
  yolo_input_failed: 'generic',
  yolo_output_failed: 'generic',
  yolo_output_size_mismatch: 'generic',
  yolo_output_empty: 'generic',
  camera_init_failed: 'cameraUnavailable',
  camera_bind_failed: 'cameraUnavailable',
  camera_not_ready: 'cameraUnavailable',
  camera_context_missing: 'cameraUnavailable',
  capture_failed: 'cameraUnavailable',
  unsupported_image_format: 'cameraUnavailable',
  camera_image_decode_failed: 'cameraUnavailable',
};

test('every native error code keeps its friendly category, also with a detail', () => {
  expect(Object.keys(NATIVE_ERROR_CATEGORIES).sort()).toEqual(Object.keys(zh.native.errors).sort());
  expect(Object.keys(EXPECTED_CATEGORIES).sort()).toEqual(Object.keys(zh.native.errors).sort());
  Object.entries(EXPECTED_CATEGORIES).forEach(([code, category]) => {
    expect([code, classifyNativeError(code)]).toEqual([code, category]);
    expect([code, classifyNativeError(`${code}: some detail`)]).toEqual([code, category]);
  });
});

test('English messages from Kotlin keep their categories', () => {
  expect(classifyNativeError('board too small in frame')).toBe('boardTooSmall');
  expect(classifyNativeError('board too large in frame')).toBe('boardTooLarge');
  expect(classifyNativeError('board off the frame centre')).toBe('boardOffCentre');
  expect(classifyNativeError('Current activity is not available for native camera capture.')).toBe(
    'cameraUnavailable',
  );
  expect(classifyNativeError('unsupported_image_format: 35')).toBe('cameraUnavailable');
  expect(classifyNativeError('A live round is already running or awaiting confirmation.')).toBe('roundBusy');
  expect(classifyNativeError('GPU fallback: x; CPU failed: y')).toBe('generic');
  expect(toFriendlyErrorText('board_not_found')).toBe('没看到完整的靶盘，请把手机对准飞镖盘后重试');
});

test('debug text translates known codes and keeps the detail; other text stays raw', () => {
  expect(toNativeErrorDebugText('dart_contour_not_found')).toBe('未检测到飞镖轮廓');
  expect(toNativeErrorDebugText('asset_open_failed: ncnn/model.ncnn.param')).toBe(
    '无法打开 assets 文件: ncnn/model.ncnn.param',
  );
  expect(toNativeErrorDebugText('Native round failed: timeout')).toBe('Native round failed: timeout');
});

test('gate reasons, including the ones with extra text', () => {
  expect(describeGateReason('yolo_count_not_increased')).toBe('YOLO 飞镖数量未增加');
  expect(describeGateReason('yolo_detect_failed: precise_board_box_missing')).toBe('YOLO 检测失败');
  expect(describeGateReason('lost_box_no_settled_change change=0.1')).toBe(
    'YOLO 这张没认出新镖，图像对比也未确认',
  );
  expect(describeGateReason('yolo_count_increased_no_board_change change=0.02')).toBe(
    'YOLO 多出一个框，但靶上没有新变化，已忽略（change=0.02）',
  );
  expect(describeGateReason('')).toBe('未知原因');
  expect(describeGateReason('trigger_precise_detection')).toBe('trigger_precise_detection');
});

test('every native error code has English text', () => {
  Object.entries(en.native.errors).forEach(([code, text]) => {
    expect([code, text.trim().length > 0]).toEqual([code, true]);
  });
});
