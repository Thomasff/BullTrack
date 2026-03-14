#include "bulltrack_v2/Config.h"

#include <filesystem>
#include <stdexcept>

namespace bulltrack {

std::string DebugImagesPath() {
#ifdef DEBUG_IMAGES_PATH
    return DEBUG_IMAGES_PATH;
#else
    return "result";
#endif
}

std::string ResultImagesPath() {
#ifdef RESULT_IMAGES_PATH
    return RESULT_IMAGES_PATH;
#else
    return "images";
#endif
}

void EnsureDirectory(const std::string& path) {
    std::filesystem::create_directories(path);
}

int EnsureOddKernel(int kernel_size) {
    if (kernel_size < 1) {
        kernel_size = 1;
    }
    if (kernel_size % 2 == 0) {
        ++kernel_size;
    }
    return kernel_size;
}

}  // namespace bulltrack
