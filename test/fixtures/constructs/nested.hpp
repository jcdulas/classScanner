// Nested classes, nested enums and a nested class defined outside its outer class.
namespace ui {

class Window {
public:
  enum class State : int { Hidden, Shown = 2, Minimized };
  struct Geometry {
    int width;
    int height;
  };
  Geometry geometry;
  State state;

private:
  class Impl;
  Impl* impl;
};

class Window::Impl {
  Geometry cached;
};

}  // namespace ui
