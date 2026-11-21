// Functions that belong to no class: what they use of the classes is kept.
#include "scene.h"

namespace app {

// A type in the signature, a local variable, a call on a parameter and a call through `::`.
void render(Scene& scene) {
  Renderer renderer;
  scene.add(nullptr);
  Registry::instance();
}

namespace {
// In a namespace without a name: the function is named `app::helper`.
int helper(const Shape* shape) {
  return shape->area();
}
}  // namespace

}  // namespace app

// Qualified by a namespace, not by a class.
void app::shutdown() {
  Registry::clear();
}

template <typename T>
T clamp(T value) {
  return value;
}

int main() {
  app::Scene scene;
  app::render(scene);
  return 0;
}

// A prototype: the function is declared without its code.
app::Scene* findScene();
