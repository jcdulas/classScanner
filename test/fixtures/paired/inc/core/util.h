// Has a source file, src/core/util.cpp, that defines no method of Timer.
#pragma once

namespace app {

class Timer {
 public:
  double elapsed() const { return seconds; }

 private:
  double seconds = 0;
};

double clampSeconds(double seconds);

}  // namespace app
