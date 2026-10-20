#pragma once

#include <atomic>

#ifndef BT_ENABLE_DEBUG_IMAGES
#define BT_ENABLE_DEBUG_IMAGES 1
#endif

namespace bulltrack {

inline constexpr bool kDebugImagesEnabled = BT_ENABLE_DEBUG_IMAGES != 0;

// Debug images are compiled in by BT_ENABLE_DEBUG_IMAGES but only produced while the app's
// "show debug info" switch is on, so normal play skips the drawing and JPEG encoding.
inline std::atomic<bool> g_debug_images_runtime_enabled{false};

inline bool DebugImagesActive() {
    return kDebugImagesEnabled && g_debug_images_runtime_enabled.load(std::memory_order_relaxed);
}

inline void SetDebugImagesActive(bool enabled) {
    g_debug_images_runtime_enabled.store(enabled, std::memory_order_relaxed);
}

}  // namespace bulltrack
