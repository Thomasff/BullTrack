cmake_minimum_required(VERSION 3.22.1)

project("bulltrack")

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT DEFINED BT_ENABLE_DEBUG_IMAGES)
    set(BT_ENABLE_DEBUG_IMAGES OFF)
endif()

set(OpenCV_DIR ${CMAKE_CURRENT_SOURCE_DIR}/opencv-sdk/sdk/native/jni)

find_package(OpenCV REQUIRED)

message(STATUS "OpenCV version: ${OpenCV_VERSION}")
message(STATUS "OpenCV include dirs: ${OpenCV_INCLUDE_DIRS}")
message(STATUS "BT_ENABLE_DEBUG_IMAGES: ${BT_ENABLE_DEBUG_IMAGES}")

add_library(bulltrack_core_v2 STATIC
    src/bulltrack_v2/Config.cpp
    src/bulltrack_v2/Preprocessing.cpp
    src/BoardDetector.cpp
    src/bulltrack_v2/Alignment.cpp
    src/bulltrack_v2/DartDetector.cpp
    src/bulltrack_v2/Pipeline.cpp
    src/AndroidBullTrackSession.cpp
)

target_include_directories(bulltrack_core_v2 PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${OpenCV_INCLUDE_DIRS}
)

target_compile_definitions(bulltrack_core_v2 PRIVATE
    DEBUG_IMAGES_PATH="result"
    RESULT_IMAGES_PATH="images"
    BT_ENABLE_DEBUG_IMAGES=$<IF:$<BOOL:${BT_ENABLE_DEBUG_IMAGES}>,1,0>
)

add_library(${CMAKE_PROJECT_NAME} SHARED
    src/native_jni_v2.cpp
)

target_include_directories(${CMAKE_PROJECT_NAME} PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${OpenCV_INCLUDE_DIRS}
)

target_compile_definitions(${CMAKE_PROJECT_NAME} PRIVATE
    BT_ENABLE_DEBUG_IMAGES=$<IF:$<BOOL:${BT_ENABLE_DEBUG_IMAGES}>,1,0>
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
