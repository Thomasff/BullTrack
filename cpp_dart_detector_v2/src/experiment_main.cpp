#include "Experiment.h"

#include <iostream>
#include <stdexcept>
#include <string>

namespace {

struct CommandLineArgs {
    std::string image_dir;
    bool debug = false;
};

void PrintUsage(const char* program_name) {
    std::cout << "Usage: " << program_name << " <image_dir> [--debug]\n";
}

bool ParseArgs(int argc, char* argv[], CommandLineArgs& args) {
    if (argc < 2) {
        return false;
    }
    args.image_dir = argv[1];
    for (int i = 2; i < argc; ++i) {
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

        bulltrack::PipelineConfig pipeline_config;
        bulltrack::ExperimentConfig experiment_config;
        const std::string output_dir = "test_track";
        std::vector<bulltrack::ExperimentFrameResult> results = bulltrack::RunPyramidEccExperiment(
            args.image_dir,
            output_dir,
            pipeline_config,
            experiment_config);

        std::cout << "固定 before: 已处理 1 张\n";
        std::cout << "after 对比数量: " << results.size() << "\n";
        std::cout << "结果目录: " << output_dir << "\n";
        for (const auto& result : results) {
            std::cout
                << result.image_name
                << ": corr=" << result.correlation
                << ", diff_sum=" << result.diff_sum
                << ", diff_nonzero_ratio=" << result.diff_nonzero_ratio
                << ", gate=" << result.gate_reason
                << ", precise=" << static_cast<int>(result.precise_detection_triggered)
                << "\n";
        }
        return 0;
    } catch (const std::exception& exc) {
        std::cerr << "Error: " << exc.what() << '\n';
        return 1;
    }
}

