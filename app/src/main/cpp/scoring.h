#ifndef SCORING_H
#define SCORING_H

#include <cmath>
#include <vector>

namespace bulltrack {

struct ScoreResult {
    int sector;
    int ringType;
    int score;
};

class Scoring {
public:
    static constexpr double DOUBLE_START = 0.9363;
    static constexpr double OUTER_SINGLE_START = 0.6369;
    static constexpr double TRIPLE_START = 0.5732;
    static constexpr double INNER_SINGLE_END = 0.5732;
    static constexpr double BULL_END = 0.121;
    
    static constexpr int CENTER_BULL_SCORE = 50;
    static constexpr int OUTER_BULL_SCORE = 25;
    
    static ScoreResult calculateScore(float normalizedX, float normalizedY);
    
    static void cartesianToPolar(float x, float y, float& r, float& theta);
    static int getSectorIndex(float theta);
    
private:
    static const int SECTOR_SCORES[20];
};

}

#endif
