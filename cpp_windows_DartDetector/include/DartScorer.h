#ifndef DART_SCORER_H
#define DART_SCORER_H

#include <vector>
#include <string>
#include <cmath>
#include <utility>

class DartScorer {
public:
    DartScorer();
    ~DartScorer() = default;

    struct ScoreResult {
        int score;
        double x_norm;
        double y_norm;
        double r;
        double theta;
        std::string zone;
    };

    int calculateScore(double x_norm, double y_norm);
    ScoreResult scoreDart(double x_norm, double y_norm);
    std::vector<ScoreResult> scoreDarts(const std::vector<std::pair<double, double>>& positions);

private:
    static constexpr double DOUBLE_START       = 1.0;
    static constexpr double OUTER_SINGLE_START = 0.91265;
    static constexpr double TRIPLE_START       = 0.6443;
    static constexpr double INNER_SINGLE_START = 0.56708;
    static constexpr double BULL_CENTER        = 0.1392;

    static constexpr int CENTER_BULL_SCORE = 50;

    static const int SECTOR_SCORES[20];

    std::pair<double, double> cartesianToPolar(double x_norm, double y_norm) const;
    int getSectorIndex(double theta) const;
    std::string getZone(double r) const;
};

#endif
