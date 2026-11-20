// Declared here, implemented in src/core/engine.cpp: the two trees mirror each other.
#pragma once

#include "util.h"

namespace app {

class Engine {
 public:
  Engine();
  void run();
  int frameCount() const;

 private:
  Timer timer;
  int frames = 0;
};

}  // namespace app
