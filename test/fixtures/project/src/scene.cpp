#include "geometry/scene.h"
#include "renderer.h"

namespace geo {

void Scene::add(std::unique_ptr<Shape> shape) {
  Renderer renderer;
  Logger::log("add");
  shapes.push_back(std::move(shape));
}

Layer* Scene::activeLayer() const {
  return layers.begin()->second.get();
}

}  // namespace geo
