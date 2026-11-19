#pragma once
#include <geometry/shape.h>

namespace geo {

class Scene;

class Renderer {
public:
  void render(const Scene& scene);
};

class Logger {
public:
  static void log(const char* message);
};

class SceneInspector {};

}  // namespace geo
