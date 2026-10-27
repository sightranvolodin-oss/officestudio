#!/bin/sh
# Builds the native DWG -> DXF converter (LibreDWG, GPL-3.0) used for opening .dwg files.
# Windows binary is cross-compiled with MinGW-w64 on Linux:
#   apt install cmake ninja-build gcc-mingw-w64-x86-64
set -e
COMMIT=$(cat "$(dirname "$0")/../bin/LIBREDWG_COMMIT")
OUT=$(cd "$(dirname "$0")/../bin" && pwd)
WORK=${WORK:-/tmp/libredwg-build}
rm -rf "$WORK" && git clone https://github.com/LibreDWG/libredwg.git "$WORK" && cd "$WORK" && git checkout "$COMMIT"
git clone --depth 1 https://github.com/zserge/jsmn jsmn.tmp && rm -rf jsmn && mv jsmn.tmp jsmn
cat > mingw.cmake <<'TC'
set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_C_COMPILER x86_64-w64-mingw32-gcc)
set(CMAKE_RC_COMPILER x86_64-w64-mingw32-windres)
set(CMAKE_FIND_ROOT_PATH /usr/x86_64-w64-mingw32)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
TC
mkdir build-win && cd build-win
cmake -G Ninja -DCMAKE_TOOLCHAIN_FILE=../mingw.cmake -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DDISABLE_WERROR=ON -DENABLE_LTO=OFF -DCMAKE_EXE_LINKER_FLAGS="-static -static-libgcc" ..
ninja dwg2dxf && x86_64-w64-mingw32-strip -o "$OUT/win/dwg2dxf.exe" dwg2dxf.exe
cd .. && mkdir build-linux && cd build-linux
cmake -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DDISABLE_WERROR=ON ..
ninja dwg2dxf && strip -o "$OUT/linux/dwg2dxf" dwg2dxf
