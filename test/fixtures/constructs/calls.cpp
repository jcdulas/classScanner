// Method calls, and what the source says about the object of each call.
#include "calls.hpp"

void Engine::run(Scene& scene, Shape* shape) {
  Timer timer;
  auto* factory = makeFactory();
  timer.start();
  scene.add(shape);
  shape->draw();
  renderer->render(scene);
  this->logger->write("run");
  this->update();
  update();
  Registry::instance().flush();
  factory->create();
  std::move(shape);
  for (const Layer& layer : scene.layers()) {
    layer.show<int>();
  }
}
