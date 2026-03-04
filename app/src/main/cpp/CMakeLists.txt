cmake_minimum_required(VERSION 3.22.1)

project("bulltrack")

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(OpenCV_DIR ${CMAKE_SOURCE_DIR}/opencv-sdk/sdk/native/jni)

find_package(OpenCV REQUIRED)

message(STATUS "OpenCV version: ${OpenCV_VERSION}")
message(STATUS "OpenCV include dirs: ${OpenCV_INCLUDE_DIRS}")

add_library(${CMAKE_PROJECT_NAME} SHARED
    src/ImagePreprocessor.cpp
    src/ArucoDetector.cpp
    src/HomographyWarper.cpp
    src/BoardCircleDetector.cpp
    src/DartDetector.cpp
    src/DartScorer.cpp
    src/native_jni.cpp
)

target_include_directories(${CMAKE_PROJECT_NAME} PRIVATE
    ${CMAKE_SOURCE_DIR}/include
    ${OpenCV_INCLUDE_DIRS}
)

target_link_libraries(${CMAKE_PROJECT_NAME}
    ${OpenCV_LIBS}
    android
    log
    jnigraphics
)
