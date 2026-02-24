#include "dart_detector.h"
#include <opencv2/imgproc.hpp>
#include <opencv2/highgui.hpp>
#include <algorithm>
#include <cmath>

namespace bulltrack {

DartDetector::DartDetector() 
    : minArea_(200), minAspectRatio_(3.0f) {
}

DartDetector::~DartDetector() = default;

cv::Mat DartDetector::preprocessImage(const cv::Mat& img) {
    cv::Mat gray;
    if (img.channels() == 3) {
        cv::cvtColor(img, gray, cv::COLOR_BGR2GRAY);
    } else {
        gray = img.clone();
    }
    cv::GaussianBlur(gray, gray, cv::Size(5, 5), 0);
    return gray;
}

cv::Mat DartDetector::skeletonize(const cv::Mat& binaryImg) {
    cv::Mat skeleton = cv::Mat::zeros(binaryImg.size(), CV_8UC1);
    cv::Mat temp;
    cv::Mat eroded;
    
    cv::Mat element = cv::getStructuringElement(cv::MORPH_CROSS, cv::Size(3, 3));
    cv::Mat img = binaryImg.clone();
    
    while (true) {
        cv::erode(img, eroded, element);
        cv::morphologyEx(eroded, temp, cv::MORPH_OPEN, element);
        cv::subtract(eroded, temp, temp);
        cv::bitwise_or(skeleton, temp, skeleton);
        eroded.copyTo(img);
        
        if (cv::countNonZero(img) == 0) {
            break;
        }
    }
    
    return skeleton;
}

std::vector<cv::Point2i> DartDetector::detectSkeletonEndpoints(const cv::Mat& skeleton) {
    std::vector<cv::Point2i> endpoints;
    
    cv::Mat kernel = (cv::Mat_<uchar>(3, 3) << 1, 1, 1, 1, 10, 1, 1, 1, 1);
    cv::Mat neighbors;
    cv::filter2D(skeleton, neighbors, CV_32F, kernel);
    
    for (int y = 0; y < skeleton.rows; y++) {
        for (int x = 0; x < skeleton.cols; x++) {
            if (skeleton.at<uchar>(y, x) > 0 && neighbors.at<float>(y, x) == 11) {
                endpoints.emplace_back(x, y);
            }
        }
    }
    
    return endpoints;
}

float DartDetector::calculateLocalWidth(const cv::Mat& binaryImg, const cv::Point2i& endpoint, int maxDistance) {
    cv::Mat distances;
    cv::distanceTransform(binaryImg, distances, cv::DIST_L2, 5);
    
    int x = endpoint.x;
    int y = endpoint.y;
    
    int xStart = std::max(0, x - maxDistance);
    int xEnd = std::min(binaryImg.cols - 1, x + maxDistance);
    int yStart = std::max(0, y - maxDistance);
    int yEnd = std::min(binaryImg.rows - 1, y + maxDistance);
    
    cv::Rect roi(xStart, yStart, xEnd - xStart + 1, yEnd - yStart + 1);
    cv::Mat localDistances = distances(roi);
    cv::Mat localBinary = binaryImg(roi);
    
    if (cv::sum(localBinary).val[0] == 0) {
        return std::numeric_limits<float>::max();
    }
    
    double sum = 0;
    int count = 0;
    for (int i = 0; i < localBinary.rows; i++) {
        for (int j = 0; j < localBinary.cols; j++) {
            if (localBinary.at<uchar>(i, j) > 0) {
                sum += localDistances.at<float>(i, j);
                count++;
            }
        }
    }
    
    return count > 0 ? static_cast<float>(sum / count) : std::numeric_limits<float>::max();
}

std::vector<cv::Rect> DartDetector::filterConnectedComponents(
    const cv::Mat& binaryImg,
    cv::Mat& filteredMask
) {
    filteredMask = cv::Mat::zeros(binaryImg.size(), CV_8UC1);
    std::vector<cv::Rect> validComponents;
    
    cv::Mat labels, stats, centroids;
    int numLabels = cv::connectedComponentsWithStats(binaryImg, labels, stats, centroids, 8);
    
    for (int label = 1; label < numLabels; label++) {
        int area = stats.at<int>(label, cv::CC_STAT_AREA);
        int x = stats.at<int>(label, cv::CC_STAT_LEFT);
        int y = stats.at<int>(label, cv::CC_STAT_TOP);
        int w = stats.at<int>(label, cv::CC_STAT_WIDTH);
        int h = stats.at<int>(label, cv::CC_STAT_HEIGHT);
        
        if (area < minArea_) {
            continue;
        }
        
        float aspectRatio = static_cast<float>(std::max(w, h)) / std::max(std::min(w, h), 1);
        
        if (aspectRatio < minAspectRatio_) {
            continue;
        }
        
        cv::Mat componentMask = (labels == label);
        cv::bitwise_or(filteredMask, componentMask, filteredMask);
        validComponents.emplace_back(x, y, w, h);
    }
    
    return validComponents;
}

std::vector<cv::Point2i> DartDetector::extractDartTipsFromComponent(
    const cv::Mat& componentMask,
    int debugIdx
) {
    std::vector<cv::Point2i> tipPoints;
    
    std::vector<cv::Point2f> points;
    for (int y = 0; y < componentMask.rows; y++) {
        for (int x = 0; x < componentMask.cols; x++) {
            if (componentMask.at<uchar>(y, x) > 0) {
                points.emplace_back(static_cast<float>(x), static_cast<float>(y));
            }
        }
    }
    
    if (points.size() < 10) {
        return tipPoints;
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
    
    cv::Mat keptMask = cv::Mat::zeros(componentMask.size(), CV_8UC1);
    for (size_t i = 0; i < points.size(); i++) {
        if (projections[i] > tMid) {
            int x = static_cast<int>(points[i].x);
            int y = static_cast<int>(points[i].y);
            if (x >= 0 && x < componentMask.cols && y >= 0 && y < componentMask.rows) {
                keptMask.at<uchar>(y, x) = 1;
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
        tipPoints.push_back(cv::Point2i(
            static_cast<int>(componentPoints[maxIdx].x),
            static_cast<int>(componentPoints[maxIdx].y)
        ));
    }
    
    return tipPoints;
}

std::vector<cv::Point2i> DartDetector::detectDartTipsPCA(
    const cv::Mat& binaryImg,
    const std::vector<cv::Rect>& components,
    const cv::Mat& labels,
    int maxDarts
) {
    std::vector<cv::Point2i> allTips;
    
    for (size_t i = 0; i < components.size() && static_cast<int>(i) < maxDarts; i++) {
        cv::Mat componentMask = (labels == static_cast<int>(i) + 1);
        auto tips = extractDartTipsFromComponent(componentMask, static_cast<int>(i));
        allTips.insert(allTips.end(), tips.begin(), tips.end());
    }
    
    return allTips;
}

std::vector<DetectionResult> DartDetector::detect(
    const cv::Mat& imageBefore,
    const cv::Mat& imageAfter,
    bool debug
) {
    std::vector<DetectionResult> results;
    
    cv::Mat grayBefore = preprocessImage(imageBefore);
    cv::Mat grayAfter = preprocessImage(imageAfter);
    
    cv::Mat diff;
    cv::absdiff(grayBefore, grayAfter, diff);
    
    cv::Mat thresh;
    cv::threshold(diff, thresh, 10, 255, cv::THRESH_BINARY);
    
    cv::Mat kernel = cv::getStructuringElement(cv::MORPH_RECT, cv::Size(3, 3));
    cv::morphologyEx(thresh, thresh, cv::MORPH_CLOSE, kernel);
    cv::morphologyEx(thresh, thresh, cv::MORPH_OPEN, kernel);
    
    cv::Mat binaryImg;
    thresh.convertTo(binaryImg, CV_8UC1, 1.0 / 255.0);
    
    if (cv::sum(binaryImg).val[0] == 0) {
        return results;
    }
    
    cv::Mat filteredMask;
    auto validComponents = filterConnectedComponents(binaryImg, filteredMask);
    
    if (validComponents.empty()) {
        return results;
    }
    
    cv::Mat labels;
    cv::connectedComponents(filteredMask, labels, 8);
    
    auto tipPoints = detectDartTipsPCA(filteredMask, validComponents, labels, 3);
    
    for (const auto& tip : tipPoints) {
        DetectionResult result;
        result.x = static_cast<float>(tip.x);
        result.y = static_cast<float>(tip.y);
        result.sector = 0;
        result.ringType = 0;
        result.score = 0;
        results.push_back(result);
    }
    
    return results;
}

}
