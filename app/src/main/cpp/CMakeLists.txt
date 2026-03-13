cmake_minimum_required(VERSION 3.22.1)

project("bulltrack")

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(OpenCV_DIR ${CMAKE_CURRENT_SOURCE_DIR}/opencv-sdk/sdk/native/jni)
get_filename_component(PROJECT_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/../../../.. ABSOLUTE)
set(V2_ROOT ${PROJECT_ROOT}/cpp_dart_detector_v2)

find_package(OpenCV REQUIRED)

message(STATUS "OpenCV version: ${OpenCV_VERSION}")
message(STATUS "OpenCV include dirs: ${OpenCV_INCLUDE_DIRS}")

add_library(bulltrack_core_v2 STATIC
    ${V2_ROOT}/src/Config.cpp
    ${V2_ROOT}/src/Preprocessing.cpp
    src/BoardDetector.cpp
    ${V2_ROOT}/src/Alignment.cpp
    ${V2_ROOT}/src/DartDetector.cpp
    ${V2_ROOT}/src/Pipeline.cpp
    src/AndroidBullTrackSession.cpp
)

target_include_directories(bulltrack_core_v2 PRIVATE
    ${V2_ROOT}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${OpenCV_INCLUDE_DIRS}
)

target_compile_definitions(bulltrack_core_v2 PRIVATE
    DEBUG_IMAGES_PATH="result"
    RESULT_IMAGES_PATH="images"
)

add_library(${CMAKE_PROJECT_NAME} SHARED
    src/native_jni_v2.cpp
)

target_include_directories(${CMAKE_PROJECT_NAME} PRIVATE
    ${V2_ROOT}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${OpenCV_INCLUDE_DIRS}
)

target_link_libraries(bulltrack_core_v2
    ${OpenCV_LIBS}
    android
    log
    jnigraphics
)

target_link_libraries(${CMAKE_PROJECT_NAME}
    bulltrack_core_v2
    ${OpenCV_LIBS}
    android
    log
    jnigraphics
)
