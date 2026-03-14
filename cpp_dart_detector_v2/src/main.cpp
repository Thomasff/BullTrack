#include "Pipeline.h"

#include <iostream>
#include <stdexcept>
#include <string>

namespace {

struct CommandLineArgs {
    std::string before_image_path;
    std::string after_image_path;
    bool debug = false;
};

void PrintUsage(const char* program_name) {
    std::cout << "Usage: " << program_name << " <before_image> <after_image> [--debug]\n";
}

bool ParseArgs(int argc, char* argv[], CommandLineArgs& args) {
    if (argc < 3) return false;
    args.before_image_path = argv[1];
    args.after_image_path = argv[2];
    for (int i = 3; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--debug") {
            args.debug = true;
        } else if (arg == "--help" || arg == "-h") {
            return false;
        } else {
            throw std::runtime_error("未知参数: " + arg);
        }
    }
    return true;
}

}  // namespace

int main(int argc, char* argv[]) {
    CommandLineArgs args;
    try {
        if (!ParseArgs(argc, argv, args)) {
            PrintUsage(argv[0]);
            return 1;
        }

        bulltrack::PipelineConfig config;
        std::vector<cv::Point2f> positions = bulltrack::DetectDartPosition(args.before_image_path, args.after_image_path, config, args.debug);
        for (size_t i = 0; i < positions.size(); ++i) {
            std::cout << "D" << (i + 1) << ": (" << positions[i].x << ", " << positions[i].y << ")\n";
        }
        return 0;
    } catch (const std::exception& exc) {
        std::cerr << "Error: " << exc.what() << '\n';
        return 1;
    }
}
