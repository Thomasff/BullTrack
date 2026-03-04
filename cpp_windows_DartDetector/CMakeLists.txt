cmake_minimum_required(VERSION 3.16)
project(DartDetector VERSION 1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)

if(DEFINED ENV{VCPKG_ROOT} AND NOT DEFINED CMAKE_TOOLCHAIN_FILE)
    set(CMAKE_TOOLCHAIN_FILE "$ENV{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake" CACHE STRING "")
endif()

find_package(OpenCV 4 REQUIRED)
find_package(Threads REQUIRED)

if(OpenCV_VERSION VERSION_LESS "4.0")
    message(FATAL_ERROR "OpenCV 4.0 or higher is required")
endif()

message(STATUS "OpenCV version: ${OpenCV_VERSION}")
message(STATUS "OpenCV include dirs: ${OpenCV_INCLUDE_DIRS}")
message(STATUS "OpenCV libraries: ${OpenCV_LIBS}")

include_directories(${OpenCV_INCLUDE_DIRS})
include_directories(${CMAKE_SOURCE_DIR}/include)

set(DEBUG_IMAGES_DIR "${CMAKE_SOURCE_DIR}/result")

add_definitions(-DDEBUG_IMAGES_PATH="${DEBUG_IMAGES_DIR}")

set(SOURCE_FILES
    src/main.cpp
    src/ImagePreprocessor.cpp
    src/ArucoDetector.cpp
    src/HomographyWarper.cpp
    src/BoardCircleDetector.cpp
    src/DartDetector.cpp
    src/DartScorer.cpp
)

add_executable(dart_detector ${SOURCE_FILES})

target_link_libraries(dart_detector
    ${OpenCV_LIBS}
    Threads::Threads
)

if(WIN32)
    target_compile_definitions(dart_detector PRIVATE _CRT_SECURE_NO_WARNINGS)
endif()

install(TARGETS dart_detector DESTINATION bin)
