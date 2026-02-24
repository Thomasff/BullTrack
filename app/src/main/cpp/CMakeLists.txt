cmake_minimum_required(VERSION 3.22.1)

project("bulltrack")

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(OpenCV_DIR ${CMAKE_SOURCE_DIR}/opencv-sdk/sdk/native/jni)

find_package(OpenCV REQUIRED)

add_library(${CMAKE_PROJECT_NAME} SHARED
    dart_detector.cpp
    image_processor.cpp
    aruco_detector.cpp
    board_detector.cpp
    dart_tip_detector.cpp
    scoring.cpp
    native_jni.cpp
)

target_include_directories(${CMAKE_PROJECT_NAME} PRIVATE
    ${CMAKE_SOURCE_DIR}
    ${OpenCV_INCLUDE_DIRS}
)

target_link_libraries(${CMAKE_PROJECT_NAME}
    ${OpenCV_LIBS}
    android
    log
    jnigraphics
)
