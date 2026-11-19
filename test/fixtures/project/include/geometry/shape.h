#pragma once
#include <memory>
#include <vector>

namespace geo {

class Canvas;

class Point {
public:
  double x;
  double y;
};

class Shape {
public:
  virtual ~Shape() = default;
  virtual double area() const = 0;
  virtual void draw(Canvas& canvas) const;

protected:
  Point origin;
};

class Circle : public Shape {
public:
  double area() const override;

private:
  double radius;
};

class Polygon : public Shape {
public:
  double area() const override;

private:
  std::vector<Point> vertices;
};

}  // namespace geo
