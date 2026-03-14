cmake_minimum_required(VERSION 3.16)
project(DartDetectorV2 VERSION 1.0 LANGUAGES CXX)

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

set(DEBUG_IMAGES_DIR "result")
set(RESULT_IMAGES_DIR "images")

set(CORE_SOURCE_FILES
    src/Config.cpp
    src/Preprocessing.cpp
    src/BoardDetector.cpp
    src/Alignment.cpp
    src/DartDetector.cpp
    src/Pipeline.cpp
)

add_executable(dart_detector_v2
    src/main.cpp
    ${CORE_SOURCE_FILES}
)

add_executable(dart_experiment_v2
    src/experiment_main.cpp
    src/Experiment.cpp
    ${CORE_SOURCE_FILES}
)

target_link_libraries(dart_detector_v2
    ${OpenCV_LIBS}
    Threads::Threads
)
target_link_libraries(dart_experiment_v2
    ${OpenCV_LIBS}
    Threads::Threads
)

target_compile_definitions(dart_detector_v2 PRIVATE
    DEBUG_IMAGES_PATH="${DEBUG_IMAGES_DIR}"
    RESULT_IMAGES_PATH="${RESULT_IMAGES_DIR}"
)
target_compile_definitions(dart_experiment_v2 PRIVATE
    DEBUG_IMAGES_PATH="${DEBUG_IMAGES_DIR}"
    RESULT_IMAGES_PATH="${RESULT_IMAGES_DIR}"
)

if(WIN32)
    target_compile_definitions(dart_detector_v2 PRIVATE _CRT_SECURE_NO_WARNINGS)
    target_compile_definitions(dart_experiment_v2 PRIVATE _CRT_SECURE_NO_WARNINGS)
endif()

install(TARGETS dart_detector_v2 dart_experiment_v2 DESTINATION bin)
