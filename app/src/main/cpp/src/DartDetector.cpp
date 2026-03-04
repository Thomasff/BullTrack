#include "DartDetector.h"
#include "ImagePreprocessor.h"
#include <stdexcept>
#include <algorithm>
#include <cmath>
#include <limits>

DartDetector::DartDetector(double min_area, double min_aspect_ratio)
    : min_area_(min_area), min_aspect_ratio_(min_aspect_ratio) {
}

std::vector<cv::Point> DartDetector::detect(const cv::Mat& img_before, 
                                            const cv::Mat& img_after) {
    ImagePreprocessor preprocessor;
    cv::Mat gray_before = preprocessor.preprocess(img_before);
    cv::Mat gray_after = preprocessor.preprocess(img_after);

    cv::Mat binary_img = preprocessDiff(gray_before, gray_after);

    if (cv::countNonZero(binary_img) == 0) {
        throw std::runtime_error("No dart contour detected");
    }

    std::vector<ComponentInfo> components = filterComponents(binary_img);

    if (components.empty()) {
        throw std::runtime_error("No dart contour detected after filtering");
    }

    std::vector<cv::Point> all_tips;
    int max_darts = 3;

    for (size_t i = 0; i < std::min(components.size(), static_cast<size_t>(max_darts)); ++i) {
        std::vector<cv::Point> tips = extractTipFromComponent(components[i].mask);
        all_tips.insert(all_tips.end(), tips.begin(), tips.end());
    }

    if (all_tips.size() > static_cast<size_t>(max_darts)) {
        all_tips.resize(max_darts);
    }

    if (all_tips.empty()) {
        throw std::runtime_error("No dart tip detected");
    }

    return all_tips;
}

void DartDetector::setParams(double min_area, double min_aspect_ratio) {
    min_area_ = min_area;
    min_aspect_ratio_ = min_aspect_ratio;
}

cv::Mat DartDetector::preprocessDiff(const cv::Mat& gray_before, const cv::Mat& gray_after) const {
    cv::Mat diff;
    cv::absdiff(gray_before, gray_after, diff);

    cv::Mat thresh;
    cv::threshold(diff, thresh, 10, 255, cv::THRESH_BINARY);

    cv::Mat kernel = cv::getStructuringElement(cv::MORPH_RECT, cv::Size(3, 3));
    cv::morphologyEx(thresh, thresh, cv::MORPH_CLOSE, kernel);
    cv::morphologyEx(thresh, thresh, cv::MORPH_OPEN, kernel);

    return thresh;
}

std::vector<ComponentInfo> DartDetector::filterComponents(const cv::Mat& binary_img) const {
    cv::Mat labels, stats, centroids;
    int num_labels = cv::connectedComponentsWithStats(binary_img, labels, stats, centroids, 8);

    std::vector<ComponentInfo> valid_components;

    for (int label = 1; label < num_labels; ++label) {
        int area = stats.at<int>(label, cv::CC_STAT_AREA);
        int x = stats.at<int>(label, cv::CC_STAT_LEFT);
        int y = stats.at<int>(label, cv::CC_STAT_TOP);
        int w = stats.at<int>(label, cv::CC_STAT_WIDTH);
        int h = stats.at<int>(label, cv::CC_STAT_HEIGHT);

        if (area < min_area_) {
            continue;
        }

        double aspect_ratio = static_cast<double>(std::max(w, h)) / static_cast<double>(std::min(w, h));
        if (aspect_ratio < min_aspect_ratio_) {
            continue;
        }

        cv::Mat component_mask = (labels == label);
        component_mask.convertTo(component_mask, CV_8U);

        ComponentInfo info;
        info.label = label;
        info.area = area;
        info.x = x;
        info.y = y;
        info.width = w;
        info.height = h;
        info.aspect_ratio = aspect_ratio;
        info.mask = component_mask;

        valid_components.push_back(info);
    }

    return valid_components;
}

std::vector<cv::Point> DartDetector::extractTipFromComponent(const cv::Mat& component_mask) const {
    std::vector<cv::Point> points;
    for (int y = 0; y < component_mask.rows; ++y) {
        for (int x = 0; x < component_mask.cols; ++x) {
            if (component_mask.at<uchar>(y, x) > 0) {
                points.push_back(cv::Point(x, y));
            }
        }
    }

    if (points.size() < 10) {
        return {};
    }

    cv::Point2d mean;
    cv::Vec2d direction = computePCADirection(points, mean);

    std::vector<double> projections;
    projections.reserve(points.size());
    for (const auto& pt : points) {
        cv::Vec2d vec(pt.x - mean.x, pt.y - mean.y);
        double proj = vec.dot(direction);
        projections.push_back(proj);
    }

    auto min_it = std::min_element(projections.begin(), projections.end());
    auto max_it = std::max_element(projections.begin(), projections.end());
    double t_min = *min_it;
    double t_max = *max_it;
    double t_mid = (t_min + t_max) / 2.0;

    std::vector<cv::Point> kept_points;
    for (size_t i = 0; i < points.size(); ++i) {
        if (projections[i] > t_mid) {
            kept_points.push_back(points[i]);
        }
    }

    if (kept_points.empty()) {
        return {};
    }

    cv::Mat kept_mask_img = cv::Mat::zeros(component_mask.size(), CV_8U);
    for (const auto& pt : kept_points) {
        if (pt.y >= 0 && pt.y < kept_mask_img.rows && pt.x >= 0 && pt.x < kept_mask_img.cols) {
            kept_mask_img.at<uchar>(pt.y, pt.x) = 1;
        }
    }

    cv::Mat kernel = cv::getStructuringElement(cv::MORPH_RECT, cv::Size(3, 3));
    cv::morphologyEx(kept_mask_img, kept_mask_img, cv::MORPH_CLOSE, kernel);

    cv::Mat new_labels;
    int num_new_labels = cv::connectedComponents(kept_mask_img, new_labels, 8);

    std::vector<cv::Point> tip_points;

    for (int label = 1; label < num_new_labels; ++label) {
        std::vector<cv::Point> component_points;
        for (int y = 0; y < new_labels.rows; ++y) {
            for (int x = 0; x < new_labels.cols; ++x) {
                if (new_labels.at<int>(y, x) == label) {
                    component_points.push_back(cv::Point(x, y));
                }
            }
        }

        if (component_points.empty()) {
            continue;
        }

        double max_proj = -std::numeric_limits<double>::max();
        cv::Point tip_point;

        for (const auto& pt : component_points) {
            cv::Vec2d vec(pt.x - mean.x, pt.y - mean.y);
            double proj = vec.dot(direction);
            if (proj > max_proj) {
                max_proj = proj;
                tip_point = pt;
            }
        }

        tip_points.push_back(tip_point);
    }

    return tip_points;
}

cv::Vec2d DartDetector::computePCADirection(const std::vector<cv::Point>& points, cv::Point2d& mean) const {
    double sum_x = 0, sum_y = 0;
    for (const auto& pt : points) {
        sum_x += pt.x;
        sum_y += pt.y;
    }
    mean = cv::Point2d(sum_x / points.size(), sum_y / points.size());

    double cov_xx = 0, cov_xy = 0, cov_yy = 0;
    for (const auto& pt : points) {
        double dx = pt.x - mean.x;
        double dy = pt.y - mean.y;
        cov_xx += dx * dx;
        cov_xy += dx * dy;
        cov_yy += dy * dy;
    }
    cov_xx /= points.size();
    cov_xy /= points.size();
    cov_yy /= points.size();

    double trace = cov_xx + cov_yy;
    double det = cov_xx * cov_yy - cov_xy * cov_xy;
    double lambda1 = trace / 2.0 + std::sqrt(std::max(0.0, trace * trace / 4.0 - det));

    cv::Vec2d eigenvector;
    if (std::abs(cov_xy) > 1e-10) {
        eigenvector[0] = lambda1 - cov_yy;
        eigenvector[1] = cov_xy;
    } else if (cov_xx > cov_yy) {
        eigenvector[0] = 1;
        eigenvector[1] = 0;
    } else {
        eigenvector[0] = 0;
        eigenvector[1] = 1;
    }

    double norm = std::sqrt(eigenvector[0] * eigenvector[0] + eigenvector[1] * eigenvector[1]);
    if (norm > 1e-10) {
        eigenvector /= norm;
    }

    if (eigenvector[0] > 0) {
        eigenvector = -eigenvector;
    }

    return eigenvector;
}
