// Both includes are found in the paired tree: inc/core, not inc/net.
#include "engine.h"
#include "util.h"

namespace app {

Engine::Engine() {}

void Engine::run() {
  frames++;
}

int Engine::frameCount() const {
  return frames;
}

}  // namespace app
