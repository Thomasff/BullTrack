#pragma once

#ifndef BT_ENABLE_DEBUG_IMAGES
#define BT_ENABLE_DEBUG_IMAGES 1
#endif

namespace bulltrack {

inline constexpr bool kDebugImagesEnabled = BT_ENABLE_DEBUG_IMAGES != 0;

}  // namespace bulltrack
