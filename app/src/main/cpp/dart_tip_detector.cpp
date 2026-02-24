#include "dart_tip_detector.h"
#include "image_processor.h"
#include <algorithm>
#include <cmath>

namespace bulltrack {

DartTipDetector::DartTipDetector()
    : minArea_(200), minAspectRatio_(3.0f) {
}

cv::Mat DartTipDetector::computeDiffMask(const cv::Mat& before, const cv::Mat& after) {
    cv::Mat grayBefore = ImageProcessor::preprocess(before);
    cv::Mat grayAfter = ImageProcessor::preprocess(after);
    
    cv::Mat diff = ImageProcessor::computeDifference(grayBefore, grayAfter);
    cv::Mat thresh = ImageProcessor::threshold(diff, 10, 255);
    
    thresh = ImageProcessor::morphologicalClose(thresh, 3);
    thresh = ImageProcessor::morphologicalOpen(thresh, 3);
    
    return thresh;
}

std::vector<cv::Rect> DartTipDetector::findCandidateRegions(const cv::Mat& mask) {
    std::vector<cv::Rect> regions;
    
    cv::Mat labels, stats, centroids;
    int numLabels = cv::connectedComponentsWithStats(mask, labels, stats, centroids, 8);
    
    for (int label = 1; label < numLabels; label++) {
        int area = stats.at<int>(label, cv::CC_STAT_AREA);
        int x = stats.at<int>(label, cv::CC_STAT_LEFT);
        int y = stats.at<int>(label, cv::CC_STAT_TOP);
        int w = stats.at<int>(label, cv::CC_STAT_WIDTH);
        int h = stats.at<int>(label, cv::CC_STAT_HEIGHT);
        
        if (area < minArea_) {
            continue;
        }
        
        int minDim = std::min(w, h);
        if (minDim == 0) continue;
        
        float aspectRatio = static_cast<float>(std::max(w, h)) / minDim;
        
        if (aspectRatio < minAspectRatio_) {
            continue;
        }
        
        regions.emplace_back(x, y, w, h);
    }
    
    return regions;
}

std::vector<cv::Point2i> DartTipDetector::extractTipsFromRegion(const cv::Mat& mask, const cv::Rect& region) {
    std::vector<cv::Point2i> tips;
    
    cv::Mat regionMask = mask(region);
    
    std::vector<cv::Point2f> points;
    for (int y = 0; y < regionMask.rows; y++) {
        for (int x = 0; x < regionMask.cols; x++) {
            if (regionMask.at<uchar>(y, x) > 0) {
                points.emplace_back(static_cast<float>(x), static_cast<float>(y));
            }
        }
    }
    
    if (points.size() < 10) {
        return tips;
    }
    
    cv::Mat data(points.size(), 2, CV_32F);
    for (size_t i = 0; i < points.size(); i++) {
        data.at<float>(i, 0) = points[i].x;
        data.at<float>(i, 1) = points[i].y;
    }
    
    cv::PCA pca(data, cv::Mat(), cv::PCA::DATA_AS_ROW);
    cv::Vec2f mean = pca.mean;
    cv::Vec2f direction = pca.eigenvectors.row(0);
    
    if (direction[0] > 0) {
        direction = -direction;
    }
    
    std::vector<float> projections;
    for (const auto& pt : points) {
        float proj = (pt.x - mean[0]) * direction[0] + (pt.y - mean[1]) * direction[1];
        projections.push_back(proj);
    }
    
    float tMin = *std::min_element(projections.begin(), projections.end());
    float tMax = *std::max_element(projections.begin(), projections.end());
    float tMid = (tMin + tMax) / 2;
    
    cv::Mat keptMask = cv::Mat::zeros(regionMask.size(), CV_8UC1);
    for (size_t i = 0; i < points.size(); i++) {
        if (projections[i] > tMid) {
            int x = static_cast<int>(points[i].x);
            int y = static_cast<int>(points[i].y);
            if (x >= 0 && x < regionMask.cols && y >= 0 && y < regionMask.rows) {
                keptMask.at<uchar>(y, x) = 255;
            }
        }
    }
    
    cv::Mat kernel = cv::getStructuringElement(cv::MORPH_RECT, cv::Size(3, 3));
    cv::morphologyEx(keptMask, keptMask, cv::MORPH_CLOSE, kernel);
    
    cv::Mat keptLabels;
    int numLabels = cv::connectedComponents(keptMask, keptLabels, 8);
    
    for (int label = 1; label < numLabels; label++) {
        std::vector<cv::Point2f> componentPoints;
        std::vector<float> componentProjections;
        
        for (int y = 0; y < keptLabels.rows; y++) {
            for (int x = 0; x < keptLabels.cols; x++) {
                if (keptLabels.at<int>(y, x) == label) {
                    componentPoints.emplace_back(static_cast<float>(x), static_cast<float>(y));
                    float proj = (x - mean[0]) * direction[0] + (y - mean[1]) * direction[1];
                    componentProjections.push_back(proj);
                }
            }
        }
        
        if (componentPoints.empty()) {
            continue;
        }
        
        int maxIdx = std::distance(componentProjections.begin(), 
                                   std::max_element(componentProjections.begin(), componentProjections.end()));
        
        int tipX = static_cast<int>(componentPoints[maxIdx].x) + region.x;
        int tipY = static_cast<int>(componentPoints[maxIdx].y) + region.y;
        tips.emplace_back(tipX, tipY);
    }
    
    return tips;
}

DetectedTip DartTipDetector::normalizePosition(const cv::Point2i& tip, int cx, int cy, int radius) {
    DetectedTip result;
    result.x = static_cast<float>(tip.x);
    result.y = static_cast<float>(tip.y);
    result.normalizedX = static_cast<float>(tip.x - cx) / static_cast<float>(radius);
    result.normalizedY = static_cast<float>(tip.y - cy) / static_cast<float>(radius);
    return result;
}

std::vector<DetectedTip> DartTipDetector::detect(
    const cv::Mat& imageBefore,
    const cv::Mat& imageAfter,
    int boardCenterX,
    int boardCenterY,
    int boardRadius,
    int maxDarts
) {
    std::vector<DetectedTip> results;
    
    cv::Mat diffMask = computeDiffMask(imageBefore, imageAfter);
    
    if (cv::countNonZero(diffMask) == 0) {
        return results;
    }
    
    auto regions = findCandidateRegions(diffMask);
    
    if (regions.empty()) {
        return results;
    }
    
    for (size_t i = 0; i < regions.size() && static_cast<int>(i) < maxDarts; i++) {
        auto tips = extractTipsFromRegion(diffMask, regions[i]);
        
        for (const auto& tip : tips) {
            if (static_cast<int>(results.size()) >= maxDarts) {
                break;
            }
            results.push_back(normalizePosition(tip, boardCenterX, boardCenterY, boardRadius));
        }
    }
    
    return results;
}

}
