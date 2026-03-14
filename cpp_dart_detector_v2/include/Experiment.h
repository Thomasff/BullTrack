#pragma once

#include "Config.h"

#include <string>
#include <vector>

namespace bulltrack {

struct ExperimentFrameResult {
    std::string image_name;
    std::string compared_to;
    std::string output_dir;
    double correlation = 0.0;
    std::vector<double> level_correlations;
    std::vector<int> level_iterations;
    long long diff_sum = 0;
    double diff_mean = 0.0;
    int diff_max = 0;
    int diff_nonzero_count = 0;
    double diff_nonzero_ratio = 0.0;
    bool gate_has_dart = false;
    std::string gate_reason;
    int closed_longest_edge = 0;
    int filtered_longest_edge = 0;
    int filtered_longest_box_area = 0;
    int filtered_longest_box_white_area = 0;
    double filtered_longest_box_fill_ratio = 0.0;
    bool precise_detection_triggered = false;
    std::string precise_detection_output_dir;
    int precise_detection_count = 0;
    std::string precise_detection_reason;
    std::string precise_detection_point_norm;
};

std::vector<ExperimentFrameResult> RunPyramidEccExperiment(
    const std::string& image_dir,
    const std::string& output_dir,
    const PipelineConfig& pipeline_config,
    const ExperimentConfig& experiment_config);

}  // namespace bulltrack

