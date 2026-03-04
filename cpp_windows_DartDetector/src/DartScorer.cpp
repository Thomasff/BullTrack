#define _USE_MATH_DEFINES
#include "DartScorer.h"
#include <cmath>
#include <iostream>
#include <iomanip>

const int DartScorer::SECTOR_SCORES[20] = {
    20, 1, 18, 4, 13, 6, 10, 15, 2, 17,
    3, 19, 7, 16, 8, 11, 14, 9, 12, 5
};

DartScorer::DartScorer() {
}

std::pair<double, double> DartScorer::cartesianToPolar(double x_norm, double y_norm) const {
    double r = std::sqrt(x_norm * x_norm + y_norm * y_norm);
    double theta = std::atan2(-y_norm, x_norm);
    if (theta < 0) {
        theta += 2 * M_PI;
    }
    return {r, theta};
}

int DartScorer::getSectorIndex(double theta) const {
    double sector_angle = 2 * M_PI / 20;
    double adjusted_theta = (M_PI / 2 - theta);
    adjusted_theta = std::fmod(adjusted_theta, 2 * M_PI);
    if (adjusted_theta < 0) {
        adjusted_theta += 2 * M_PI;
    }
    int sector_idx = static_cast<int>(adjusted_theta / sector_angle);
    return sector_idx % 20;
}

std::string DartScorer::getZone(double r) const {
    if (r < BULL_CENTER) {
        return "CENTER_BULL";
    } else if (r < INNER_SINGLE_START) {
        return "INNER_SINGLE";
    } else if (r < TRIPLE_START) {
        return "TRIPLE";
    } else if (r < OUTER_SINGLE_START) {
        return "OUTER_SINGLE";
    } else if (r <= DOUBLE_START) {
        return "DOUBLE";
    }
    return "MISS";
}

int DartScorer::calculateScore(double x_norm, double y_norm) {
    auto [r, theta] = cartesianToPolar(x_norm, y_norm);

    if (r < BULL_CENTER) {
        return CENTER_BULL_SCORE;
    }

    if (r > DOUBLE_START) {
        return 0;
    }

    int sector_idx = getSectorIndex(theta);
    int base_score = SECTOR_SCORES[sector_idx];

    if (r < INNER_SINGLE_START) {
        return base_score;
    }

    if (r < TRIPLE_START) {
        return base_score * 3;
    }

    if (r < OUTER_SINGLE_START) {
        return base_score;
    }

    return base_score * 2;
}

DartScorer::ScoreResult DartScorer::scoreDart(double x_norm, double y_norm) {
    ScoreResult result;
    result.x_norm = x_norm;
    result.y_norm = y_norm;

    auto [r, theta] = cartesianToPolar(x_norm, y_norm);
    result.r = r;
    result.theta = theta;

    result.score = calculateScore(x_norm, y_norm);
    result.zone = getZone(r);

    return result;
}

std::vector<DartScorer::ScoreResult> DartScorer::scoreDarts(const std::vector<std::pair<double, double>>& positions) {
    std::vector<ScoreResult> results;
    results.reserve(positions.size());

    for (size_t i = 0; i < positions.size(); ++i) {
        ScoreResult result = scoreDart(positions[i].first, positions[i].second);
        results.push_back(result);

        double theta_deg = result.theta * 180.0 / M_PI;
        
        std::cout << "Dart" << (i + 1) << ": coord=(" 
                  << std::fixed << std::setprecision(4) << result.x_norm << ", " << result.y_norm << "), "
                  << "polar=(r=" << std::setprecision(4) << result.r << ", theta=" << std::setprecision(2) << theta_deg << "deg), "
                  << "zone=" << result.zone << ", score=" << result.score << std::endl;
    }

    return results;
}
