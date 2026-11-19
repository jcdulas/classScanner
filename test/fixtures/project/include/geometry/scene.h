#pragma once
#include <map>
#include "shape.h"

namespace geo {

class Layer;
using ShapeList = std::vector<std::unique_ptr<Shape>>;

class Scene {
public:
  void add(std::unique_ptr<Shape> shape);
  Layer* activeLayer() const;

private:
  struct Statistics {
    int shapeCount;
  };

  ShapeList shapes;
  std::map<int, std::shared_ptr<Layer>> layers;
  Scene* parent;
  Statistics statistics;
  friend class SceneInspector;
};

class Layer {
public:
  std::string name;
  Scene* owner;
};

}  // namespace geo
