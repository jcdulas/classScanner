// Methods defined outside their class, and the types used in their bodies.
#include "definitions.hpp"

namespace app {

void core::Engine::run(Scene& scene) {
  Timer timer;
  auto* factory = new Factory();
  Registry::instance().add(factory);
  auto* derived = static_cast<DerivedScene*>(&scene);
}

template <typename T>
T Pool<T>::acquire() {
  return Allocator<T>::allocate();
}

Engine::~Engine() {}

}  // namespace app

void freeFunction() {
  NotCollected unused;
}
