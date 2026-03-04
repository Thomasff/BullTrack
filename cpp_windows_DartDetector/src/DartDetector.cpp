#include "DartDetector.h"
#include "ImagePreprocessor.h"
#include <stdexcept>
#include <algorithm>
#include <filesystem>
#include <cmath>
#include <limits>

#ifndef DEBUG_IMAGES_PATH
#define DEBUG_IMAGES_PATH "result"
#endif

DartDetector::DartDetector(double min_area, double min_aspect_ratio)
    : min_area_(min_area), min_aspect_ratio_(min_aspect_ratio) {
}

std::vector<cv::Point> DartDetector::detect(const cv::Mat& img_before, 
                                            const cv::Mat& img_after, 
                                            bool debug) {
    ImagePreprocessor preprocessor;
    cv::Mat gray_before = preprocessor.preprocess(img_before);
    cv::Mat gray_after = preprocessor.preprocess(img_after);

    cv::Mat binary_img = preprocessDiff(gray_before, gray_after);

    if (cv::countNonZero(binary_img) == 0) {
        throw std::runtime_error("No dart contour detected");
    }

    std::vector<ComponentInfo> components = filterComponents(binary_img, debug);

    if (components.empty()) {
        throw std::runtime_error("No dart contour detected after filtering");
    }

    std::vector<cv::Point> all_tips;
    int max_darts = 3;

    for (size_t i = 0; i < std::min(components.size(), static_cast<size_t>(max_darts)); ++i) {
        std::vector<cv::Point> tips = extractTipFromComponent(components[i].mask, static_cast<int>(i), debug);
        all_tips.insert(all_tips.end(), tips.begin(), tips.end());
    }

    if (all_tips.size() > static_cast<size_t>(max_darts)) {
        all_tips.resize(max_darts);
    }

    if (all_tips.empty()) {
        throw std::runtime_error("No dart tip detected");
    }

    if (debug) {
        cv::Mat diff;
        cv::absdiff(gray_before, gray_after, diff);
        cv::Mat thresh;
        cv::threshold(diff, thresh, 10, 255, cv::THRESH_BINARY);
        drawDebugImages(diff, thresh, components, all_tips);
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

std::vector<ComponentInfo> DartDetector::filterComponents(const cv::Mat& binary_img, bool debug) const {
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

    if (debug && !valid_components.empty()) {
        cv::Mat debug_img;
        cv::cvtColor(binary_img * 255, debug_img, cv::COLOR_GRAY2BGR);

        std::vector<cv::Scalar> colors = {
            cv::Scalar(255, 0, 0), cv::Scalar(0, 255, 0), cv::Scalar(0, 0, 255),
            cv::Scalar(255, 255, 0), cv::Scalar(255, 0, 255), cv::Scalar(0, 255, 255)
        };

        for (size_t i = 0; i < valid_components.size(); ++i) {
            const auto& comp = valid_components[i];
            cv::Scalar color = colors[i % colors.size()];
            cv::rectangle(debug_img, cv::Point(comp.x, comp.y),
                         cv::Point(comp.x + comp.width, comp.y + comp.height),
                         color, 2);

            std::string text = "#" + std::to_string(i + 1) + ":A=" + std::to_string(comp.area) +
                              ",R=" + std::to_string(static_cast<int>(comp.aspect_ratio));
            cv::putText(debug_img, text, cv::Point(comp.x, comp.y - 5),
                       cv::FONT_HERSHEY_SIMPLEX, 0.4, color, 1);
        }

        std::string debug_path = std::string(DEBUG_IMAGES_PATH) + "/debug_03_filtered_components.jpg";
        namespace fs = std::filesystem;
        fs::create_directories(DEBUG_IMAGES_PATH);
        cv::imwrite(debug_path, debug_img);
        std::cout << "Debug image saved to: " << debug_path << " (kept " << valid_components.size() << " components)" << std::endl;
    }

    return valid_components;
}

std::vector<cv::Point> DartDetector::extractTipFromComponent(const cv::Mat& component_mask, 
                                                              int debug_idx, 
                                                              bool debug) const {
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

    if (debug) {
        cv::Mat debug_img;
        cv::cvtColor(component_mask * 255, debug_img, cv::COLOR_GRAY2BGR);

        cv::Point center(static_cast<int>(mean.x), static_cast<int>(mean.y));
        cv::Point direction_end(static_cast<int>(mean.x + direction[0] * 100),
                               static_cast<int>(mean.y + direction[1] * 100));
        cv::line(debug_img, center, direction_end, cv::Scalar(0, 255, 0), 2);

        cv::Point2d cut_line_start(mean.x + direction[0] * t_mid, mean.y + direction[1] * t_mid);
        cv::Vec2d perp(-direction[1], direction[0]);
        cv::Point2d cut_line_end(cut_line_start.x + perp[0] * 50.0, cut_line_start.y + perp[1] * 50.0);
        cv::Point2d cut_line_start2(cut_line_start.x - perp[0] * 50.0, cut_line_start.y - perp[1] * 50.0);
        cv::line(debug_img, cv::Point(static_cast<int>(cut_line_start2.x), static_cast<int>(cut_line_start2.y)),
                cv::Point(static_cast<int>(cut_line_end.x), static_cast<int>(cut_line_end.y)),
                cv::Scalar(255, 0, 0), 2);

        std::vector<cv::Scalar> colors = {
            cv::Scalar(0, 0, 255), cv::Scalar(255, 255, 0), cv::Scalar(255, 0, 255), cv::Scalar(0, 255, 255)
        };

        for (size_t i = 0; i < tip_points.size(); ++i) {
            cv::Scalar color = colors[i % colors.size()];
            cv::circle(debug_img, tip_points[i], 8, color, -1);
            cv::putText(debug_img, "T" + std::to_string(i + 1),
                       cv::Point(tip_points[i].x + 10, tip_points[i].y - 10),
                       cv::FONT_HERSHEY_SIMPLEX, 0.6, color, 2);
        }

        std::string debug_path = std::string(DEBUG_IMAGES_PATH) + "/debug_04_pca_component_" + std::to_string(debug_idx) + ".jpg";
        cv::imwrite(debug_path, debug_img);
        std::cout << "Debug image saved to: " << debug_path << " (detected " << tip_points.size() << " tips)" << std::endl;
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

void DartDetector::drawDebugImages(const cv::Mat& diff, 
                                    const cv::Mat& thresh,
                                    const std::vector<ComponentInfo>& components,
                                    const std::vector<cv::Point>& tips) const {
    namespace fs = std::filesystem;
    fs::create_directories(DEBUG_IMAGES_PATH);

    std::string diff_path = std::string(DEBUG_IMAGES_PATH) + "/debug_01_diff.jpg";
    cv::imwrite(diff_path, diff);
    std::cout << "Debug image saved to: " << diff_path << std::endl;

    std::string thresh_path = std::string(DEBUG_IMAGES_PATH) + "/debug_02_thresh.jpg";
    cv::imwrite(thresh_path, thresh);
    std::cout << "Debug image saved to: " << thresh_path << std::endl;

    if (!tips.empty()) {
        cv::Mat tips_img;
        cv::cvtColor(thresh * 255, tips_img, cv::COLOR_GRAY2BGR);

        std::vector<cv::Scalar> colors = {
            cv::Scalar(255, 0, 0), cv::Scalar(0, 255, 0), cv::Scalar(0, 0, 255)
        };

        for (size_t i = 0; i < tips.size(); ++i) {
            cv::Scalar color = colors[i % colors.size()];
            cv::circle(tips_img, tips[i], 10, color, -1);
            cv::putText(tips_img, "D" + std::to_string(i + 1),
                       cv::Point(tips[i].x + 15, tips[i].y - 10),
                       cv::FONT_HERSHEY_SIMPLEX, 0.7, color, 2);
        }

        std::string tips_path = std::string(DEBUG_IMAGES_PATH) + "/debug_05_pca_tips.jpg";
        cv::imwrite(tips_path, tips_img);
        std::cout << "Debug image saved to: " << tips_path << " (detected " << tips.size() << " tips)" << std::endl;
    }
}
