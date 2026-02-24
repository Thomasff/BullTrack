#include "scoring.h"
#include <cmath>

namespace bulltrack {

const int Scoring::SECTOR_SCORES[20] = {20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5};

void Scoring::cartesianToPolar(float x, float y, float& r, float& theta) {
    r = std::sqrt(x * x + y * y);
    theta = std::atan2(-y, x);
    if (theta < 0) {
        theta += static_cast<float>(2 * M_PI);
    }
}

int Scoring::getSectorIndex(float theta) {
    float sectorAngle = static_cast<float>(2 * M_PI / 20);
    float adjustedTheta = std::fmod(static_cast<float>(M_PI / 2) - theta, static_cast<float>(2 * M_PI));
    if (adjustedTheta < 0) {
        adjustedTheta += static_cast<float>(2 * M_PI);
    }
    int sectorIdx = static_cast<int>(adjustedTheta / sectorAngle);
    return sectorIdx % 20;
}

ScoreResult Scoring::calculateScore(float normalizedX, float normalizedY) {
    ScoreResult result;
    result.sector = 0;
    result.ringType = 0;
    result.score = 0;
    
    float r, theta;
    cartesianToPolar(normalizedX, normalizedY, r, theta);
    
    if (r < BULL_END) {
        result.ringType = 5;
        result.score = CENTER_BULL_SCORE;
        return result;
    }
    
    if (r < INNER_SINGLE_END) {
        result.ringType = 4;
        result.score = OUTER_BULL_SCORE;
        return result;
    }
    
    int sectorIdx = getSectorIndex(theta);
    result.sector = SECTOR_SCORES[sectorIdx];
    
    if (r < TRIPLE_START) {
        result.ringType = 3;
        result.score = result.sector;
    } else if (r < OUTER_SINGLE_START) {
        result.ringType = 2;
        result.score = result.sector * 3;
    } else if (r < DOUBLE_START) {
        result.ringType = 1;
        result.score = result.sector * 2;
    } else {
        result.ringType = 0;
        result.score = 0;
    }
    
    return result;
}

}
