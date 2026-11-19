// Attributes and methods with every flag the extractor reads.
class Shape {
public:
  Shape(int sides);
  virtual ~Shape();
  virtual double area() const = 0;
  static Shape* create(const char* name);
  Shape& operator=(const Shape& other);
  int sides() const { return sides_; }
  void draw(Canvas& canvas) override;

protected:
  Color color;
  Point* origin, *center;
  static const int kMaxSides;

private:
  int sides_ = 0;
  float weights[4];
  void (*callback)(int);
};

struct Plain {
  int publicByDefault;
};
